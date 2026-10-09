#!/opt/bin/python3
"""Fail-closed calibration draft. Default hourly invocation is read-only.

Motion requires a per-invocation --maintenance-approved assertion: clear bed,
exclusive controls, and no scheduled/external macros. This is NOT a hardware
interlock. Never install that flag in unattended cron. See safety documentation.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import math
import os
import shutil
import socket
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

LOG_FILE = Path('/usr/data/auto-optimize.log')
LOCKFILE = Path('/tmp/auto-optimize.lock')
STATE_FILE = Path('/usr/data/auto-optimize.state.json')
PRINTER_CFG = Path('/usr/data/printer_data/config/printer.cfg')
BACKUP_DIR = Path('/usr/data/printer_data/config/.auto-optimize-backups')
SHAPER_STALE = 90 * 24 * 3600
MESH_STALE = 30 * 24 * 3600
MIN_IDLE_SEC = 300
POLL_SEC = 2
MAX_SAMPLE_GAP = 12
MAX_SAMPLE_DURATION = 10
OP_TIMEOUT = 15 * 60
MAX_PER_WEEK = 1
MAX_COOL_TEMP = 50
MAX_HTTP_BYTES = 2 * 1024 * 1024
MAX_HEADER_BYTES = 32768
BASE_OBJECTS = ('webhooks', 'print_stats', 'idle_timeout', 'virtual_sdcard',
                'pause_resume', 'toolhead', 'gcode_move', 'heaters', 'configfile')
COMMANDS = {'shaper_calibrate': 'SHAPER_CALIBRATE',
            'bed_mesh': 'BED_MESH_CALIBRATE PROFILE=default',
            'probe_accuracy': 'PROBE_ACCURACY SAMPLES=5'}
_lock_fd = None


class SafetyError(Exception):
    """Unknown or unsafe state: no further commands are permitted."""


def log(message):
    line = '%s %s\n' % (datetime.now().isoformat(timespec='seconds'), message)
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open('a') as stream:
        stream.write(line)
    print(line, end='')


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise SafetyError('duplicate JSON field')
        result[key] = value
    return result


def _json(payload):
    try:
        result = json.loads(payload.decode('utf-8'), object_pairs_hook=_unique_pairs,
                            parse_constant=lambda value: (_ for _ in ()).throw(
                                SafetyError('non-finite JSON number')))
    except (ValueError, UnicodeError) as exc:
        raise SafetyError('invalid JSON') from exc
    if not isinstance(result, dict):
        raise SafetyError('JSON response must be an object')
    return result


def parse_http(raw):
    """Strict, bounded HTTP/1 response parser; never accept partial responses."""
    if len(raw) > MAX_HTTP_BYTES:
        raise SafetyError('HTTP response too large')
    split = raw.find(b'\r\n\r\n')
    if split < 0 or split > MAX_HEADER_BYTES:
        raise SafetyError('missing or oversized HTTP headers')
    try:
        lines = raw[:split].decode('ascii').split('\r\n')
        version, status, _ = lines[0].split(' ', 2)
        if version not in ('HTTP/1.0', 'HTTP/1.1') or status != '200':
            raise SafetyError('HTTP request did not return 200')
        headers = {}
        for line in lines[1:]:
            key, value = line.split(':', 1)
            key = key.lower()
            if not key or key in headers or key.strip() != key:
                raise SafetyError('ambiguous HTTP headers')
            headers[key] = value.strip().lower()
    except (ValueError, UnicodeError) as exc:
        raise SafetyError('invalid HTTP headers') from exc
    if headers.get('content-encoding', 'identity') != 'identity':
        raise SafetyError('unsupported content encoding')
    payload = raw[split + 4:]
    if 'transfer-encoding' in headers:
        if headers['transfer-encoding'] != 'chunked' or 'content-length' in headers:
            raise SafetyError('ambiguous HTTP framing')
        output = bytearray()
        offset = 0
        while True:
            end = payload.find(b'\r\n', offset)
            if end < 0 or end - offset > 128:
                raise SafetyError('invalid chunk header')
            token = payload[offset:end]
            if not token or any(c not in b'0123456789abcdefABCDEF' for c in token):
                raise SafetyError('invalid chunk length')
            size = int(token, 16)
            offset = end + 2
            if size == 0:
                if payload[offset:] != b'\r\n':
                    raise SafetyError('invalid chunk terminator or trailers')
                payload = bytes(output)
                break
            if size > MAX_HTTP_BYTES or offset + size + 2 > len(payload):
                raise SafetyError('truncated or oversized chunk')
            if payload[offset + size:offset + size + 2] != b'\r\n':
                raise SafetyError('invalid chunk boundary')
            output.extend(payload[offset:offset + size])
            offset += size + 2
    elif 'content-length' in headers:
        value = headers['content-length']
        if not value.isdigit() or int(value) != len(payload):
            raise SafetyError('invalid or truncated content length')
    else:
        raise SafetyError('unframed response')
    result = _json(payload)
    if 'error' in result or 'result' not in result:
        raise SafetyError('Moonraker error or missing result')
    return result


def _http(method, path, body=None, timeout=10):
    """Numeric loopback only: no IDNA dependency, retries, or partial success."""
    deadline = time.monotonic() + timeout
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        def remaining():
            value = deadline - time.monotonic()
            if value <= 0:
                raise SafetyError('HTTP deadline exceeded; command outcome unknown')
            sock.settimeout(value)
        remaining()
        sock.connect(('127.0.0.1', 80))
        header = '%s %s HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n' % (method, path)
        if body is not None:
            header += 'Content-Type: application/json\r\nContent-Length: %d\r\n' % len(body)
        remaining()
        sock.sendall(header.encode('ascii') + b'\r\n' + (body or b''))
        raw = bytearray()
        while True:
            remaining()
            data = sock.recv(min(8192, MAX_HTTP_BYTES + 1 - len(raw)))
            if not data:
                break
            raw.extend(data)
            if len(raw) > MAX_HTTP_BYTES:
                raise SafetyError('HTTP response too large')
        return parse_http(bytes(raw))
    except (OSError, ValueError) as exc:
        raise SafetyError('HTTP failed; command outcome unknown') from exc
    finally:
        sock.close()


def get_json(path, timeout=10):
    return _http('GET', path, timeout=timeout)


def query_objects(objects):
    return _http('POST', '/printer/objects/query',
                 json.dumps({'objects': {name: None for name in objects}}).encode(), timeout=4)


def post_gcode(script, timeout=30):
    response = _http('POST', '/printer/gcode/script',
                     json.dumps({'script': script}).encode(), timeout=timeout)
    if 'error' in response or response.get('result') != 'ok':
        raise SafetyError('G-code completion not acknowledged')
    return response


def acquire_lock():
    """flock acquisition is atomic. Never unlink the shared lock inode."""
    global _lock_fd
    if _lock_fd is not None:
        return False
    fd = os.open(str(LOCKFILE), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        return False
    except Exception:
        os.close(fd)
        raise
    _lock_fd = fd
    return True


def release_lock():
    global _lock_fd
    if _lock_fd is not None:
        os.close(_lock_fd)
        _lock_fd = None


def state():
    if not STATE_FILE.exists():
        return {}
    if STATE_FILE.stat().st_size > MAX_HTTP_BYTES:
        raise SafetyError('calibration history too large')
    value = _json(STATE_FILE.read_bytes())
    runs = value.get('runs', [])
    if not isinstance(runs, list) or len(runs) > 50:
        raise SafetyError('invalid calibration history')
    for run in runs:
        if not isinstance(run, dict) or not isinstance(run.get('ts'), str):
            raise SafetyError('invalid calibration history entry')
        try:
            timestamp = datetime.fromisoformat(run['ts'])
        except ValueError as exc:
            raise SafetyError('invalid calibration timestamp') from exc
        if timestamp.tzinfo is not None or timestamp > datetime.now():
            raise SafetyError('unknown/future calibration timestamp')
    return value


def save_state(value):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.auto-optimize-', dir=str(STATE_FILE.parent))
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, STATE_FILE)
        directory_fd = os.open(str(STATE_FILE.parent), os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def weekly_cap_ok():
    cutoff = datetime.now() - timedelta(days=7)
    return sum(datetime.fromisoformat(run['ts']) > cutoff
               for run in state().get('runs', [])) < MAX_PER_WEEK


def backup_cfg():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='printer-' + datetime.now().strftime('%Y%m%d-%H%M%S-'),
                                suffix='.cfg', dir=str(BACKUP_DIR))
    os.close(fd)
    destination = Path(name)
    shutil.copy2(PRINTER_CFG, destination)
    if destination.read_bytes() != PRINTER_CFG.read_bytes():
        raise SafetyError('config backup verification failed')
    with destination.open('rb') as stream:
        os.fsync(stream.fileno())
    directory_fd = os.open(str(BACKUP_DIR), os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    # Rotate only after a verified backup. Preserve ten most recent copies.
    for old in sorted(BACKUP_DIR.glob('printer-*.cfg'))[:-10]:
        old.unlink()
    return destination


def number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise SafetyError('unknown numeric field: ' + name)
    return value


def process_identity(info):
    """Older vendor builds omit the upstream PID; do not invent continuity."""
    value = info.get('process_id') if isinstance(info, dict) else None
    if type(value) is not int or not 0 < value <= 2 ** 31 - 1:
        raise SafetyError('Klipper process identity unavailable or invalid; maintenance blocked')
    return value


def validate_pending(configfile, operation=None):
    """Upstream configfile status stores section -> option -> string (or removal).

    Refuse unknown firmware schemas and unrelated/removal items. SAVE_CONFIG
    persists the entire autosave buffer, not just this helper's calibration.
    """
    try:
        flag = configfile['save_config_pending']
        items = configfile['save_config_pending_items']
    except (KeyError, TypeError) as exc:
        raise SafetyError('firmware pending-config fields unavailable') from exc
    if type(flag) is not bool or not isinstance(items, dict) or flag != bool(items):
        raise SafetyError('pending-config state unknown/inconsistent')
    if operation in (None, 'probe_accuracy'):
        if flag or items:
            raise SafetyError('unrelated configuration already pending; refuses motion/save')
        return {}
    section = 'input_shaper' if operation == 'shaper_calibrate' else 'bed_mesh default'
    if operation not in ('shaper_calibrate', 'bed_mesh') or set(items) != {section}:
        raise SafetyError('calibration pending sections missing/unrelated')
    values = items[section]
    if not isinstance(values, dict) or any(not isinstance(value, str) for value in values.values()):
        raise SafetyError('pending configuration contains removal/unknown values')

    def numeric(key, low, high, integer=False):
        try:
            raw = values[key]
            value = int(raw) if integer else float(raw)
        except (ValueError, TypeError, KeyError) as exc:
            raise SafetyError('pending calibration numeric value invalid') from exc
        if not math.isfinite(value) or not low <= value <= high:
            raise SafetyError('pending calibration value outside conservative bounds')
        return value

    if operation == 'shaper_calibrate':
        if set(values) != {'shaper_type_x', 'shaper_freq_x', 'shaper_type_y', 'shaper_freq_y'}:
            raise SafetyError('shaper pending keys missing/unrelated')
        for axis in ('x', 'y'):
            if values['shaper_type_' + axis] not in ('zv', 'mzv', 'zvd', 'ei', '2hump_ei', '3hump_ei'):
                raise SafetyError('unknown pending shaper type')
            numeric('shaper_freq_' + axis, 0.1, 300)
    else:
        expected = {'version', 'points', 'min_x', 'max_x', 'min_y', 'max_y',
                    'x_count', 'y_count', 'mesh_x_pps', 'mesh_y_pps', 'algo', 'tension'}
        if set(values) != expected or values['version'] != '1' or values['algo'] not in ('lagrange', 'bicubic'):
            raise SafetyError('mesh pending keys/version/algorithm unknown')
        x_count = numeric('x_count', 3, 64, integer=True)
        y_count = numeric('y_count', 3, 64, integer=True)
        for axis in ('x', 'y'):
            if numeric('min_' + axis, -1000, 1000) >= numeric('max_' + axis, -1000, 1000):
                raise SafetyError('mesh extent invalid')
            numeric('mesh_' + axis + '_pps', 0, 16, integer=True)
        numeric('tension', 0, 2)
        rows = values['points'].strip().splitlines()
        if len(rows) != y_count:
            raise SafetyError('mesh point row count invalid')
        for row in rows:
            entries = row.split(',')
            if len(entries) != x_count:
                raise SafetyError('mesh point column count invalid')
            for entry in entries:
                try:
                    value = float(entry.strip())
                except ValueError as exc:
                    raise SafetyError('mesh point value invalid') from exc
                if not math.isfinite(value) or not -10 <= value <= 10:
                    raise SafetyError('mesh point outside conservative bounds')
    return items


def snapshot(pending_operation=None):
    """All omissions/unknown states fail closed; diagnostics issue no G-code."""
    started = time.monotonic()
    try:
        info = get_json('/printer/info', timeout=2)['result']
        if info['state'] != 'ready':
            raise SafetyError('Klipper not ready')
        process = process_identity(info)
        initial = query_objects(BASE_OBJECTS)['result']['status']
        heaters = initial['heaters']['available_heaters']
        if (not isinstance(heaters, list) or not {'extruder', 'heater_bed'}.issubset(heaters)
                or any(not isinstance(name, str) or not name for name in heaters)
                or len(heaters) != len(set(heaters))):
            raise SafetyError('unknown heater inventory')
        result = query_objects(tuple(BASE_OBJECTS) + tuple(heaters))['result']
        status = result['status']
        if status['heaters']['available_heaters'] != heaters:
            raise SafetyError('heater inventory changed')
        eventtime = number(result['eventtime'], 'eventtime')
        if eventtime < 0 or status['webhooks']['state'] != 'ready':
            raise SafetyError('Klipper state unknown')
        if status['print_stats']['state'] not in ('standby', 'complete'):
            raise SafetyError('job active, paused, failed or unknown')
        if status['idle_timeout']['state'] not in ('Idle', 'Ready'):
            raise SafetyError('motion/macro active or unknown')
        if status['virtual_sdcard']['is_active'] is not False:
            raise SafetyError('SD job active or unknown')
        if status['pause_resume']['is_paused'] is not False:
            raise SafetyError('paused or unknown')
        temperatures = {}
        for name in heaters:
            heater = status[name]
            temperatures[name] = number(heater['temperature'], name + '.temperature')
            if (number(heater['target'], name + '.target') != 0
                    or number(heater['power'], name + '.power') != 0
                    or not 0 <= temperatures[name] <= MAX_COOL_TEMP):
                raise SafetyError('heater on, hot or unknown: ' + name)
        queue = get_json('/server/job_queue/status', timeout=2)['result']
        if queue['queued_jobs'] != [] or queue['queue_state'] not in ('ready', 'paused'):
            raise SafetyError('job queued/transitioning or queue unknown')
        config = status['configfile']['config']
        if not isinstance(config, dict) or not config:
            raise SafetyError('configuration inventory unknown')
        forbidden = {'G28', 'M400', 'SHAPER_CALIBRATE', 'BED_MESH_CALIBRATE',
                     'BED_MESH_PROFILE', 'PROBE_ACCURACY', 'SAVE_CONFIG'}
        for section in config:
            if not isinstance(section, str):
                raise SafetyError('configuration section unknown')
            if section.lower().startswith('delayed_gcode '):
                raise SafetyError('scheduled macro status cannot be proven idle')
            if section.lower() == 'homing_override':
                raise SafetyError('G28 overridden by homing_override')
            if section.lower().startswith('gcode_macro ') and section.split(' ', 1)[1].upper() in forbidden:
                raise SafetyError('calibration command overridden by macro')
        positions = []
        for name in ('toolhead', 'gcode_move'):
            position = status[name]['position']
            if not isinstance(position, list) or len(position) < 3:
                raise SafetyError('position unknown')
            positions.append(tuple(number(value, name + '.position') for value in position))
        sd = status['virtual_sdcard']
        filename = status['print_stats']['filename']
        if not isinstance(filename, str) or (sd['file_path'] is not None and not isinstance(sd['file_path'], str)):
            raise SafetyError('job/SD identity unknown')
        file_position = number(sd['file_position'], 'SD position')
        file_size = number(sd['file_size'], 'SD size')
        if file_size < 0 or not 0 <= file_position <= file_size:
            raise SafetyError('SD position/size invalid')
        fingerprint = (process, status['print_stats']['state'], status['print_stats']['filename'],
                       tuple(positions), sd['file_path'], file_position,
                       file_size, tuple(heaters), json.dumps(config, sort_keys=True))
        if time.monotonic() - started > MAX_SAMPLE_DURATION:
            raise SafetyError('state observation too slow')
        return {'eventtime': eventtime, 'fingerprint': fingerprint,
                'observed_at': time.monotonic(), 'temperatures': temperatures,
                'pending': validate_pending(status['configfile'], pending_operation)}
    except (KeyError, TypeError, ValueError) as exc:
        raise SafetyError('required safety field missing or invalid') from exc


def observe_idle():
    """Five minutes of consecutive fresh observations, never persisted across runs."""
    first = snapshot()
    start = previous_time = time.monotonic()
    previous = first
    while time.monotonic() - start < MIN_IDLE_SEC:
        time.sleep(POLL_SEC)
        current = snapshot()
        now = time.monotonic()
        if now - previous_time > MAX_SAMPLE_GAP:
            raise SafetyError('observation gap; idle duration unproven')
        if current['eventtime'] <= previous['eventtime']:
            raise SafetyError('stale/restarted status observation')
        if current['fingerprint'] != first['fingerprint']:
            raise SafetyError('job, position, process or config changed during idle observation')
        if any(current['temperatures'][name] > first['temperatures'][name] + 2
               for name in first['temperatures']):
            raise SafetyError('temperature rising during idle observation')
        previous, previous_time = current, now
    return previous


def config_age(required):
    if not PRINTER_CFG.exists():
        return None
    text = PRINTER_CFG.read_text()
    if not all(marker in text for marker in required):
        return None
    age = time.time() - PRINTER_CFG.stat().st_mtime
    if age < 0:
        raise SafetyError('configuration timestamp is in the future')
    return int(age)


def shaper_age_seconds():
    return config_age(('shaper_freq_x', 'shaper_freq_y'))


def bed_mesh_age_seconds():
    return config_age(('bed_mesh default',))


def eligible_operation(force=False):
    value = state()
    if 'pending' in value:
        raise SafetyError('previous calibration outcome unresolved; operator review required')
    if not weekly_cap_ok():
        return None, 'weekly cap reached (%d per rolling seven days)' % MAX_PER_WEEK
    age = shaper_age_seconds()
    if force or age is None or age > SHAPER_STALE:
        return 'shaper_calibrate', 'shaper missing, stale or freshness override requested'
    age = bed_mesh_age_seconds()
    if age is None or age > MESH_STALE:
        return 'bed_mesh', 'mesh missing or stale'
    try:
        last = datetime.fromisoformat(value.get('last_probe_check', '1970-01-01'))
        if last.tzinfo is not None or last > datetime.now():
            raise SafetyError('probe timestamp unknown/future')
    except (ValueError, TypeError) as exc:
        raise SafetyError('probe timestamp invalid') from exc
    if (datetime.now() - last).days >= 7:
        return 'probe_accuracy', 'weekly probe repeatability check due'
    return None, 'calibrations fresh'


def _checked_command(script, before, timeout, pending_operation):
    current = snapshot(pending_operation)
    if (current['fingerprint'] != before['fingerprint']
            or current['eventtime'] <= before['eventtime']
            or current['pending'] != before['pending']):
        raise SafetyError('state changed before command')
    result = post_gcode(script, timeout=timeout)
    if not isinstance(result, dict) or 'error' in result or result.get('result') != 'ok':
        raise SafetyError('command completion not acknowledged')
    after = snapshot(pending_operation)
    if (after['fingerprint'] != current['fingerprint']
            or after['eventtime'] <= current['eventtime']
            or after['pending'] != current['pending']):
        raise SafetyError('state changed after command')
    return after


def run_operation(operation, maintenance_approved=False):
    """No public routine can skip approval, cap, five-minute gate or process lock."""
    if not maintenance_approved or _lock_fd is None:
        raise SafetyError('explicit maintenance approval and process lock required')
    if operation not in COMMANDS:
        raise SafetyError('unknown operation')
    if 'pending' in state() or not weekly_cap_ok():
        raise SafetyError('unresolved attempt or weekly cap reached')
    observed = observe_idle()
    backup = backup_cfg() if operation != 'probe_accuracy' else None
    before = snapshot()
    if (before['fingerprint'] != observed['fingerprint']
            or before['eventtime'] <= observed['eventtime']
            or before['observed_at'] - observed['observed_at'] > MAX_SAMPLE_GAP):
        raise SafetyError('state changed during backup')
    value = state()
    timestamp = datetime.now().isoformat()
    value.setdefault('runs', []).append({'ts': timestamp, 'op': operation, 'ok': False})
    value['runs'] = value['runs'][-50:]
    value['pending'] = {'ts': timestamp, 'op': operation, 'backup': str(backup) if backup else None}
    # Persist uncertainty BEFORE dispatch. A crash cannot authorize an automatic retry.
    save_state(value)
    try:
        current = snapshot()
        if (current['fingerprint'] != before['fingerprint']
                or current['eventtime'] <= before['eventtime']
                or current['observed_at'] - before['observed_at'] > MAX_SAMPLE_GAP):
            raise SafetyError('state changed before motion')
        response = post_gcode('G28\n' + COMMANDS[operation] + '\nM400', timeout=OP_TIMEOUT)
        if not isinstance(response, dict) or 'error' in response or response.get('result') != 'ok':
            raise SafetyError('motion completion not acknowledged')
        after = snapshot(operation)
        # Motion legitimately changes position; every other precondition must still hold.
        old = before['fingerprint']
        new = after['fingerprint']
        if new[:3] != old[:3] or new[4:] != old[4:] or after['eventtime'] <= current['eventtime']:
            raise SafetyError('job/process/config changed during operation')
        if operation == 'bed_mesh':
            after = _checked_command('BED_MESH_PROFILE SAVE=default\nM400', after, 30, operation)
        if operation != 'probe_accuracy':
            # SAVE_CONFIG restarts Klipper. Verify readiness first; never retry save.
            current = snapshot(operation)
            if (current['fingerprint'] != after['fingerprint']
                    or current['eventtime'] <= after['eventtime']
                    or current['pending'] != after['pending']):
                raise SafetyError('state changed before configuration save')
            response = post_gcode('SAVE_CONFIG', timeout=30)
            if not isinstance(response, dict) or 'error' in response or response.get('result') != 'ok':
                raise SafetyError('configuration save outcome unknown')
        value = state()
        value['runs'][-1]['ok'] = True
        value.pop('pending')
        if operation == 'probe_accuracy':
            value['last_probe_check'] = datetime.now().isoformat()
        save_state(value)
        log(operation + ': acknowledged complete' + ('; SAVE_CONFIG restart requested' if backup else ''))
        return True
    except Exception:
        # No retries, save, restart, M112, or additional motion after any failure.
        log(operation + ': failed/unknown; pending record retained; operator review required')
        raise


def run_shaper_calibrate(maintenance_approved=False):
    return run_operation('shaper_calibrate', maintenance_approved)


def run_bed_mesh(maintenance_approved=False):
    return run_operation('bed_mesh', maintenance_approved)


def run_probe_accuracy(maintenance_approved=False):
    return run_operation('probe_accuracy', maintenance_approved)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force', '-f', action='store_true', help='ignore calibration age only; never bypass safety/cap')
    parser.add_argument('--maintenance-approved', '--maintenance', action='store_true',
                        help='operator confirms clear bed, exclusive controls and no scheduled/external macros for this run')
    args = parser.parse_args(argv)
    try:
        if not acquire_lock():
            log('another helper holds the process lock; skipping')
            return 0
        operation, reason = eligible_operation(args.force)
        log('schedule candidate: %s; operation=%s; maintenance availability unverified' % (reason, operation or 'none'))
        snapshot()
        if not args.maintenance_approved:
            log('read-only tick; maintenance approval absent; no motion/save/restart')
            return 0
        if operation:
            run_operation(operation, maintenance_approved=True)
        return 0
    except SafetyError as exc:
        log('blocked: ' + str(exc))
        return 3
    except Exception as exc:
        log('blocked: local/transport failure (%s)' % type(exc).__name__)
        return 3
    finally:
        release_lock()


if __name__ == '__main__':
    sys.exit(main())

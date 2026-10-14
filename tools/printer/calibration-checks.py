#!/opt/bin/python3
"""Hourly calibration diagnostics. No printer-control or configuration writes.

Deploy only after the documented identity, idle and backup checks. The separate
auto-optimize.py maintenance draft is not installed with this file. --check
prints a report without creating a lock or appending a log.
"""
import argparse
import fcntl
import json
import math
import os
import socket
import stat
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

LOG_FILE = Path('/usr/data/auto-optimize.log')
LOCKFILE = Path('/tmp/auto-optimize-checks.lock')
STATE_FILE = Path('/usr/data/auto-optimize.state.json')
PRINTER_CFG = Path('/usr/data/printer_data/config/printer.cfg')
MAX_BYTES = 2 * 1024 * 1024
MAX_HEADERS = 32768
INFO_PATH = '/printer/info'
STATUS_PATH = (
    '/printer/objects/query?webhooks=state&print_stats=state&idle_timeout=state'
    '&virtual_sdcard=is_active&pause_resume=is_paused&heaters=available_heaters'
    '&extruder=target,power,temperature&heater_bed=target,power,temperature'
    '&configfile=config,save_config_pending,save_config_pending_items'
)
QUEUE_PATH = '/server/job_queue/status'
READ_PATHS = (INFO_PATH, STATUS_PATH, QUEUE_PATH)
_lock_fd = None


class CheckError(Exception):
    pass


class HistoryReview(CheckError):
    pass


def unique_pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise CheckError('duplicate JSON field')
        value[key] = item
    return value


def read_json(payload):
    def integer(token):
        if len(token.lstrip('-')) > 19:
            raise CheckError('JSON integer outside supported range')
        value = int(token)
        if abs(value) > 2 ** 63 - 1:
            raise CheckError('JSON integer outside supported range')
        return value

    def decimal(token):
        value = float(token)
        if not math.isfinite(value):
            raise CheckError('non-finite JSON number')
        return value

    try:
        value = json.loads(payload.decode('utf-8'), object_pairs_hook=unique_pairs,
                           parse_int=integer, parse_float=decimal,
                           parse_constant=lambda _: (_ for _ in ()).throw(CheckError('non-finite JSON')))
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise CheckError('invalid JSON') from exc
    if not isinstance(value, dict):
        raise CheckError('JSON object required')
    return value


def parse_http(raw):
    if len(raw) > MAX_BYTES:
        raise CheckError('response too large')
    split = raw.find(b'\r\n\r\n')
    if split < 0 or split > MAX_HEADERS:
        raise CheckError('missing or oversized headers')
    try:
        lines = raw[:split].decode('ascii').split('\r\n')
        version, status, _ = lines[0].split(' ', 2)
        if version not in ('HTTP/1.0', 'HTTP/1.1') or status != '200':
            raise CheckError('HTTP status unavailable')
        headers = {}
        for line in lines[1:]:
            key, value = line.split(':', 1)
            key = key.lower()
            if not key or key in headers or key.strip() != key:
                raise CheckError('ambiguous headers')
            headers[key] = value.strip().lower()
    except (ValueError, UnicodeError) as exc:
        raise CheckError('invalid headers') from exc
    if headers.get('content-encoding', 'identity') != 'identity':
        raise CheckError('unsupported encoding')
    payload = raw[split + 4:]
    if 'transfer-encoding' in headers:
        if headers['transfer-encoding'] != 'chunked' or 'content-length' in headers:
            raise CheckError('ambiguous framing')
        output = bytearray()
        offset = 0
        while True:
            end = payload.find(b'\r\n', offset)
            if end < 0 or end - offset > 128:
                raise CheckError('invalid chunk header')
            token = payload[offset:end]
            if not token or any(c not in b'0123456789abcdefABCDEF' for c in token):
                raise CheckError('invalid chunk length')
            size = int(token, 16)
            offset = end + 2
            if size == 0:
                if payload[offset:] != b'\r\n':
                    raise CheckError('invalid chunk terminator')
                payload = bytes(output)
                break
            if size > MAX_BYTES or offset + size + 2 > len(payload):
                raise CheckError('truncated chunk')
            if payload[offset + size:offset + size + 2] != b'\r\n':
                raise CheckError('invalid chunk boundary')
            output.extend(payload[offset:offset + size])
            offset += size + 2
    elif 'content-length' in headers:
        length = headers['content-length']
        if not length.isdigit() or int(length) != len(payload):
            raise CheckError('invalid or truncated length')
    else:
        raise CheckError('unframed response')
    value = read_json(payload)
    if 'error' in value or not isinstance(value.get('result'), dict):
        raise CheckError('API result unavailable')
    return value['result']


def get_json(path, timeout=4):
    # No method/body argument, redirects, retries or caller-supplied endpoint.
    if path not in READ_PATHS:
        raise CheckError('read path not allowed')
    deadline = time.monotonic() + timeout
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        def remaining():
            left = deadline - time.monotonic()
            if left <= 0:
                raise CheckError('read deadline exceeded')
            sock.settimeout(left)
        remaining()
        sock.connect(('127.0.0.1', 80))
        remaining()
        sock.sendall(('GET %s HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n' % path).encode('ascii'))
        raw = bytearray()
        while True:
            remaining()
            part = sock.recv(min(8192, MAX_BYTES + 1 - len(raw)))
            if not part:
                break
            raw.extend(part)
            if len(raw) > MAX_BYTES:
                raise CheckError('response too large')
        return parse_http(bytes(raw))
    except OSError as exc:
        raise CheckError('read failed') from exc
    finally:
        sock.close()


def bounded_read(path):
    with path.open('rb') as stream:
        value = stream.read(MAX_BYTES + 1)
    if len(value) > MAX_BYTES:
        raise CheckError('local history/configuration too large')
    return value


def schedule_candidate(force=False):
    """Read historic scheduling hints without recording an attempt or success."""
    value = read_json(bounded_read(STATE_FILE)) if STATE_FILE.exists() else {}
    runs = value.get('runs', [])
    if not isinstance(runs, list) or len(runs) > 50:
        raise CheckError('history unavailable')
    now = datetime.now()
    timestamps = []
    for run in runs:
        if not isinstance(run, dict) or not isinstance(run.get('ts'), str):
            raise CheckError('invalid history entry')
        stamp = datetime.fromisoformat(run['ts'])
        if stamp.tzinfo is not None or stamp > now:
            raise CheckError('unknown/future history timestamp')
        timestamps.append(stamp)
    if 'pending' in value:
        raise HistoryReview('previous outcome needs operator review')
    if sum(stamp > now - timedelta(days=7) for stamp in timestamps) >= 1:
        return None, 'rolling seven-day cap reached'
    text = bounded_read(PRINTER_CFG).decode('utf-8') if PRINTER_CFG.exists() else ''
    age = time.time() - PRINTER_CFG.stat().st_mtime if text else None
    if age is not None and age < 0:
        raise CheckError('configuration timestamp is in the future')
    if force or age is None or age > 90 * 86400 or not all(k in text for k in ('shaper_freq_x', 'shaper_freq_y')):
        return 'shaper', 'saved values missing/stale; file timestamp is only a freshness estimate'
    if age > 30 * 86400 or 'bed_mesh default' not in text:
        return 'mesh', 'saved mesh missing/stale; file timestamp is only a freshness estimate'
    last = value.get('last_probe_check', '1970-01-01')
    if not isinstance(last, str):
        raise CheckError('probe history unavailable')
    stamp = datetime.fromisoformat(last)
    if stamp.tzinfo is not None or stamp > now:
        raise CheckError('unknown/future probe timestamp')
    if (now - stamp).days >= 7:
        return 'probe', 'weekly repeatability check due'
    return None, 'historic scheduling hints are current'


def finite(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def collect_report(force=False):
    issues = []
    results = {}
    for path, label in zip(READ_PATHS, ('info', 'objects', 'queue')):
        try:
            value = get_json(path)
            if not isinstance(value, dict):
                raise CheckError('API object required')
            results[label] = value
        except (CheckError, ValueError, TypeError):
            issues.append(label + ' unavailable')
            results[label] = {}
    info, objects, queue = (results[k] for k in ('info', 'objects', 'queue'))
    status = objects.get('status', {})
    if not isinstance(status, dict):
        status = {}

    def field(name, key):
        value = status.get(name)
        return value.get(key) if isinstance(value, dict) else None

    pid = info.get('process_id')
    if type(pid) is not int or not 0 < pid <= 2 ** 31 - 1:
        issues.append('maintenance process identity unavailable')
    idle = (info.get('state') == 'ready' and field('webhooks', 'state') == 'ready'
            and field('print_stats', 'state') in ('standby', 'complete')
            and field('idle_timeout', 'state') in ('Idle', 'Ready')
            and field('virtual_sdcard', 'is_active') is False
            and field('pause_resume', 'is_paused') is False)
    if not idle:
        issues.append('printer busy or idle state unavailable')
    inventory = field('heaters', 'available_heaters')
    cool = (isinstance(inventory, list) and all(isinstance(name, str) for name in inventory)
            and len(inventory) == 2 and set(inventory) == {'extruder', 'heater_bed'})
    for name in ('extruder', 'heater_bed'):
        temperature, target, power = (field(name, k) for k in ('temperature', 'target', 'power'))
        cool = cool and finite(temperature) and 0 <= temperature <= 50 and finite(target) and target == 0 and finite(power) and power == 0
    if not cool:
        issues.append('heater active, hot or inventory/state unavailable')
    empty_queue = (queue.get('queued_jobs') == [] and queue.get('queue_state') in ('ready', 'paused'))
    if not empty_queue:
        issues.append('job queued, transitioning or queue unavailable')
    config = field('configfile', 'config')
    if not isinstance(config, dict) or not config:
        issues.append('configuration inventory unavailable')
    else:
        sections = [name.lower() for name in config]
        if 'homing_override' in sections:
            issues.append('vendor homing override requires separate maintenance review')
        commands = {'g28', 'm400', 'shaper_calibrate', 'bed_mesh_calibrate', 'bed_mesh_profile', 'probe_accuracy', 'save_config'}
        if any(name.startswith('gcode_macro ') and name[12:] in commands for name in sections):
            issues.append('vendor calibration macros require separate maintenance review')
        if any(name.startswith('delayed_gcode ') for name in sections):
            issues.append('scheduled macro inactivity unproven')
    pending, items = (field('configfile', k) for k in ('save_config_pending', 'save_config_pending_items'))
    if type(pending) is not bool or not isinstance(items, dict) or pending != bool(items):
        issues.append('pending configuration state unavailable')
    elif pending:
        issues.append('unsaved configuration retained for operator review')
    try:
        candidate, reason = schedule_candidate(force)
    except HistoryReview:
        candidate, reason = None, 'previous outcome needs operator review'
        issues.append(reason)
    except (CheckError, OSError, ValueError, TypeError):
        candidate, reason = None, 'historic scheduling hints unavailable'
        issues.append(reason)
    return {'mode': 'checks-only', 'candidate': candidate, 'schedule': reason,
            'idle_snapshot': bool(idle), 'cool_snapshot': bool(cool), 'queue_empty': bool(empty_queue),
            'maintenance': 'disabled; use existing printer controls', 'issues': issues}


def acquire_lock():
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


def append_log(line):
    # Do not create a missing log or follow a redirected/hard-linked log path.
    original = LOG_FILE.lstat()
    if not stat.S_ISREG(original.st_mode) or original.st_nlink != 1:
        raise CheckError('log is not an existing independent regular file')
    fd = os.open(str(LOG_FILE), os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'a') as stream:
        current = os.fstat(stream.fileno())
        if (not stat.S_ISREG(current.st_mode) or current.st_nlink != 1
                or (original.st_dev, original.st_ino) != (current.st_dev, current.st_ino)):
            raise CheckError('log destination changed')
        stream.write(line)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', '--dry-run', action='store_true', help='stdout report only; no lock/log writes')
    parser.add_argument('--force', '-f', action='store_true', help='age hint override only; performs no calibration')
    args = parser.parse_args(argv)
    owns_lock = False
    try:
        if not args.check:
            owns_lock = acquire_lock()
            if not owns_lock:
                return 0
        report = collect_report(args.force)
        line = datetime.now().isoformat(timespec='seconds') + ' ' + json.dumps(report, allow_nan=False) + '\n'
        if not args.check:
            append_log(line)
        print(line, end='')
        return 0 if not report['issues'] else 3
    except (CheckError, OSError, ValueError, TypeError):
        print('checks-only: report unavailable; no printer action performed')
        return 3
    finally:
        if owns_lock:
            release_lock()


if __name__ == '__main__':
    sys.exit(main())

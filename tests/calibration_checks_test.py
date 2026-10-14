"""Checks-only helper safety tests. Real sockets are prohibited."""
import ast
import contextlib
import copy
import importlib.util
import io
import json
import multiprocessing
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'tools/printer/calibration-checks.py'
SPEC = importlib.util.spec_from_file_location('calibration_checks', SOURCE)
checks = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checks)


def fixture():
    return {
        'info': {'state': 'ready', 'process_id': 22},
        'objects': {'status': {
            'webhooks': {'state': 'ready'}, 'print_stats': {'state': 'complete'},
            'idle_timeout': {'state': 'Idle'}, 'virtual_sdcard': {'is_active': False},
            'pause_resume': {'is_paused': False},
            'heaters': {'available_heaters': ['extruder', 'heater_bed']},
            'extruder': {'temperature': 25, 'target': 0, 'power': 0},
            'heater_bed': {'temperature': 25, 'target': 0, 'power': 0},
            'configfile': {'config': {'printer': {}}, 'save_config_pending': False,
                           'save_config_pending_items': {}},
        }},
        'queue': {'queued_jobs': [], 'queue_state': 'paused'},
    }


def response(value, status='200 OK', headers=None):
    body = value if isinstance(value, bytes) else json.dumps({'result': value}).encode()
    headers = headers if headers is not None else ['Content-Length: %d' % len(body)]
    return ('HTTP/1.1 ' + status + '\r\n' + '\r\n'.join(headers) + '\r\n\r\n').encode() + body


class FakeSocket:
    def __init__(self, raw):
        self.raw = raw
        self.sent = b''
        self.closed = False

    def settimeout(self, timeout):
        self.timeout = timeout

    def connect(self, address):
        self.address = address

    def sendall(self, data):
        self.sent += data

    def recv(self, size):
        part, self.raw = self.raw[:size], self.raw[size:]
        return part

    def close(self):
        self.closed = True


def child_lock_attempt(path, pipe):
    import fcntl
    fd = os.open(path, os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        pipe.send(True)
    except BlockingIOError:
        pipe.send(False)
    finally:
        os.close(fd)
        pipe.close()


class ChecksOnlyTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        for name, filename in [('LOG_FILE', 'log'), ('LOCKFILE', 'lock'),
                               ('STATE_FILE', 'state'), ('PRINTER_CFG', 'printer.cfg')]:
            self.enterContext(patch.object(checks, name, self.root / filename))
        self.enterContext(patch.object(checks.socket, 'socket', side_effect=AssertionError('real sockets prohibited')))
        self.addCleanup(checks.release_lock)
        checks.STATE_FILE.write_text('{}')
        checks.PRINTER_CFG.write_text('shaper_freq_x = 40\nshaper_freq_y = 40\n[bed_mesh default]\n')
        checks.LOG_FILE.write_text('')
        self.values = fixture()

    def install_reads(self):
        return self.enterContext(patch.object(checks, 'get_json', side_effect=lambda path:
            self.values[dict(zip(checks.READ_PATHS, ('info', 'objects', 'queue')))[path]]))

    def test_wire_allows_only_three_literal_gets(self):
        for path in checks.READ_PATHS:
            with self.subTest(path=path):
                sock = FakeSocket(response({'state': 'ready'}))
                with patch.object(checks.socket, 'socket', return_value=sock):
                    checks.get_json(path)
                self.assertEqual(sock.address, ('127.0.0.1', 80))
                self.assertEqual(sock.sent, ('GET %s HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n' % path).encode())
                self.assertTrue(sock.closed)

    def test_other_paths_fail_before_any_socket(self):
        for path in ('/printer/gcode/script', '/printer/restart',
                     checks.STATUS_PATH + '&script=G28', 'http://example.com', '', None):
            with self.subTest(path=path), self.assertRaises(checks.CheckError):
                checks.get_json(path)

    def test_no_retry_or_redirect_on_failure(self):
        for raw in (response({}, '302 Found'), response({}, '500 Error'), response(b'not JSON')):
            sock = FakeSocket(raw)
            with patch.object(checks.socket, 'socket', return_value=sock) as factory:
                with self.assertRaises(checks.CheckError):
                    checks.get_json(checks.INFO_PATH)
            self.assertEqual(factory.call_count, 1)
            self.assertTrue(sock.closed)

    def test_invalid_transport_never_produces_status(self):
        for raw in (
                response(b'{"result":{"x":1,"x":2}}'),
                response(b'{"result":{"x":NaN}}'),
                response(b'{"error":{},"result":{}}'),
                response(b'{"result":null}'),
                response(b'{}', headers=['Content-Length: 20']),
                response(b'{}', headers=['Content-Length: 2', 'Content-Length: 2']),
                response(b'{}', headers=[]),
                response(b'{}', headers=['Transfer-Encoding: chunked', 'Content-Length: 2']),
                response(b'0\r\n', headers=['Transfer-Encoding: chunked']),
                response(b'0\r\n\r\nextra', headers=['Transfer-Encoding: chunked']),
                response(b'2\r\nx\r\n0\r\n\r\n', headers=['Transfer-Encoding: chunked'])):
            with self.subTest(raw=raw), self.assertRaises(checks.CheckError):
                checks.parse_http(raw)
        with patch.object(checks, 'MAX_BYTES', 20), self.assertRaises(checks.CheckError):
            checks.parse_http(b'x' * 21)

    def test_valid_chunked_status(self):
        body = b'{"result":{"state":"ready"}}'
        framed = b'%x\r\n' % len(body) + body + b'\r\n0\r\n\r\n'
        self.assertEqual(checks.parse_http(response(framed, headers=['Transfer-Encoding: chunked'])), {'state': 'ready'})

    def test_socket_timeout_closes_without_retry(self):
        sock = FakeSocket(b'')
        with patch.object(sock, 'recv', side_effect=socket.timeout), \
                patch.object(checks.socket, 'socket', return_value=sock) as factory:
            with self.assertRaises(checks.CheckError):
                checks.get_json(checks.INFO_PATH)
        self.assertEqual(factory.call_count, 1)
        self.assertTrue(sock.closed)

    def test_entire_read_deadline_is_bounded(self):
        sock = FakeSocket(response({}))
        with patch.object(checks.socket, 'socket', return_value=sock), \
                patch.object(checks.time, 'monotonic', side_effect=(0, 1, 2, 5)):
            with self.assertRaisesRegex(checks.CheckError, 'deadline'):
                checks.get_json(checks.INFO_PATH)
        self.assertTrue(sock.closed)

    def test_slow_drip_response_cannot_extend_deadline(self):
        sock = FakeSocket(response({}))
        original_recv = sock.recv
        with patch.object(sock, 'recv', side_effect=lambda _: original_recv(1)) as recv, \
                patch.object(checks.socket, 'socket', return_value=sock), \
                patch.object(checks.time, 'monotonic', side_effect=(0, .1, .2, .3, 2, 3, 4.1)):
            with self.assertRaisesRegex(checks.CheckError, 'deadline'):
                checks.get_json(checks.INFO_PATH)
        self.assertEqual(recv.call_count, 3)
        self.assertTrue(sock.closed)

    def test_numeric_and_nesting_limits_become_unknown_status(self):
        for payload in (b'{"result":{"x":' + b'9' * 400 + b'}}',
                        b'{"result":{"x":1e400}}',
                        b'{"result":' + b'[' * 1200 + b'0' + b']' * 1200 + b'}'):
            with self.subTest(payload=payload[:80]), self.assertRaises(checks.CheckError):
                checks.parse_http(response(payload))
        self.assertFalse(checks.finite(10 ** 400))
        self.install_reads()
        self.values['objects']['status']['extruder']['temperature'] = 10 ** 400
        self.assertFalse(checks.collect_report()['cool_snapshot'])

    def test_check_mode_does_not_write_any_file(self):
        get = self.install_reads()
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.iterdir()}
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(checks.main(['--check']), 0)
        after = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.iterdir()}
        self.assertEqual(after, before)
        self.assertEqual(get.call_count, 3)
        self.assertIn('checks-only', output.getvalue())

    def test_observed_k1_is_reported_without_skipping_other_checks(self):
        self.values['info'].pop('process_id')
        config = self.values['objects']['status']['configfile']
        config['config'].update({'homing_override': {}, 'gcode_macro BED_MESH_CALIBRATE': {},
                                 'delayed_gcode LOAD_GCODE_OFFSETS': {}})
        config.update(save_config_pending=True, save_config_pending_items={'bed_mesh default': {}, 'bed_mesh adaptive': {}})
        get = self.install_reads()
        before = copy.deepcopy(self.values)
        report = checks.collect_report()
        self.assertTrue(report['idle_snapshot'])
        self.assertTrue(report['cool_snapshot'])
        self.assertTrue(report['queue_empty'])
        self.assertEqual(len(report['issues']), 5)
        self.assertEqual(get.call_count, 3)
        self.assertEqual(self.values, before)
        self.assertIn('disabled', report['maintenance'])

    def test_busy_unknown_thermal_and_queue_states_are_honest(self):
        self.install_reads()
        original = copy.deepcopy(self.values)
        cases = [('print_stats', 'state', 'printing'), ('idle_timeout', 'state', 'Printing'),
                 ('virtual_sdcard', 'is_active', True), ('pause_resume', 'is_paused', True),
                 ('extruder', 'target', 200), ('heater_bed', 'power', .1),
                 ('extruder', 'temperature', float('nan')), ('extruder', 'target', False),
                 ('heaters', 'available_heaters', ['extruder', 'heater_bed', 'chamber']),
                 ('heaters', 'available_heaters', ['extruder', 'extruder'])]
        for name, key, value in cases:
            self.values = copy.deepcopy(original)
            self.values['objects']['status'][name][key] = value
            with self.subTest(name=name, key=key):
                self.assertTrue(checks.collect_report()['issues'])
        self.values = copy.deepcopy(original)
        self.values['queue']['queued_jobs'] = [{}]
        self.assertFalse(checks.collect_report()['queue_empty'])
        self.values['queue'] = {}
        self.assertFalse(checks.collect_report()['queue_empty'])

    def test_missing_endpoints_report_unknown_without_fabricating_idle(self):
        with patch.object(checks, 'get_json', side_effect=checks.CheckError('offline')) as get:
            report = checks.collect_report()
        self.assertEqual(get.call_count, 3)
        self.assertFalse(report['idle_snapshot'])
        self.assertFalse(report['cool_snapshot'])
        self.assertFalse(report['queue_empty'])

    def test_force_does_not_clear_pending_history_or_weekly_cap(self):
        from datetime import datetime
        checks.STATE_FILE.write_text('{"pending":{}}')
        with self.assertRaises(checks.HistoryReview):
            checks.schedule_candidate(True)
        self.assertEqual(checks.STATE_FILE.read_text(), '{"pending":{}}')
        checks.STATE_FILE.write_text(json.dumps({'runs': [{'ts': datetime.now().isoformat()}]}))
        before = checks.STATE_FILE.read_bytes()
        self.assertIsNone(checks.schedule_candidate(True)[0])
        self.assertEqual(checks.STATE_FILE.read_bytes(), before)

    def test_unresolved_history_reports_attention_and_nonzero_exit(self):
        self.install_reads()
        checks.STATE_FILE.write_text('{"pending":{}}')
        report = checks.collect_report()
        self.assertIn('previous outcome needs operator review', report['issues'])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(checks.main(['--check', '--force']), 3)
        self.assertEqual(checks.STATE_FILE.read_text(), '{"pending":{}}')

    def test_malformed_local_history_is_not_rewritten(self):
        self.install_reads()
        for value in (b'not JSON', b'{"runs":null}', b'{"runs":[{"ts":"bad"}]}',
                      b'{"last_probe_check":false}', b'{"runs":[{"ts":"2999-01-01"}]}'):
            checks.STATE_FILE.write_bytes(value)
            with self.subTest(value=value):
                self.assertIn('historic scheduling hints unavailable', checks.collect_report()['issues'])
                self.assertEqual(checks.STATE_FILE.read_bytes(), value)
        with patch.object(checks, 'MAX_BYTES', 1), self.assertRaises(checks.CheckError):
            checks.bounded_read(checks.PRINTER_CFG)

    def test_lock_holds_persistent_inode_and_skips_second_tick(self):
        self.install_reads()
        self.assertTrue(checks.acquire_lock())
        inode = checks.LOCKFILE.stat().st_ino
        self.assertFalse(checks.acquire_lock())
        with patch.object(checks, 'collect_report') as report:
            self.assertEqual(checks.main([]), 0)
            report.assert_not_called()
        self.assertEqual(checks.LOCKFILE.stat().st_ino, inode)
        self.assertFalse(checks.acquire_lock())
        checks.release_lock()
        self.assertTrue(checks.acquire_lock())
        checks.release_lock()
        self.assertEqual(checks.LOCKFILE.stat().st_ino, inode)

    def test_lock_excludes_a_different_process(self):
        self.assertTrue(checks.acquire_lock())
        parent, child = multiprocessing.Pipe(duplex=False)
        process = multiprocessing.Process(target=child_lock_attempt, args=(str(checks.LOCKFILE), child))
        process.start()
        try:
            self.assertTrue(parent.poll(3))
            self.assertFalse(parent.recv())
        finally:
            process.join(3)
            if process.is_alive():
                process.terminate()
                process.join()
            parent.close()
            child.close()

    def test_read_only_check_does_not_release_another_invocations_lock(self):
        self.install_reads()
        self.assertTrue(checks.acquire_lock())
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(checks.main(['--check']), 0)
        self.assertFalse(checks.acquire_lock())

    def test_default_appends_log_without_touching_history_or_configuration(self):
        self.install_reads()
        original = {p: p.read_bytes() for p in (checks.STATE_FILE, checks.PRINTER_CFG)}
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(checks.main([]), 0)
        self.assertIn('checks-only', checks.LOG_FILE.read_text())
        for path, value in original.items():
            self.assertEqual(path.read_bytes(), value)

    def test_missing_or_linked_logs_never_create_or_modify_a_destination(self):
        self.install_reads()
        before = checks.PRINTER_CFG.read_bytes()
        checks.LOG_FILE.unlink()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(checks.main([]), 3)
        self.assertFalse(checks.LOG_FILE.exists())
        checks.LOG_FILE.symlink_to(checks.PRINTER_CFG)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(checks.main([]), 3)
        self.assertEqual(checks.PRINTER_CFG.read_bytes(), before)
        checks.LOG_FILE.unlink()
        os.link(checks.PRINTER_CFG, checks.LOG_FILE)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(checks.main([]), 3)
        self.assertEqual(checks.PRINTER_CFG.read_bytes(), before)

    def test_maintenance_arguments_cannot_enable_printer_actions(self):
        with contextlib.redirect_stderr(io.StringIO()), patch.object(checks, 'get_json') as get:
            with self.assertRaises(SystemExit) as exit_result:
                checks.main(['--maintenance-approved'])
        self.assertEqual(exit_result.exception.code, 2)
        get.assert_not_called()
        self.assertFalse(checks.LOCKFILE.exists())
        # Production code has no subprocess/exec or general network-write API.
        tree = ast.parse(SOURCE.read_text())
        imports = {node.name for node in ast.walk(tree) if isinstance(node, ast.alias)}
        self.assertFalse(imports & {'subprocess', 'urllib', 'http', 'requests'})
        calls = {node.func.id for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
        self.assertFalse(calls & {'exec', 'eval', 'compile', 'post_gcode', 'save_state', 'backup_cfg'})


if __name__ == '__main__':
    unittest.main()

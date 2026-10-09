"""Offline fault injection only. Network is prohibited for the entire suite."""
import copy
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'tools/printer/auto-optimize.py'
SPEC = importlib.util.spec_from_file_location('auto_optimize', SOURCE)
optimizer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(optimizer)


def status_fixture():
    return {
        'eventtime': 1,
        'status': {
            'webhooks': {'state': 'ready'},
            'print_stats': {'state': 'standby', 'filename': ''},
            'idle_timeout': {'state': 'Idle'},
            'virtual_sdcard': {'is_active': False, 'file_path': None, 'file_position': 0, 'file_size': 0},
            'pause_resume': {'is_paused': False},
            'toolhead': {'position': [0, 0, 0, 0]},
            'gcode_move': {'position': [0, 0, 0, 0]},
            'heaters': {'available_heaters': ['extruder', 'heater_bed']},
            'configfile': {'config': {'printer': {'kinematics': 'corexy'}},
                           'save_config_pending': False, 'save_config_pending_items': {}},
            'extruder': {'target': 0, 'power': 0, 'temperature': 25},
            'heater_bed': {'target': 0, 'power': 0, 'temperature': 25},
        },
    }


def http(payload, status='200 OK', headers=None):
    if not isinstance(payload, bytes):
        payload = json.dumps(payload).encode()
    headers = headers if headers is not None else ['Content-Length: %d' % len(payload)]
    return ('HTTP/1.1 ' + status + '\r\n' + '\r\n'.join(headers) + '\r\n\r\n').encode() + payload


class FakeClock:
    def __init__(self):
        self.now = 0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def child_lock_attempt(path, connection):
    """A different process must not acquire an inode locked by the parent."""
    import fcntl
    fd = os.open(path, os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        connection.send(True)
    except BlockingIOError:
        connection.send(False)
    finally:
        os.close(fd)
        connection.close()


class OfflineCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        for name, suffix in [('STATE_FILE', 'state.json'), ('LOCKFILE', 'lock'),
                             ('PRINTER_CFG', 'printer.cfg'), ('BACKUP_DIR', 'backups')]:
            self.enterContext(patch.object(optimizer, name, Path(self.temp.name) / suffix))
        self.enterContext(patch.object(optimizer, 'log'))
        self.enterContext(patch.object(optimizer.socket, 'socket', side_effect=AssertionError('real network prohibited')))
        self.addCleanup(optimizer.release_lock)

    def install_snapshot_fixture(self, fixture=None, queue=None):
        self.fixture = fixture or status_fixture()
        self.queue = queue or {'queued_jobs': [], 'queue_state': 'ready'}
        def get(path, timeout=10):
            if path == '/printer/info':
                return {'result': {'state': 'ready', 'process_id': 22}}
            if path == '/server/job_queue/status':
                return {'result': self.queue}
            raise AssertionError(path)
        self.enterContext(patch.object(optimizer, 'get_json', side_effect=get))
        self.enterContext(patch.object(optimizer, 'query_objects', side_effect=lambda _: {'result': self.fixture}))


class HTTPTests(OfflineCase):
    def test_success(self):
        self.assertEqual(optimizer.parse_http(http({'result': 'ok'})), {'result': 'ok'})

    def test_valid_chunked(self):
        payload = b'{"result":"ok"}'
        framed = b'%x\r\n' % len(payload) + payload + b'\r\n0\r\n\r\n'
        self.assertEqual(optimizer.parse_http(http(framed, headers=['Transfer-Encoding: chunked']))['result'], 'ok')

    def test_invalid_responses_fail_closed(self):
        examples = [
            http({'result': 'ok'}, status='500 Internal Server Error'),
            http({'error': {'code': 400}, 'result': 'ok'}),
            http({}), http(b'not json'), http(b'[]'),
            http(b'{"result":NaN}'), http(b'{"result":"ok","result":"ok"}'),
            http(b'{"result":"ok"}', headers=['Content-Length: 100']),
            http(b'1\r\nx\r\n', headers=['Transfer-Encoding: chunked']),
            http(b'zzz\r\n', headers=['Transfer-Encoding: chunked']),
            http(b'0\r\n', headers=['Transfer-Encoding: chunked']),
            http(b'0\r\n\r\nJUNK', headers=['Transfer-Encoding: chunked']),
            http(b'2\r\nx\r\n0\r\n\r\n', headers=['Transfer-Encoding: chunked']),
            http(b'x', headers=['Content-Length: 1', 'Content-Length: 1']),
            http(b'x', headers=['Transfer-Encoding: chunked', 'Content-Length: 1']),
            http(b'x', headers=['Content-Encoding: gzip', 'Content-Length: 1']),
            http(b'x', headers=[]), b'not HTTP',
        ]
        for raw in examples:
            with self.subTest(raw=raw):
                with self.assertRaises(optimizer.SafetyError):
                    optimizer.parse_http(raw)

    def test_response_size_bounded(self):
        with patch.object(optimizer, 'MAX_HTTP_BYTES', 64):
            with self.assertRaises(optimizer.SafetyError):
                optimizer.parse_http(b'x' * 65)

    def test_header_size_bounded(self):
        with patch.object(optimizer, 'MAX_HEADER_BYTES', 5):
            with self.assertRaises(optimizer.SafetyError):
                optimizer.parse_http(http({'result': 'ok'}))

    def test_timeout_not_partial_success(self):
        class FakeSocket:
            def settimeout(self, value): pass
            def connect(self, address): pass
            def sendall(self, data): pass
            def close(self): self.closed = True
            def recv(self, size): raise socket.timeout('timed out')
        fake = FakeSocket()
        with patch.object(optimizer.socket, 'socket', return_value=fake):
            with self.assertRaises(optimizer.SafetyError):
                optimizer._http('GET', '/printer/info')
        self.assertTrue(fake.closed)

    def test_post_requires_exact_ack(self):
        for response in ({}, {'result': None}, {'result': 'ok', 'error': {}}, {'result': 'queued'}):
            with patch.object(optimizer, '_http', return_value=response):
                with self.assertRaises(optimizer.SafetyError):
                    optimizer.post_gcode('G28')


class GateTests(OfflineCase):
    def test_valid_idle_fixture(self):
        self.install_snapshot_fixture()
        self.assertEqual(optimizer.snapshot()['eventtime'], 1)

    def test_busy_unknown_heating_and_macros_block(self):
        self.install_snapshot_fixture()
        cases = [
            ('print_stats', 'state', 'printing'), ('print_stats', 'state', 'paused'),
            ('print_stats', 'state', 'error'), ('print_stats', 'state', 'cancelled'),
            ('idle_timeout', 'state', 'Printing'), ('idle_timeout', 'state', None),
            ('virtual_sdcard', 'is_active', True), ('virtual_sdcard', 'is_active', 0),
            ('pause_resume', 'is_paused', True), ('pause_resume', 'is_paused', None),
            ('webhooks', 'state', 'shutdown'), ('extruder', 'target', 200),
            ('heater_bed', 'target', 60), ('heater_bed', 'temperature', 51),
            ('heater_bed', 'temperature', float('nan')), ('heater_bed', 'power', .01),
            ('heaters', 'available_heaters', []), ('toolhead', 'position', None),
            ('configfile', 'config', {}),
            ('configfile', 'config', {'delayed_gcode job': {'initial_duration': '0'}}),
            ('configfile', 'config', {'gcode_macro G28': {}}),
            ('configfile', 'config', {'homing_override': {}}),
            ('configfile', 'save_config_pending', None),
            ('configfile', 'save_config_pending_items', None),
            ('configfile', 'save_config_pending', True),
            ('configfile', 'save_config_pending_items', {'extruder': {'pid_kp': '20'}}),
        ]
        original = copy.deepcopy(self.fixture)
        for section, key, value in cases:
            with self.subTest(section=section, key=key, value=value):
                self.fixture = copy.deepcopy(original)
                self.fixture['status'][section][key] = value
                with self.assertRaises(optimizer.SafetyError):
                    optimizer.snapshot()

    def test_each_required_object_omission_blocks(self):
        self.install_snapshot_fixture()
        original = copy.deepcopy(self.fixture)
        for object_name in optimizer.BASE_OBJECTS:
            self.fixture = copy.deepcopy(original)
            del self.fixture['status'][object_name]
            with self.subTest(object=object_name):
                with self.assertRaises(optimizer.SafetyError):
                    optimizer.snapshot()

    def test_queue_busy_transitioning_unknown_blocks(self):
        self.install_snapshot_fixture()
        for queue in ({}, {'queued_jobs': [{}], 'queue_state': 'paused'},
                      {'queued_jobs': [], 'queue_state': 'loading'},
                      {'queued_jobs': [], 'queue_state': None},
                      {'queued_jobs': None, 'queue_state': 'ready'}):
            self.queue = queue
            with self.subTest(queue=queue):
                with self.assertRaises(optimizer.SafetyError):
                    optimizer.snapshot()

    def test_additional_heater_checked(self):
        self.install_snapshot_fixture()
        self.fixture['status']['heaters']['available_heaters'].append('heater_generic chamber')
        self.fixture['status']['heater_generic chamber'] = {'target': 40, 'temperature': 25, 'power': 0}
        with self.assertRaises(optimizer.SafetyError):
            optimizer.snapshot()

    def test_missing_pending_schema_blocks_default_diagnostics_without_motion(self):
        self.install_snapshot_fixture()
        for field in ('save_config_pending', 'save_config_pending_items'):
            value = self.fixture['status']['configfile'].pop(field)
            with patch.object(optimizer, 'post_gcode') as post:
                self.assertEqual(optimizer.main([]), 3)
                post.assert_not_called()
            self.fixture['status']['configfile'][field] = value

    def test_homing_override_blocks_approved_and_force_runs(self):
        self.install_snapshot_fixture()
        self.fixture['status']['configfile']['config']['homing_override'] = {'gcode': 'vendor routine'}
        with patch.object(optimizer, 'post_gcode') as post:
            self.assertEqual(optimizer.main(['--force', '--maintenance-approved']), 3)
            post.assert_not_called()

    def test_genuine_five_minutes_observed(self):
        clock = FakeClock()
        sample = {'eventtime': 1, 'fingerprint': ('stable',), 'temperatures': {'extruder': 25}}
        calls = []
        def snap():
            calls.append(clock.now)
            return dict(sample, eventtime=clock.now + 1)
        with patch.object(optimizer, 'snapshot', side_effect=snap), \
                patch.object(optimizer.time, 'monotonic', clock.monotonic), \
                patch.object(optimizer.time, 'sleep', clock.sleep):
            optimizer.observe_idle()
        self.assertGreaterEqual(clock.now, 300)
        self.assertEqual(len(calls), 151)

    def test_unknown_busy_changed_stale_or_gapped_observation_aborts(self):
        for mode in ('unknown', 'busy', 'changed', 'stale', 'gap'):
            with self.subTest(mode=mode):
                clock = FakeClock()
                calls = [0]
                def snap():
                    calls[0] += 1
                    if calls[0] > 1:
                        if mode in ('unknown', 'busy'):
                            raise optimizer.SafetyError(mode)
                        if mode == 'gap':
                            clock.now += 13
                    return {'eventtime': 1 if mode == 'stale' else clock.now + 1,
                            'fingerprint': (calls[0],) if mode == 'changed' else ('stable',),
                            'temperatures': {'extruder': 25}}
                with patch.object(optimizer, 'snapshot', side_effect=snap), \
                        patch.object(optimizer.time, 'monotonic', clock.monotonic), \
                        patch.object(optimizer.time, 'sleep', clock.sleep):
                    with self.assertRaises(optimizer.SafetyError):
                        optimizer.observe_idle()

    def test_default_and_force_never_dispatch_motion(self):
        self.install_snapshot_fixture()
        with patch.object(optimizer, 'post_gcode') as post:
            self.assertEqual(optimizer.main([]), 0)
            self.assertEqual(optimizer.main(['--force']), 0)
            post.assert_not_called()
        self.assertFalse(optimizer.STATE_FILE.exists())

    def test_rising_temperature_aborts_observation(self):
        clock = FakeClock()
        def snap():
            return {'eventtime': clock.now + 1, 'fingerprint': ('stable',),
                    'temperatures': {'extruder': 25 + clock.now * 2}}
        with patch.object(optimizer, 'snapshot', side_effect=snap), \
                patch.object(optimizer.time, 'monotonic', clock.monotonic), \
                patch.object(optimizer.time, 'sleep', clock.sleep):
            with self.assertRaises(optimizer.SafetyError): optimizer.observe_idle()

    def test_force_cannot_bypass_busy_or_heat(self):
        self.install_snapshot_fixture()
        self.fixture['status']['extruder']['target'] = 200
        with patch.object(optimizer, 'post_gcode') as post:
            self.assertEqual(optimizer.main(['--force', '--maintenance-approved']), 3)
            post.assert_not_called()

    def test_public_routines_require_approval_and_lock(self):
        for routine in (optimizer.run_shaper_calibrate, optimizer.run_bed_mesh, optimizer.run_probe_accuracy):
            with self.assertRaises(optimizer.SafetyError):
                routine()
            with self.assertRaises(optimizer.SafetyError):
                routine(True)


class PersistenceTests(OfflineCase):
    def test_atomic_lock_cross_process_and_reacquisition(self):
        self.assertTrue(optimizer.acquire_lock())
        self.assertFalse(optimizer.acquire_lock())
        # Spawn prevents inheriting the parent's flock file description.
        context = multiprocessing.get_context('spawn')
        receiving, sending = context.Pipe(duplex=False)
        process = context.Process(target=child_lock_attempt, args=(str(optimizer.LOCKFILE), sending))
        process.start()
        sending.close()
        self.assertTrue(receiving.poll(10))
        self.assertFalse(receiving.recv())
        process.join(10)
        self.assertEqual(process.exitcode, 0)
        receiving.close()
        optimizer.release_lock()
        self.assertTrue(optimizer.LOCKFILE.exists())
        self.assertTrue(optimizer.acquire_lock())

    def test_state_atomic_roundtrip_corruption_and_future_block(self):
        optimizer.save_state({'runs': []})
        self.assertEqual(optimizer.state(), {'runs': []})
        optimizer.STATE_FILE.write_bytes(b'not JSON')
        with self.assertRaises(optimizer.SafetyError): optimizer.state()
        optimizer.save_state({'runs': [{'ts': '9999-01-01'}]})
        with self.assertRaises(optimizer.SafetyError): optimizer.state()

    def test_force_does_not_bypass_weekly_cap(self):
        optimizer.save_state({'runs': [{'ts': optimizer.datetime.now().isoformat(), 'op': 'probe_accuracy', 'ok': False}]})
        self.assertIsNone(optimizer.eligible_operation(force=True)[0])

    def test_unresolved_attempt_blocks_future_ticks(self):
        optimizer.save_state({'pending': {'op': 'probe_accuracy'}})
        with self.assertRaises(optimizer.SafetyError): optimizer.eligible_operation(True)

    def test_backup_verified_rotated(self):
        optimizer.PRINTER_CFG.write_text('printer config')
        paths = [optimizer.backup_cfg() for _ in range(12)]
        self.assertEqual(len(list(optimizer.BACKUP_DIR.glob('*.cfg'))), 10)
        self.assertTrue(any(path.exists() and path.read_text() == 'printer config' for path in paths))

    def test_shaper_mesh_probe_priority_preserved(self):
        self.assertEqual(optimizer.eligible_operation()[0], 'shaper_calibrate')
        optimizer.PRINTER_CFG.write_text('shaper_freq_x: 42\nshaper_freq_y: 43')
        self.assertEqual(optimizer.eligible_operation()[0], 'bed_mesh')
        optimizer.PRINTER_CFG.write_text('shaper_freq_x: 42\nshaper_freq_y: 43\nbed_mesh default')
        self.assertEqual(optimizer.eligible_operation()[0], 'probe_accuracy')


class PendingConfigTests(OfflineCase):
    def clean(self):
        return {'save_config_pending': False, 'save_config_pending_items': {}}

    def pending(self, operation):
        if operation == 'shaper_calibrate':
            items = {'input_shaper': {'shaper_type_x': 'mzv', 'shaper_freq_x': '42.0',
                                      'shaper_type_y': 'ei', 'shaper_freq_y': '43.0'}}
        else:
            items = {'bed_mesh default': {
                'version': '1', 'points': '0, 0, 0\n0, 0, 0\n0, 0, 0',
                'min_x': '0', 'max_x': '300', 'min_y': '0', 'max_y': '300',
                'x_count': '3', 'y_count': '3', 'mesh_x_pps': '2', 'mesh_y_pps': '2',
                'algo': 'bicubic', 'tension': '0.2'}}
        return {'save_config_pending': True, 'save_config_pending_items': items}

    def test_clean_schema_required_before_motion(self):
        self.assertEqual(optimizer.validate_pending(self.clean()), {})
        for value in ({}, {'save_config_pending': False},
                      {'save_config_pending_items': {}},
                      self.pending('shaper_calibrate'),
                      {'save_config_pending': 0, 'save_config_pending_items': {}}):
            with self.assertRaises(optimizer.SafetyError): optimizer.validate_pending(value)

    def test_operation_allowlisted_keys_and_values(self):
        for operation in ('shaper_calibrate', 'bed_mesh'):
            value = self.pending(operation)
            self.assertEqual(optimizer.validate_pending(value, operation), value['save_config_pending_items'])
            items = value['save_config_pending_items']
            section = next(iter(items))
            for modified in (
                dict(items, extruder={'pid_kp': '20'}),
                {section: None}, {section: {}},
                {section: dict(items[section], unrelated='1')},
                {section: dict(items[section], **{next(iter(items[section])): None})},
            ):
                with self.subTest(operation=operation, modified=modified):
                    with self.assertRaises(optimizer.SafetyError):
                        optimizer.validate_pending({'save_config_pending': True,
                                                    'save_config_pending_items': modified}, operation)

    def test_bad_shaper_values_and_mesh_values_block(self):
        for operation, section, key, invalid in (
            ('shaper_calibrate', 'input_shaper', 'shaper_freq_x', 'NaN'),
            ('shaper_calibrate', 'input_shaper', 'shaper_freq_x', '0'),
            ('shaper_calibrate', 'input_shaper', 'shaper_type_y', 'unknown'),
            ('bed_mesh', 'bed_mesh default', 'points', 'NaN, 0, 0\n0, 0, 0\n0, 0, 0'),
            ('bed_mesh', 'bed_mesh default', 'points', '0, 0'),
            ('bed_mesh', 'bed_mesh default', 'version', '2'),
            ('bed_mesh', 'bed_mesh default', 'x_count', '3.0'),
            ('bed_mesh', 'bed_mesh default', 'min_x', '400'),
        ):
            value = self.pending(operation)
            value['save_config_pending_items'][section][key] = invalid
            with self.assertRaises(optimizer.SafetyError): optimizer.validate_pending(value, operation)


class OperationTests(OfflineCase):
    def setup_operation(self):
        optimizer.acquire_lock()
        self.sample = {'eventtime': 1, 'observed_at': 0, 'pending': {},
                       'fingerprint': (22, 'standby', '', ('position',), None, 0, 0, ('heaters',), '{}')}
        self.counter = 0
        def snap(pending_operation=None):
            self.counter += 1
            pending = {} if pending_operation in (None, 'probe_accuracy') else {'operation': pending_operation}
            return dict(self.sample, eventtime=self.counter + 1, pending=pending)
        self.enterContext(patch.object(optimizer, 'observe_idle', return_value=self.sample))
        self.enterContext(patch.object(optimizer, 'snapshot', side_effect=snap))
        self.enterContext(patch.object(optimizer, 'backup_cfg', return_value=Path('/mock/backup.cfg')))

    def test_success_sequence_and_successful_probe_date_only(self):
        for op, expected in (
            ('shaper_calibrate', ['G28\nSHAPER_CALIBRATE\nM400', 'SAVE_CONFIG']),
            ('bed_mesh', ['G28\nBED_MESH_CALIBRATE PROFILE=default\nM400', 'BED_MESH_PROFILE SAVE=default\nM400', 'SAVE_CONFIG']),
            ('probe_accuracy', ['G28\nPROBE_ACCURACY SAMPLES=5\nM400']),
        ):
            with self.subTest(op=op), patch.object(optimizer, 'post_gcode', return_value={'result': 'ok'}) as post:
                self.setup_operation()
                optimizer.save_state({})
                self.assertTrue(optimizer.run_operation(op, True))
                self.assertEqual([call.args[0] for call in post.call_args_list], expected)
                self.assertNotIn('pending', optimizer.state())
                self.assertTrue(optimizer.state()['runs'][-1]['ok'])
                self.assertEqual('last_probe_check' in optimizer.state(), op == 'probe_accuracy')

    def test_failure_error_or_timeout_never_saves_or_restarts(self):
        for outcome in (optimizer.SafetyError('timeout'), {'error': {}}, {}, {'result': 'queued'}):
            with self.subTest(outcome=outcome):
                self.setup_operation()
                optimizer.save_state({})
                kwargs = {'side_effect': outcome} if isinstance(outcome, Exception) else {'return_value': outcome}
                with patch.object(optimizer, 'post_gcode', **kwargs) as post:
                    with self.assertRaises(optimizer.SafetyError): optimizer.run_operation('shaper_calibrate', True)
                self.assertEqual(post.call_count, 1)
                self.assertIn('pending', optimizer.state())
                self.assertFalse(optimizer.state()['runs'][-1]['ok'])

    def test_probe_failure_does_not_update_due_date(self):
        self.setup_operation()
        with patch.object(optimizer, 'post_gcode', side_effect=optimizer.SafetyError('probe failed')):
            with self.assertRaises(optimizer.SafetyError): optimizer.run_operation('probe_accuracy', True)
        self.assertNotIn('last_probe_check', optimizer.state())

    def test_busy_job_arrives_after_motion_ack_no_save(self):
        self.setup_operation()
        def snap(pending_operation=None):
            self.counter += 1
            if self.counter >= 3:
                raise optimizer.SafetyError('job arrived after command')
            return dict(self.sample, eventtime=self.counter + 1)
        with patch.object(optimizer, 'snapshot', side_effect=snap), \
                patch.object(optimizer, 'post_gcode', return_value={'result': 'ok'}) as post_mock:
            with self.assertRaises(optimizer.SafetyError): optimizer.run_operation('bed_mesh', True)
        self.assertEqual(post_mock.call_count, 1)

    def test_slow_backup_breaks_consecutive_gate(self):
        self.setup_operation()
        with patch.object(optimizer, 'snapshot', return_value=dict(self.sample, observed_at=13)), \
                patch.object(optimizer, 'post_gcode') as post:
            with self.assertRaises(optimizer.SafetyError): optimizer.run_operation('shaper_calibrate', True)
            post.assert_not_called()

    def test_save_timeout_is_not_retried_and_leaves_pending(self):
        self.setup_operation()
        with patch.object(optimizer, 'post_gcode', side_effect=[{'result': 'ok'}, optimizer.SafetyError('save timeout')]) as post:
            with self.assertRaises(optimizer.SafetyError): optimizer.run_operation('shaper_calibrate', True)
        self.assertEqual(post.call_count, 2)
        self.assertIn('pending', optimizer.state())

    def test_backup_failure_prevents_any_motion(self):
        self.setup_operation()
        with patch.object(optimizer, 'backup_cfg', side_effect=OSError('disk full')), \
                patch.object(optimizer, 'post_gcode') as post:
            with self.assertRaises(OSError): optimizer.run_operation('shaper_calibrate', True)
            post.assert_not_called()

    def test_pending_persistence_failure_prevents_any_motion(self):
        self.setup_operation()
        with patch.object(optimizer, 'save_state', side_effect=OSError('disk full')), \
                patch.object(optimizer, 'post_gcode') as post:
            with self.assertRaises(OSError): optimizer.run_operation('probe_accuracy', True)
            post.assert_not_called()

    def test_state_changes_before_motion_prevent_any_dispatch(self):
        self.setup_operation()
        with patch.object(optimizer, 'snapshot', return_value=dict(self.sample, fingerprint=('job changed',))), \
                patch.object(optimizer, 'post_gcode') as post:
            with self.assertRaises(optimizer.SafetyError): optimizer.run_operation('probe_accuracy', True)
            post.assert_not_called()

    def test_profile_save_failure_never_config_saves(self):
        self.setup_operation()
        with patch.object(optimizer, 'post_gcode', side_effect=[{'result': 'ok'}, optimizer.SafetyError('profile failed')]) as post:
            with self.assertRaises(optimizer.SafetyError): optimizer.run_operation('bed_mesh', True)
        self.assertEqual(post.call_count, 2)
        self.assertNotIn('SAVE_CONFIG', [call.args[0] for call in post.call_args_list])

    def test_stale_at_every_command_precheck_blocks_that_write(self):
        # 1 backup recheck, 2 motion precheck, 4 profile precheck, 6 save precheck.
        for stale_call, expected_calls in ((1, 0), (2, 0), (4, 1), (6, 2)):
            with self.subTest(stale_call=stale_call):
                self.setup_operation()
                optimizer.save_state({})
                count = [0]
                last = [1]
                def snap(pending_operation=None):
                    count[0] += 1
                    if count[0] != stale_call:
                        last[0] += 1
                    pending = {} if pending_operation is None else {'operation': pending_operation}
                    return dict(self.sample, eventtime=last[0], pending=pending)
                with patch.object(optimizer, 'snapshot', side_effect=snap), \
                        patch.object(optimizer, 'post_gcode', return_value={'result': 'ok'}) as post:
                    with self.assertRaises(optimizer.SafetyError): optimizer.run_operation('bed_mesh', True)
                    self.assertEqual(post.call_count, expected_calls)

    def test_unrelated_pending_after_calibration_never_saves(self):
        self.setup_operation()
        count = [0]
        def snap(pending_operation=None):
            count[0] += 1
            if pending_operation is not None:
                optimizer.validate_pending({'save_config_pending': True,
                    'save_config_pending_items': {'extruder': {'pid_kp': '20'}}}, pending_operation)
            return dict(self.sample, eventtime=count[0] + 1)
        with patch.object(optimizer, 'snapshot', side_effect=snap), \
                patch.object(optimizer, 'post_gcode', return_value={'result': 'ok'}) as post:
            with self.assertRaises(optimizer.SafetyError): optimizer.run_operation('shaper_calibrate', True)
            self.assertEqual(post.call_count, 1)

    def test_changed_allowlisted_values_before_save_block(self):
        self.setup_operation()
        count = [0]
        def snap(pending_operation=None):
            count[0] += 1
            pending = {} if pending_operation is None else {'frequency': str(42 + count[0])}
            return dict(self.sample, eventtime=count[0] + 1, pending=pending)
        with patch.object(optimizer, 'snapshot', side_effect=snap), \
                patch.object(optimizer, 'post_gcode', return_value={'result': 'ok'}) as post:
            with self.assertRaises(optimizer.SafetyError): optimizer.run_operation('shaper_calibrate', True)
            self.assertEqual(post.call_count, 1)


if __name__ == '__main__':
    unittest.main()

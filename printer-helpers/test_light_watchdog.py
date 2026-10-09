"""Offline equivalence fixtures: no real sockets, printer, or /usr/data writes."""

import ast
import copy
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
# Keep original-script fixtures byte-for-byte untouched, including no bytecode.
sys.dont_write_bytecode = True


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FIXTURE = ROOT / "printer-helpers/fixtures/original-light-watchdog.py"
ORIGINAL = load_module("original_watchdog", FIXTURE)
CANDIDATE = load_module("candidate_watchdog", ROOT / "printer-helpers/light-watchdog.py")
NOW = 2000
POS = "10.000,20.000,30.000"
STATE = {"last_active": NOW - 600, "pos": POS}


def deny_network(*args, **kwargs):
    raise AssertionError("offline fixtures must never open a real socket")


NETWORK_GUARDS = [patch.object(socket, "socket", side_effect=deny_network),
                  patch.object(socket, "create_connection", side_effect=deny_network)]


def setUpModule():
    for guard in NETWORK_GUARDS:
        guard.start()


def tearDownModule():
    for guard in reversed(NETWORK_GUARDS):
        guard.stop()


def status(print_state="complete", idle_state="Idle", led=1, position=None):
    return {"result": {"status": {
        "print_stats": {"state": print_state},
        "idle_timeout": {"state": idle_state},
        "output_pin LED": {"value": led},
        "toolhead": {"position": [10, 20, 30, 100] if position is None else position},
    }}}


class LogicEquivalence(unittest.TestCase):
    def run_fixture(self, module, data, prev=STATE, post_ok=True):
        calls = []
        saved = []
        logs = []
        def get(path):
            calls.append(("GET", path))
            return copy.deepcopy(data)
        def post(path):
            calls.append(("POST", path))
            return post_ok
        def save(value):
            saved.append(value)
        with patch.object(module.time, "time", return_value=NOW), \
                patch.object(module, "http_get_json", side_effect=get), \
                patch.object(module, "http_post", side_effect=post), \
                patch.object(module, "load_state", return_value=copy.deepcopy(prev)), \
                patch.object(module, "save_state", side_effect=save), \
                patch.object(module, "log", side_effect=logs.append):
            try:
                result = ("return", module.main())
            except (ValueError, TypeError, AttributeError) as error:
                result = ("error", type(error).__name__, str(error))
        return result, calls, saved, logs

    def test_activity_idle_and_failure_fixtures(self):
        fixtures = [
            ("idle threshold", status(), STATE, True),
            ("idle before threshold", status(), {**STATE, "last_active": NOW - 599}, True),
            ("long idle", status(), {**STATE, "last_active": 0}, True),
            ("printing", status(print_state="printing"), STATE, True),
            ("paused", status(print_state="paused"), STATE, True),
            ("macro", status(idle_state="Printing"), STATE, True),
            ("moved X", status(position=[10.001, 20, 30]), STATE, True),
            ("moved below precision", status(position=[10.0001, 20, 30]), STATE, True),
            ("extruder only", status(position=[10, 20, 30, 999]), STATE, True),
            ("missing position", status(position=[]), STATE, True),
            ("first tick", status(), {}, True),
            ("first tick no position", status(position=[]), {}, True),
            ("future clock", status(), {**STATE, "last_active": NOW + 1}, True),
            ("LED off", status(led=0), STATE, True),
            ("LED none", status(led=None), STATE, True),
            ("LED fractional", status(led=0.01), STATE, True),
            ("LED string", status(led="1.0"), STATE, True),
            ("LED negative", status(led=-1), STATE, True),
            ("post failed", status(), STATE, False),
            ("unavailable", None, STATE, True),
            ("empty response", {}, STATE, True),
            ("missing objects", {"result": {}}, STATE, True),
            ("malformed last_active", status(), {**STATE, "last_active": "bad"}, True),
            ("malformed LED", status(led="bad"), STATE, True),
            ("malformed position", status(position=["bad"]), STATE, True),
        ]
        for name, data, prev, post_ok in fixtures:
            with self.subTest(name=name):
                self.assertEqual(self.run_fixture(ORIGINAL, data, prev, post_ok),
                                 self.run_fixture(CANDIDATE, data, prev, post_ok))

    def test_read_only_check_never_loads_saves_logs_or_posts(self):
        for data in (status(), None, {}):
            with self.subTest(data=data), \
                    patch.object(CANDIDATE, "http_get_json", return_value=data) as get, \
                    patch.object(CANDIDATE, "http_post") as post, \
                    patch.object(CANDIDATE, "load_state") as load, \
                    patch.object(CANDIDATE, "save_state") as save, \
                    patch.object(CANDIDATE, "log") as log:
                self.assertEqual(CANDIDATE.main(check=True), 0 if data else 1)
                get.assert_called_once_with(CANDIDATE.QUERY_PATH)
                for forbidden in (post, load, save, log):
                    forbidden.assert_not_called()


class FakeResponse:
    def __init__(self, code, body):
        self.status = code
        self.body = body
    def read(self):
        if isinstance(self.body, Exception):
            raise self.body
        return self.body
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass


class TransportEquivalence(unittest.TestCase):
    def run_transport(self, module, method, code=200, body=b'{"ok":true}', fault=None):
        calls = []
        closed = []
        path = CANDIDATE.QUERY_PATH if method == "GET" else CANDIDATE.LED_OFF_PATH
        response = FakeResponse(code, body)
        class Connection:
            def __init__(self, host, port, timeout):
                calls.append((host, port, timeout))
            def request(self, verb, request_path, headers):
                calls.append((verb, request_path, headers))
                if fault:
                    raise fault
            def getresponse(self):
                return response
            def close(self):
                closed.append(True)
        def urlopen(request, timeout):
            self.assertEqual(timeout, 5)
            if fault:
                raise urllib.error.URLError(fault)
            if code >= 400:
                raise urllib.error.HTTPError("fake", code, "fake", None, None)
            return response
        with patch.object(http.client, "HTTPConnection", Connection), \
                patch.object(urllib.request, "urlopen", side_effect=urlopen):
            result = module.http_get_json(path) if method == "GET" else module.http_post(path)
        if module is CANDIDATE:
            self.assertEqual(calls[0], ("127.0.0.1", 7125, 5))
            self.assertEqual(calls[1], (method, path, {"Connection": "close"}))
            self.assertTrue(closed)
        return result

    def test_get_post_status_body_and_timeout_equivalence(self):
        fixtures = [
            (200, b'{"ok":true}', None),
            (201, b'{"ok":true}', None),
            (204, b'', None),
            (400, b'{"ok":true}', None),
            (401, b'{"ok":true}', None),
            (404, b'{"ok":true}', None),
            (500, b'{"ok":true}', None),
            (200, b'not JSON', None),
            (200, b'{"result":{}}', None),
            (200, b'{}', TimeoutError("timeout")),
            (200, b'{}', ConnectionRefusedError("refused")),
            (200, b'{}', OSError("disconnected")),
            (200, TimeoutError("slow body"), None),
        ]
        for method in ("GET", "POST"):
            for code, body, fault in fixtures:
                with self.subTest(method=method, code=code, body=body, fault=fault):
                    self.assertEqual(self.run_transport(ORIGINAL, method, code, body, fault),
                                     self.run_transport(CANDIDATE, method, code, body, fault))

    def test_connection_protocol_errors_fail_closed(self):
        for error in (http.client.RemoteDisconnected(), http.client.BadStatusLine("bad"),
                      http.client.IncompleteRead(b'{"'), http.client.InvalidURL("bad")):
            with self.subTest(error=type(error).__name__), \
                    patch.object(http.client, "HTTPConnection") as factory:
                factory.return_value.request.side_effect = error
                self.assertIsNone(CANDIDATE.http_get_json(CANDIDATE.QUERY_PATH))
                self.assertFalse(CANDIDATE.http_post(CANDIDATE.LED_OFF_PATH))
                self.assertEqual(factory.return_value.close.call_count, 2)

    def test_redirects_fail_closed_without_following_or_repeating(self):
        for method in ("GET", "POST"):
            with self.subTest(method=method), \
                    patch.object(http.client, "HTTPConnection") as factory, \
                    patch.object(urllib.request, "urlopen") as urlopen:
                factory.return_value.getresponse.return_value.status = 302
                expected = None if method == "GET" else False
                self.assertEqual(CANDIDATE._request(method, CANDIDATE.QUERY_PATH), expected)
                factory.return_value.request.assert_called_once()
                urlopen.assert_not_called()


class StateAndScope(unittest.TestCase):
    def test_state_read_write_and_log_io_errors(self):
        for module in (ORIGINAL, CANDIDATE):
            with self.subTest(module=module.__name__), \
                    patch("builtins.open", side_effect=OSError("fixture denied")), \
                    patch.object(module, "log") as log:
                self.assertEqual(module.load_state(), {})
                module.save_state(STATE)
                log.assert_called_once_with("state write failed: fixture denied")
            with patch("builtins.open", side_effect=OSError("fixture denied")), \
                    patch.object(module.os.path, "exists", return_value=False):
                module.log("silently ignored I/O error")

    def test_file_state_and_trim_equivalence(self):
        for initial in (None, b'bad JSON', b'{"last_active":1400,"pos":"same"}'):
            results = []
            for module in (ORIGINAL, CANDIDATE):
                with tempfile.TemporaryDirectory() as directory:
                    state_path = Path(directory) / "state"
                    log_path = Path(directory) / "log"
                    if initial is not None:
                        state_path.write_bytes(initial)
                    log_path.write_bytes(b'x' * (module.LOG_MAX + 1))
                    with patch.object(module, "STATE_PATH", str(state_path)), \
                            patch.object(module, "LOG", str(log_path)), \
                            patch.object(module.time, "strftime", return_value="fixed"):
                        loaded = module.load_state()
                        module.save_state(STATE)
                        module.log("test")
                    results.append((loaded, state_path.read_bytes(), log_path.read_bytes()))
            self.assertEqual(*results)

    def test_constants_paths_and_original_bytes(self):
        for name in ("LOG", "STATE_PATH", "HOST", "TIMEOUT_SEC", "HTTP_TIMEOUT", "LOG_MAX"):
            self.assertEqual(getattr(ORIGINAL, name), getattr(CANDIDATE, name))
        expected = {
            "light-watchdog.py": "d150bd58cea24cce3f73aa8abf29aaf4fac1c90e017c4ceefd863ebf86679e7f",
            "light-watchdog.sh": "d703570c118b574987448400e4f7e873c4c8c8a2eec9b9a76a4950dbd5aa2830",
        }
        for name, digest in expected.items():
            owner_path = ROOT / "scripts" / name
            if owner_path.exists():
                self.assertEqual(hashlib.sha256(owner_path.read_bytes()).hexdigest(), digest)
        self.assertEqual(hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
                         expected["light-watchdog.py"])

    def test_static_command_and_one_shot_scope(self):
        source = (ROOT / "printer-helpers/light-watchdog.py").read_text()
        tree = ast.parse(source)
        # No spawned processes, shell, background work, or additional endpoints.
        imported = [node.names[0].name for node in ast.walk(tree)
                    if isinstance(node, ast.Import)]
        self.assertEqual(imported, ["http.client", "json", "os", "sys", "time"])
        self.assertFalse(any(isinstance(node, (ast.While, ast.AsyncFunctionDef)) for node in ast.walk(tree)))
        endpoint_literals = [node.value for node in ast.walk(tree) if isinstance(node, ast.Constant)
                             and isinstance(node.value, str) and node.value.startswith("/printer/")]
        self.assertCountEqual(endpoint_literals, [CANDIDATE.QUERY_PATH, CANDIDATE.LED_OFF_PATH])
        post_calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                      and isinstance(node.func, ast.Name) and node.func.id == "http_post"]
        self.assertEqual(len(post_calls), 1)
        self.assertEqual(post_calls[0].args[0].id, "LED_OFF_PATH")
        self.assertEqual(CANDIDATE.LED_OFF_PATH,
                         "/printer/gcode/script?script=SET_PIN%20PIN%3DLED%20VALUE%3D0")
        main_guard = tree.body[-1]
        self.assertIsInstance(main_guard, ast.If)
        main_call = main_guard.body[0].value.args[0]
        self.assertEqual(main_call.func.id, "main")
        self.assertEqual(main_call.keywords[0].arg, "check")
        flags = [node.value for node in ast.walk(main_call) if isinstance(node, ast.Constant)
                 and isinstance(node.value, str)]
        self.assertCountEqual(flags, ["--check", "--dry-run"])

    def test_normal_import_does_not_load_urllib_request_or_typing(self):
        import subprocess
        import sys
        result = subprocess.run([
            sys.executable, "-c",
            "import sys; "
            "exec(compile(open(sys.argv[1]).read(), sys.argv[1], 'exec'), {'__name__':'fixture'}); "
            "assert 'typing' not in sys.modules and 'urllib.request' not in sys.modules",
            str(ROOT / "printer-helpers/light-watchdog.py"),
        ], check=False, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()

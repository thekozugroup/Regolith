#!/usr/bin/env python3
"""One-shot chamber-light watchdog; candidate replacement, not auto-installed.

Run every minute using the existing cron wrapper. State, inactivity rules,
600-second threshold, and the sole LED command match scripts/light-watchdog.py.
http.client avoids urllib.request/typing startup on the normal request path.
"""

import http.client
import json
import os
import sys
import time

LOG = "/usr/data/light-watchdog.log"
STATE_PATH = "/usr/data/.light-watchdog-state"
HOST = "http://127.0.0.1:7125"
TIMEOUT_SEC = 600
HTTP_TIMEOUT = 5
LOG_MAX = 256 * 1024

# Exact original urllib.parse.urlencode(..., quote_via=quote) output.
QUERY_PATH = (
    "/printer/objects/query?print_stats=&toolhead=&output_pin%20LED=&idle_timeout="
)
LED_OFF_PATH = "/printer/gcode/script?script=SET_PIN%20PIN%3DLED%20VALUE%3D0"


def log(msg):
    ts = time.strftime("%Y-%m-%dT%H:%M:%S")
    try:
        if os.path.exists(LOG) and os.path.getsize(LOG) > LOG_MAX:
            with open(LOG, "rb") as f:
                f.seek(-LOG_MAX // 2, os.SEEK_END)
                tail = f.read()
            with open(LOG, "wb") as f:
                f.write(tail)
        with open(LOG, "a") as f:
            f.write(f"{ts} {msg}\n")
    except OSError:
        pass


def _request(method, path):
    connection = http.client.HTTPConnection("127.0.0.1", 7125, timeout=HTTP_TIMEOUT)
    try:
        connection.request(method, path, headers={"Connection": "close"})
        response = connection.getresponse()
        if 300 <= response.status < 400:
            # Loopback API does not redirect. Never repeat an LED POST or follow
            # a status check to a different destination; retry next cron tick.
            return False if method == "POST" else None
        if method == "POST":
            return response.status == 200
        if not 200 <= response.status < 300:
            return None
        return json.loads(response.read())
    except (OSError, http.client.HTTPException, json.JSONDecodeError):
        return False if method == "POST" else None
    finally:
        connection.close()


def http_get_json(path):
    return _request("GET", path)


def http_post(path):
    return _request("POST", path)


def load_state():
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(state):
    try:
        with open(STATE_PATH, "w") as f:
            json.dump(state, f)
    except OSError as e:
        log(f"state write failed: {e}")


def main(check=False):
    now = int(time.time())
    data = http_get_json(QUERY_PATH)
    if check:
        # Live timing mode: only the status GET. No state, log, or LED writes.
        return 0 if data else 1
    if not data:
        return 0

    status = data.get("result", {}).get("status", {})
    print_state = status.get("print_stats", {}).get("state", "")
    idle_state = status.get("idle_timeout", {}).get("state", "")
    led_value = status.get("output_pin LED", {}).get("value", 0)
    position = status.get("toolhead", {}).get("position", [])
    pos_key = ",".join(f"{p:.3f}" for p in position[:3])

    prev = load_state()
    last_active = int(prev.get("last_active", now))
    last_pos = prev.get("pos", "")
    moved = pos_key and pos_key != last_pos
    is_print = print_state in ("printing", "paused")
    is_macro = idle_state == "Printing"
    active = is_print or is_macro or moved

    if active:
        last_active = now

    idle_for = now - last_active
    led_on = float(led_value or 0) > 0
    if not active and idle_for >= TIMEOUT_SEC and led_on:
        log(
            f"idle for {idle_for}s — turning LED off "
            f"(print_state={print_state} idle_state={idle_state})"
        )
        if not http_post(LED_OFF_PATH):
            log("SET_PIN request failed")

    save_state({"last_active": last_active, "pos": pos_key})
    return 0


if __name__ == "__main__":
    sys.exit(main(check="--check" in sys.argv or "--dry-run" in sys.argv))

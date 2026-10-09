#!/usr/bin/env python3
"""light-watchdog — auto-off the chamber LED after 10 min idle.

Run every 1 minute via /opt/etc/cron.1min. Active means klipper is
print_stats=printing/paused, or idle_timeout=Printing (any macro is
running), or the toolhead position has changed since the last tick.
Anything else counts as idle and starts the countdown.

State is kept in /usr/data/.light-watchdog-state as JSON.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

LOG = "/usr/data/light-watchdog.log"
STATE_PATH = "/usr/data/.light-watchdog-state"
HOST = "http://127.0.0.1:7125"
TIMEOUT_SEC = 600
HTTP_TIMEOUT = 5
LOG_MAX = 256 * 1024


def log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%dT%H:%M:%S")
    try:
        # Self-trim
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


def http_get_json(path):
    try:
        with urllib.request.urlopen(f"{HOST}{path}", timeout=HTTP_TIMEOUT) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        return None


def http_post(path: str) -> bool:
    try:
        req = urllib.request.Request(f"{HOST}{path}", method="POST")
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


def load_state() -> dict:
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(state: dict) -> None:
    try:
        with open(STATE_PATH, "w") as f:
            json.dump(state, f)
    except OSError as e:
        log(f"state write failed: {e}")


def main() -> int:
    now = int(time.time())

    # Moonraker expects %20 (not +) for spaces in object names.
    qs = urllib.parse.urlencode(
        {
            "print_stats": "",
            "toolhead": "",
            "output_pin LED": "",
            "idle_timeout": "",
        },
        quote_via=urllib.parse.quote,
    )
    data = http_get_json(f"/printer/objects/query?{qs}")
    if not data:
        return 0  # moonraker not ready — try next minute

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
        ok = http_post(
            "/printer/gcode/script?"
            + urllib.parse.urlencode(
                {"script": "SET_PIN PIN=LED VALUE=0"}, quote_via=urllib.parse.quote
            )
        )
        if not ok:
            log("SET_PIN request failed")

    save_state({"last_active": last_active, "pos": pos_key})
    return 0


if __name__ == "__main__":
    sys.exit(main())

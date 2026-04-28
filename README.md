A modern, opinionated web interface for Klipper-based 3D printers — built for ease of use, with foolproofing wired in at every step. Replaces Fluidd on a Creality K1 Max with a mission-control dashboard, calibration tooling, and explicit guard-rails that prevent accidental moves, mid-print misclicks, and out-of-bounds commands.

## Screenshots

![Regolith dashboard during an active print](./docs/screenshot.png)

## How it works

The UI is a static React SPA that talks directly to Moonraker over a single WebSocket. There is no backend service to maintain — drop the built bundle anywhere nginx can serve static files. State subscriptions are merged into immutable snapshots so React renders only what changed, and a stuck-watchdog reconnects the camera stream and WS automatically when the network blips.

Every action that dispatches gcode passes through a unified safety layer first. The same module powers the Tune page (no calibration runs while a print is active), the Control page (jog buttons grey out when a target move would exceed printer bounds, would land below an unhomed axis, or would hit a 0.5 mm endstop buffer), and the Print dialog (start blocked while busy, confirms before sending). A floating health alert stack surfaces thermal-runaway, MCU overheating, and network-loss conditions without burying them in logs.

Calibration tasks are exposed as one-click cards with explicit confirm modals, estimated durations, and the literal gcode preview behind a `<details>`. The print flow includes per-print toggles for adaptive bed mesh (KAMP) and timelapse recording — set once, persisted, applied via gcode variables. A Print History card surfaces the rolling Moonraker job log with success/failure pills and per-print stats so failed runs are obvious.

## Stack

- React 19 + TypeScript on Bun + Vite
- Tailwind v4 with CSS-driven theming (8 accent presets, configurable device name)
- Lucide icons in the Radix stroke aesthetic
- Recharts for thermals, custom SVG for tachometer-style segmented gauges
- No backend — pure static SPA against Moonraker's WebSocket + REST API

## Status

Active

---

## Local development

```
bun install
bun dev
```

Vite proxies `/printer`, `/server`, `/machine`, `/access`, `/api`, `/webcam`, and `/websocket` to the printer at build time.

## Deploy

```
./deploy.sh
```

Atomic deploy: stages to `/usr/data/fluidd.next`, verifies file list matches the local `dist/`, swaps the previous build into `.previous`, then HTTP-checks every referenced asset before reporting success. Rollback command is printed on completion.

# Regolith

Greenfield Moonraker frontend for the Forge K1 Max printer.

A focused, essentials-only UI replacing Fluidd. View · Print · Monitor.

## Stack

- **Bun** + **Vite** + **React 19** + **TypeScript**
- **Tailwind v4** (zero-config, CSS-driven theming)
- **Lucide icons** (Radix-style strokes, matches Fluidd custom theme)
- **react-router** (client-side SPA)
- **No backend** — pure static SPA, talks directly to Moonraker WebSocket

## Routes

| Path | Purpose |
|---|---|
| `/` | Status hero + camera + thermals |
| `/print` | File browser + one-click start |
| `/control` | Jog, home, motors-off |
| `/console` | Klipper console with command history |
| `/settings` | Restart / firmware-restart / e-stop |

## Dev

```bash
bun install
bun dev
```

Vite dev server at `http://localhost:5173`. Proxies `/printer`, `/server`,
`/machine`, `/access`, `/api`, `/webcam`, `/websocket` to `http://forge.local`.

## Build + deploy

```bash
bun run build    # → ./dist/
```

Copy `dist/*` to `/usr/data/forge-ui/` on the printer, then add an nginx
location pointing to it. Can run alongside Fluidd at a different path during
evaluation.

## Design tokens

Defined in `src/index.css` via `@theme {}`:

| Token | Value |
|---|---|
| `--color-bg` | `#09090b` zinc-950 |
| `--color-surface` | `#18181b` zinc-900 |
| `--color-elevated` | `#27272a` zinc-800 |
| `--color-border` | `#27272a` |
| `--color-border-strong` | `#3f3f46` |
| `--color-fg` | `#fafafa` |
| `--color-fg-muted` | `#a1a1aa` |
| `--color-accent` | `#f97316` orange-500 |
| `--color-accent-hover` | `#ea580c` orange-600 |
| Radii | 0 / 4px / 6px / 8px |
| Type scale | 10 / 11 / 12 / 13 / 15 / 18 |

## Architecture

```
Browser
  ├── Sidebar (icon nav)
  ├── AppBar (logo, status badge, connection indicator)
  └── Routes
        ├── Dashboard   → live status + camera + thermals
        ├── Files       → REST list, one-click print
        ├── Control     → jog grid + motors
        ├── Console     → live gcode log + command input
        └── Settings    → system controls
        ↓
        moonraker.ts (WS client + REST helpers)
        ↓
        Moonraker /websocket  + REST endpoints
        ↓
        Klipper
```

## Not included (intentional)

- Klipper config editing (use `ssh` or Fluidd for risky edits)
- Macro creator (use Fluidd)
- Bed mesh visualizer
- Gcode preview
- History stats
- Update manager

## Roadmap

- [ ] Pressure advance live tuning
- [ ] Filament profiles (PA per material)
- [ ] Per-print timelapse
- [ ] PWA install for tablet kiosk mode

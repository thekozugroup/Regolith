# Load shedding before a long print

Regolith links here from the pre-print host warning and from the shutdown
explainer. This page is instructions for a human, executed **before** a
print — never during one.

## Why

Long prints on this printer have failed from **host load**, not from the
printer. The printer's little computer runs Klipper's real-time scheduling,
and anything else running on it competes for that budget. Two dated
incidents:

- **2026-08-12, 01:16** — a print finished and the timelapse component's
  `autorender` immediately started an ffmpeg encode over 1873 frames with
  `-threads 2` hardcoded, on the 2-core SoC. Load average went 2 → 30 and
  Klipper shut down 28 seconds later with `Rescheduled timer in the past`.
  The machine hung until it was power-cycled. Nothing was lost only because
  the print had *just* finished.
- **2026-08-12, 17:54** — a job died with
  `Unable to obtain 'result_deal_avgs_prtouch' response`, which reads like a
  broken strain-gauge probe and cost a debugging session on hardware that
  was never at fault (the MCU link showed 9 retransmit bytes in 11 MB). The
  true condition, measured afterwards with **no print running**: 68 of
  127 MB swap in use, 25% iowait, 0% idle CPU. The host was thrashing its
  swap on eMMC and Klipper could not answer on time.

The through-line: **a starved host masquerades as a hardware fault.** The
error names a timer, a digital out pin, or the probe — never the CPU.

## How to tell

- The **HOST LOAD** lamp in the Systems cluster, lit or latched, with the
  number that tripped it.
- The **pre-print warning** in the Start Print dialog (advisory only — it
  never blocks a print).
- The honest caveat: **swap is invisible to the UI.** Moonraker exposes no
  swap or load-average figures, and iowait is folded into its CPU number.
  A pegged CPU on a printer that is doing *nothing* is the tell — that is
  what thrash looks like through the only window we have.

## Printer-agnostic checklist (any Klipper host)

1. **No video encoding during or right after a print.** Timelapse
   `autorender` stays disabled (Regolith writes `autorender: false` on
   every print start — keep it that way). Render deliberately, from the
   Timelapses page, on an idle machine, watching it.
2. **Clear any backlog of captured frames before a long print.** Frames are
   deleted only after a render *succeeds*, so a failed render leaves the
   whole backlog queued — the next attempt is bigger than the one that
   already hurt the box.
3. **Stop anything doing sustained network or disk work**: remote-access
   daemons running userspace networking, cloud sync, backups, log shippers.
4. **Move any watchdog/cron aside first.** A watchdog that restarts the
   service you just stopped undoes the shed within a minute, silently, and
   the readout will look inexplicable.
5. **Prefer stopping work over renicing it.** On a 2-core ~1 GHz SoC,
   `nice` does not save you from iowait — a polite process thrashing swap
   starves Klipper exactly as fast.
6. **Re-check idle load after shedding**, before slicing the next job.

## K1 / K1 Max specifics

- **`tailscaled` in userspace-networking mode is the big win.** Measured on
  this printer: stopping it took swap 68 → 31 MB and iowait 25% → 0%, and
  the file that had just failed then printed cleanly. Userspace networking
  does per-packet work in userland; on this SoC that is expensive enough to
  matter.
- **The tailscale watchdog cron resurrects it within ~60 s.** Move the cron
  entry aside *before* stopping the daemon, or the shed silently undoes
  itself.
- **The restore path is first-class, not an afterthought**: put the cron
  back, let the watchdog bring the daemon up, and confirm remote access
  works before walking away. A runbook you cannot reverse is a trap —
  **losing remote access to a printer you are not standing next to is its
  own hazard. Shed deliberately, restore deliberately.**
- **Leave `Monitor` and `log_main` alone.** They are Creality-owned, were
  deliberately not touched during the incident work, and their failure
  modes are unknown. Not worth the blast radius.
- The hourly auto-optimize cron fires on the hour and self-guards; it is
  not implicated and needs no action.
- The substrate, so the numbers make sense: 2 cores, ~1 GHz MIPS, 127 MB of
  swap **on eMMC**. Swap on eMMC is why memory pressure becomes iowait
  becomes a timer fault.

## What Regolith cannot do for you

Regolith cannot stop services on the printer: the K1's init has no systemd
`service_state` for Moonraker to act through, and shell access is out of
scope for a dashboard. This runbook is instructions for a human, not a
button — deliberately. Do not build the button.

## Do not touch during a print

Everything above is a *before* procedure. Stopping and starting daemons is
itself CPU work; doing it mid-print risks the exact fault it is meant to
prevent.

import { memo, useEffect, useId, useRef, useState } from "react";
import { Info, Printer, Upload, Trash2, X } from "lucide-react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { K1MaxSilhouette } from "@/components/K1MaxSilhouette";
import { ModalSurface } from "@/components/ModalSurface";
import { cn } from "@/lib/utils";
import { usePrinterSelector } from "@/lib/usePrinter";
import { useExperienceMode } from "@/lib/useExperienceMode";
import { useProfile } from "@/lib/useProfile";
import { readStored, removeStored, writeStored } from "@/lib/safeStorage";
import type { PrinterState } from "@/lib/moonraker";

const STORAGE_KEY = "forge.printer.image";

interface PrinterMeta {
  model: string;
  hostname: string;
  firmware: string;
  klipper: string;
}

/**
 * `output_pin` objects are subscribed via the profile's statusPins; the
 * PrinterState interface predates them, so the read is a local, read-only
 * type refinement — no change to the transport layer.
 */
type WithOutputPins = PrinterState & {
  [pin: `output_pin ${string}`]: { value: number } | undefined;
};

const AXES = ["X", "Y", "Z"] as const;

/**
 * Z6 Readiness module (owner spec): ONE interactive surface — the card body
 * is a single button showing only the persistent layer (ready lamp + word,
 * the K1 Max silhouette, the status line, the light chip). Everything else —
 * hostname, model, OS, Klipper, network, homed axes, the printer-photo
 * feature — lives in the tap-to-open disclosure (ModalSurface: focus trap,
 * Escape, backdrop dismiss, focus restoration).
 */
// memo + a flat selector (WP-MEMO / S5 P2): the card has no props, so a
// Dashboard re-render must never cascade into it; its own selection decides.
export const PrinterCard = memo(function PrinterCard() {
  const profile = useProfile();
  const pin = profile.statusPins?.[0];
  const t = usePrinterSelector((state, connected) => ({
    printerState: state.webhooks?.state,
    printState: state.print_stats?.state,
    // Light: value>0 ON, 0 OFF, undefined (absent object / no telemetry
    // yet) renders `—` — never a false OFF claim.
    ledValue: pin
      ? (state as WithOutputPins)[pin.klipper as `output_pin ${string}`]?.value
      : undefined,
    meshName: state.bed_mesh?.profile_name,
    // undefined = toolhead telemetry unknown (dashes, not a not-homed claim)
    homedStr: state.toolhead ? (state.toolhead.homed_axes ?? "") : undefined,
    connected,
  }));
  const [experienceMode] = useExperienceMode();
  const isExpert = experienceMode === "expert";
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<string | null>(() =>
    readStored(STORAGE_KEY),
  );
  const [meta, setMeta] = useState<Partial<PrinterMeta>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const metaRequested = useRef(false);
  const detailTitleId = useId();

  // One-shot meta moves from mount to FIRST disclosure open (WP-PERF: two
  // fewer cold-path fetches; Settings fetches these endpoints itself).
  useEffect(() => {
    if (!open || metaRequested.current) return;
    metaRequested.current = true;
    fetch("/printer/info")
      .then((r) => r.json())
      .then((d) => {
        const r = d.result;
        setMeta((m) => ({
          ...m,
          hostname: r?.hostname ?? "—",
          klipper: r?.software_version ?? "—",
        }));
      })
      .catch(() => {});
    fetch("/machine/system_info")
      .then((r) => r.json())
      .then((d) => {
        const sd = d.result?.system_info?.distribution;
        const cpu = d.result?.system_info?.cpu_info;
        setMeta((m) => ({
          ...m,
          firmware: sd?.name ? `${sd.name} ${sd.version_id ?? ""}`.trim() : "—",
          model: cpu?.cpu_desc ?? cpu?.model ?? profile.model ?? "K1 Max",
        }));
      })
      .catch(() => {});
  }, [open, profile.model]);

  const isPrinting = t.printState === "printing" || t.printState === "paused";
  const lightOn = t.ledValue != null && t.ledValue > 0;
  const lightKnown = t.ledValue != null;
  const statusLine =
    t.printerState && t.printState
      ? `${t.printerState} · ${t.printState}`
      : "Connecting to printer…";

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      // A large data URL can blow the quota. The picture is decoration, so a
      // refused write still shows the image for this session.
      writeStored(STORAGE_KEY, dataUrl);
      setImage(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    removeStored(STORAGE_KEY);
    setImage(null);
  };

  return (
    <Card
      title="Readiness"
      icon={<Printer />}
      className={cn(
        "transition-colors",
        isPrinting &&
          "border-[color-mix(in_oklab,var(--color-accent)_62%,var(--color-border))]",
      )}
      // Visual affordance only — the whole module body is the trigger.
      action={
        <Info
          aria-hidden="true"
          className="h-3.5 w-3.5 flex-none text-[var(--color-fg-muted)]"
        />
      }
      bodyClassName="flex"
    >
      <button
        type="button"
        className="readiness-module transition-colors duration-[var(--dur-fast)] ease-[var(--ease-standard)]"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="readiness-silhouette">
          <K1MaxSilhouette
            printing={t.printState === "printing"}
            paused={t.printState === "paused"}
            lightOn={lightOn}
          />
        </span>
        <span className="readiness-ready flex items-center gap-2">
          <span className={cn("instrument-label text-[11px]", statusInk(t.printerState))}>
            {t.printerState ?? "—"}
          </span>
        </span>
        {/* Ink color comes from .readiness-status (index.css) so the flat
            hover can brighten it from the same cascade layer. */}
        <span className="readiness-status text-[12px]">
          {statusLine}
        </span>
        <span
          className="readiness-light flex items-center gap-[var(--space-icon)]"
          style={lightOn ? { color: "var(--color-accent)" } : undefined}
        >
          <span
            aria-hidden="true"
            data-lit={lightOn ? "true" : "false"}
            className="telltale-lamp"
          />
          <span className="instrument-label text-[11px]">
            {(pin?.label ?? "Light").toUpperCase()}{" "}
            {lightKnown ? (lightOn ? "ON" : "OFF") : "—"}
          </span>
        </span>
      </button>

      {open && (
        <ModalSurface
          labelledBy={detailTitleId}
          onDismiss={() => setOpen(false)}
          // Same dialog primitive, two skins: centered panel on desk chrome,
          // bottom sheet on compact chrome.
          overlayClassName="compact:items-end compact:p-0"
          panelClassName="max-w-md compact:max-w-none"
        >
          {/* p-4 = --modal-pad: the corner close button keeps the strict
              concentric gap (radius-modal − pad = control radius). */}
          <header className="flex min-h-11 items-center justify-between gap-3 border-b border-[var(--color-border)] p-4">
            <div className="min-w-0">
              <h2
                id={detailTitleId}
                className="truncate text-[17px] font-semibold tracking-tight"
              >
                {meta.hostname ?? "Printer"}
              </h2>
              <p className="instrument-value text-[11px] text-[var(--color-fg-muted)]">
                {meta.model ?? profile.model ?? "—"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              aria-label="Close printer detail"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </Button>
          </header>

          <div className="flex flex-col gap-[var(--stack)] p-4">
            <div className="flex items-center gap-2">
              <span className={cn("text-[12px]", statusInk(t.printerState))}>
                {statusLine}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-3 text-[11px] tabular-nums">
              <Stat label="Hostname" value={meta.hostname} />
              <Stat label="OS" value={meta.firmware} />
              <Stat
                label="Klipper"
                value={meta.klipper?.split("-")[0] ?? meta.klipper}
              />
              <Stat label="Network" value={location.host.replace(/:.*/, "")} />
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-3 text-[11px] tabular-nums">
              <div className="min-w-0">
                <div className="instrument-label text-[11px]">Homed</div>
                {/* Same grammar as the HOMED tell-tale: unknown renders
                    neutral dashes, never a struck-through not-homed claim. */}
                <div className="instrument-value mt-0.5 flex gap-1 text-[11px] font-medium">
                  {AXES.map((axis) =>
                    t.homedStr == null ? (
                      <span key={axis} className="telltale-axis-unknown">
                        —
                      </span>
                    ) : t.homedStr.toLowerCase().includes(axis.toLowerCase()) ? (
                      <span key={axis}>{axis}</span>
                    ) : (
                      <span key={axis} className="telltale-axis-unhomed">
                        {axis}
                      </span>
                    ),
                  )}
                </div>
              </div>
              <Stat
                label="Link"
                value={t.connected ? "connected" : "offline"}
              />
              <Stat
                label="Mesh"
                value={t.meshName ? t.meshName : undefined}
              />
              <Stat label="Camera" value={profile.camera?.streamPath} />
            </div>

            {pin && (
              <p className="border-t border-[var(--color-border)] pt-3 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
                {pin.label} is{" "}
                {lightKnown ? (lightOn ? "on" : "off") : "unknown"}. Light
                control isn't wired up yet — the chamber LED is managed by the
                printer.
              </p>
            )}

            {isExpert && (
              <div className="border-t border-[var(--color-border)] pt-3">
                <div className="instrument-label mb-2 text-[11px]">
                  Printer photo
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden border border-[var(--color-border)] bg-[var(--color-elevated)]">
                    {image ? (
                      <img
                        src={image}
                        alt="Printer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Printer
                        aria-hidden="true"
                        className="h-7 w-7 text-[var(--color-fg-subtle)]"
                        strokeWidth={1.25}
                      />
                    )}
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    className="gap-1 text-[11px] uppercase tracking-[0.05em]"
                  >
                    <Upload aria-hidden="true" className="h-3 w-3" />
                    {image ? "Replace" : "Upload"}
                  </Button>
                  {image && (
                    <Button
                      size="sm"
                      onClick={clearImage}
                      aria-label="Remove printer image"
                      className="text-[var(--color-fg-muted)] hover:text-[var(--color-error)]"
                    >
                      <Trash2 aria-hidden="true" className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </div>
            )}
          </div>
        </ModalSurface>
      )}
    </Card>
  );
});

function Stat({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="min-w-0">
      <div className="instrument-label text-[11px]">{label}</div>
      <div
        className="instrument-value mt-0.5 break-words text-[11px] font-medium leading-snug"
        title={value ?? "—"}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

/**
 * Engine-light rule: the klipper state is carried by the WORD, tinted.
 * The 6x6 `.status-lamp` square that used to sit beside it was aria-hidden
 * decoration that duplicated the word, and it was the one element
 * forced-colors flattened to zero contrast (working.md's known-minor).
 * Deleting it loses no channel and closes that defect.
 */
function statusInk(state: string | undefined): string {
  if (state === "ready") return "text-[var(--color-success)]";
  return state ? "text-[var(--color-error)]" : "text-[var(--color-fg-muted)]";
}

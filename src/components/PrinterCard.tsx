import { useEffect, useRef, useState } from "react";
import { Printer, Upload, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrinter } from "@/lib/usePrinter";
import { useExperienceMode } from "@/lib/useExperienceMode";

const STORAGE_KEY = "forge.printer.image";

interface PrinterMeta {
  model: string;
  hostname: string;
  ip: string;
  firmware: string;
  klipper: string;
  uptime: string;
}

/**
 * Top-of-dashboard card. Image or icon on the left, key printer stats on the
 * right in a tight grid.
 */
export function PrinterCard() {
  const { state } = usePrinter();
  const [experienceMode] = useExperienceMode();
  const isExpert = experienceMode === "expert";
  const [image, setImage] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const [meta, setMeta] = useState<Partial<PrinterMeta>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch one-shot meta on mount
  useEffect(() => {
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
          firmware: sd?.name
            ? `${sd.name} ${sd.version_id ?? ""}`.trim()
            : "—",
          model: cpu?.cpu_desc ?? cpu?.model ?? "K1 Max",
        }));
      })
      .catch(() => {});
  }, []);

  const printerState = state.webhooks?.state;
  const printState = state.print_stats?.state;
  const isPrinting = printState === "printing" || printState === "paused";

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      localStorage.setItem(STORAGE_KEY, dataUrl);
      setImage(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    localStorage.removeItem(STORAGE_KEY);
    setImage(null);
  };

  return (
    <section
      className={cn(
        "instrument-panel overflow-hidden transition-colors",
        isPrinting
          ? "border-[color-mix(in_oklch,var(--color-accent)_62%,var(--color-border))]"
          : "",
      )}
    >
      <div className="grid grid-cols-[76px_1fr] gap-3 p-[var(--card-pad)] sm:grid-cols-[112px_1fr]">
        {/* Image / icon */}
        <div className="relative group">
          <div
            className={cn(
              "flex aspect-square items-center justify-center overflow-hidden border border-[var(--color-border)] bg-[var(--color-elevated)]",
              image
                ? "bg-black"
                : "",
            )}
          >
            {image ? (
              <img
                src={image}
                alt="Printer"
                className="w-full h-full object-cover"
              />
            ) : (
              <Printer
                className="h-10 w-10 text-[var(--color-accent)] sm:h-14 sm:w-14"
                strokeWidth={1.25}
              />
            )}
          </div>
          {/* Upload overlay */}
          {isExpert && <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/72 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex min-h-11 min-w-11 items-center gap-1 rounded-lg bg-[var(--color-accent)] px-3 text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)]"
            >
              <Upload className="w-3 h-3" />
              {image ? "Replace" : "Upload"}
            </button>
            {image && (
              <button
                onClick={clearImage}
                aria-label="Remove printer image"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-[var(--color-elevated)] text-[var(--color-fg-muted)] hover:text-[var(--color-error)]"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>}
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

        {/* Stats column */}
        <div className="flex flex-col justify-between">
          <div>
            <div className="instrument-label">
              Readiness
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="text-[clamp(1.125rem,2vw,1.5rem)] font-semibold tracking-[-0.03em]">
                {meta.hostname ?? "Forge"}
              </h2>
              <span className="instrument-value text-[11px] text-[var(--color-fg-muted)]">
                {meta.model ?? "Creality K1 Max"}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <StatusDot state={printerState} />
              <span className="text-[12px] text-[var(--color-fg-muted)]">
                {printerState && printState
                  ? `${printerState} · ${printState}`
                  : "Connecting to printer…"}
              </span>
            </div>
          </div>

          {/* Machine meta rides in both modes — read-only vitals cost nothing
              and fill the panel with information instead of empty glass. */}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-3 text-[11px] tabular-nums">
            <Stat label="Hostname" value={meta.hostname} />
            <Stat label="OS" value={meta.firmware} />
            <Stat
              label="Klipper"
              value={meta.klipper?.split("-")[0] ?? meta.klipper}
            />
            <Stat
              label="Network"
              value={location.host.replace(/:.*/, "")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="min-w-0">
      <div className="instrument-label text-[11px]">
        {label}
      </div>
      <div
        className="instrument-value mt-0.5 break-words text-[11px] font-medium leading-snug"
        title={value ?? "—"}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function StatusDot({ state }: { state: string | undefined }) {
  const ok = state === "ready";
  // aria-hidden like every other lamp in the app: the sibling text carries
  // the state, so AT must not be handed a bare unnamed color-only element.
  return (
    <span
      aria-hidden="true"
      className={cn(
        "status-lamp",
        ok
          ? "text-[var(--color-success)]"
          : state
            ? "text-[var(--color-error)]"
            : "text-[var(--color-fg-muted)]",
      )}
    />
  );
}

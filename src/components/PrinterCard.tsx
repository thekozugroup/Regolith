import { useEffect, useRef, useState } from "react";
import { Printer, Upload, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrinter } from "@/lib/usePrinter";

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

  const printerState = state.webhooks?.state ?? "—";
  const printState = state.print_stats?.state ?? "—";
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
        "bg-[var(--color-surface)] border rounded-md overflow-hidden transition-colors",
        isPrinting
          ? "border-[rgba(249,115,22,0.4)] shadow-[0_0_0_1px_rgba(249,115,22,0.15),0_0_24px_-8px_rgba(249,115,22,0.4)]"
          : "border-[var(--color-border)]",
      )}
    >
      <div className="grid grid-cols-[160px_1fr] gap-4 p-4">
        {/* Image / icon */}
        <div className="relative group">
          <div
            className={cn(
              "aspect-square rounded-md border border-[var(--color-border)] flex items-center justify-center overflow-hidden",
              image
                ? "bg-black"
                : "bg-gradient-to-br from-[var(--color-elevated)] to-[var(--color-bg)]",
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
                className="w-16 h-16 text-[var(--color-accent)]/60"
                strokeWidth={1.25}
              />
            )}
          </div>
          {/* Upload overlay */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-md opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
            <button
              onClick={() => fileRef.current?.click()}
              className="px-2 py-1 rounded-sm bg-[var(--color-accent)] text-white text-[10px] font-medium uppercase tracking-[0.05em] hover:bg-[var(--color-accent-hover)] flex items-center gap-1"
            >
              <Upload className="w-3 h-3" />
              {image ? "Replace" : "Upload"}
            </button>
            {image && (
              <button
                onClick={clearImage}
                className="px-2 py-1 rounded-sm bg-[var(--color-elevated)] text-[var(--color-fg-muted)] text-[10px] hover:text-[var(--color-error)]"
              >
                <Trash2 className="w-3 h-3" />
              </button>
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

        {/* Stats column */}
        <div className="flex flex-col justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-fg-muted)] font-semibold">
              Printer
            </div>
            <div className="flex items-baseline gap-3 mt-0.5">
              <h1 className="text-[22px] font-semibold tracking-tight">
                {meta.hostname ?? "Forge"}
              </h1>
              <span className="text-[12px] text-[var(--color-fg-muted)] font-mono">
                {meta.model ?? "Creality K1 Max"}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <StatusDot state={printerState} />
              <span className="text-[11px] text-[var(--color-fg-muted)] uppercase tracking-[0.08em]">
                {printerState} · {printState}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 mt-4 text-[11px] tabular-nums">
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
    <div>
      <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
        {label}
      </div>
      <div
        className="text-[12px] font-medium font-mono mt-0.5 truncate"
        title={value ?? "—"}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function StatusDot({ state }: { state: string }) {
  const ok = state === "ready";
  return (
    <span
      className={cn(
        "w-1.5 h-1.5 rounded-full",
        ok
          ? "bg-[var(--color-success)] shadow-[0_0_6px_rgba(16,185,129,0.5)]"
          : "bg-[var(--color-error)]",
      )}
    />
  );
}

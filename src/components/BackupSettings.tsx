import { useRef, useState } from "react";
import { Card } from "./Card";
import { Button } from "./Button";
import { Download, Upload, Trash2, Database } from "lucide-react";

/**
 * Settings export / import / wipe.
 *
 * Operates on browser-side state only (localStorage) — does NOT touch
 * printer.cfg or anything on the printer. For that, see the printer.cfg
 * snapshot already produced daily by /usr/data/scripts/forge-hardening.sh.
 *
 * Exported JSON includes:
 *   - device name
 *   - accent color
 *   - brand icon (image data URL or lucide name)
 *   - printer image
 *   - keyboard / panel-hide preferences (any forge.* keys)
 */

const FORGE_PREFIX = "forge.";

interface ExportPayload {
  exportedAt: string;
  version: 1;
  data: Record<string, unknown>;
}

export function BackupSettings() {
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportData = () => {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(FORGE_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (raw == null) continue;
        try {
          data[k] = JSON.parse(raw);
        } catch {
          data[k] = raw;
        }
      } catch {
        /* skip */
      }
    }
    const payload: ExportPayload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `forge-settings-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${Object.keys(data).length} entries`);
  };

  const importData = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result)) as ExportPayload;
        if (payload.version !== 1 || !payload.data) {
          throw new Error("Invalid backup file format");
        }
        let count = 0;
        for (const [k, v] of Object.entries(payload.data)) {
          if (!k.startsWith(FORGE_PREFIX)) continue;
          localStorage.setItem(
            k,
            typeof v === "string" ? v : JSON.stringify(v),
          );
          count++;
        }
        setStatus(`Imported ${count} entries — reloading…`);
        setTimeout(() => location.reload(), 1200);
      } catch (e) {
        setStatus(`Import failed: ${(e as Error).message}`);
      }
    };
    reader.readAsText(file);
  };

  const wipe = () => {
    if (
      !confirm(
        "Reset all UI settings to defaults?\nDevice name, theme, brand icon, printer image, all preferences will be cleared. Printer config is NOT affected.",
      )
    )
      return;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(FORGE_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    setStatus(`Cleared ${toRemove.length} entries — reloading…`);
    setTimeout(() => location.reload(), 1200);
  };

  return (
    <Card title="Backup & Restore" icon={<Database />}>
      <div className="space-y-3">
        <div className="text-[11px] text-[var(--color-fg-muted)] leading-relaxed">
          UI preferences (device name, theme, brand icon, custom images, panel
          state) live in browser storage. Export to move them to another device
          or back them up before a browser reset. Printer config is{" "}
          <span className="text-[var(--color-fg)] font-medium">
            separately backed up daily
          </span>{" "}
          by <code className="text-[var(--color-accent)]">forge-hardening</code>{" "}
          on the printer.
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={exportData} variant="default" size="md">
            <Download className="w-3 h-3" /> Export
          </Button>
          <Button
            onClick={() => fileRef.current?.click()}
            variant="default"
            size="md"
          >
            <Upload className="w-3 h-3" /> Import
          </Button>
        </div>

        <Button onClick={wipe} variant="danger" size="md" className="w-full">
          <Trash2 className="w-3 h-3" /> Reset all UI settings
        </Button>

        {status && (
          <div className="text-[11px] text-[var(--color-accent)] tabular-nums pt-1">
            {status}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importData(f);
          }}
        />
      </div>
    </Card>
  );
}

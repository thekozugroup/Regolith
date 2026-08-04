import { useRef, useState } from "react";
import { Card } from "./Card";
import { Button } from "./Button";
import { ActionConfirmDialog } from "./ActionConfirmDialog";
import { Download, Upload, Trash2, Database } from "lucide-react";
import {
  readStored,
  removeStored,
  storedKeys,
  writeStored,
} from "@/lib/safeStorage";

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
    for (const k of storedKeys(FORGE_PREFIX)) {
      const raw = readStored(k);
      if (raw == null) continue;
      try {
        data[k] = JSON.parse(raw);
      } catch {
        data[k] = raw;
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
          const written = writeStored(
            k,
            typeof v === "string" ? v : JSON.stringify(v),
          );
          if (written) count++;
        }
        setStatus(`Imported ${count} entries — reloading…`);
        setTimeout(() => location.reload(), 1200);
      } catch (e) {
        setStatus(`Import failed: ${(e as Error).message}`);
      }
    };
    reader.readAsText(file);
  };

  // In-app confirmation, never `window.confirm` — the native dialog blocks
  // the main thread and freezes the HealthAlerts watchdog while open.
  const [confirmingWipe, setConfirmingWipe] = useState(false);

  const wipe = () => {
    setConfirmingWipe(false);
    const toRemove = storedKeys(FORGE_PREFIX);
    toRemove.forEach(removeStored);
    setStatus(`Cleared ${toRemove.length} entries — reloading…`);
    setTimeout(() => location.reload(), 1200);
  };

  return (
    <Card title="Backup & Restore" icon={<Database />} className="lg:col-span-2">
      {/* flex gap, not space-y: stack spacing must come from the container,
          never as a margin ON a Button (owner even-chrome rule). */}
      <div className="flex flex-col gap-3">
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

        <Button
          onClick={() => setConfirmingWipe(true)}
          variant="danger"
          size="md"
          className="w-full"
        >
          <Trash2 className="w-3 h-3" /> Reset all UI settings
        </Button>

        {confirmingWipe && (
          <ActionConfirmDialog
            details={{
              risk: "critical",
              title: "Reset all UI settings?",
              message:
                "Device name, theme, brand icon, printer image, and every saved preference return to their defaults, then the page reloads. The printer's own configuration isn't affected.",
              confirmLabel: "Reset settings",
            }}
            onConfirm={wipe}
            onCancel={() => setConfirmingWipe(false)}
          />
        )}

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

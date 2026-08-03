import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Film, Download, Trash2, Play, RefreshCw } from "lucide-react";
import { formatBytes, cn } from "@/lib/utils";

interface TimelapseFile {
  path: string;
  size: number;
  modified: number;
}

export function Timelapses() {
  const [files, setFiles] = useState<TimelapseFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<TimelapseFile | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/server/files/list?root=timelapse");
      if (!res.ok) throw new Error(`Could not load timelapses (${res.status}).`);
      const data = await res.json();
      const list = (data.result ?? []) as TimelapseFile[];
      // Show only video files (mp4/avi/mov), sorted newest first
      const videos = list
        .filter((f) => /\.(mp4|avi|mov|webm)$/i.test(f.path))
        .sort((a, b) => b.modified - a.modified);
      setFiles(videos);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (file: TimelapseFile) => {
    if (!confirm(`Delete timelapse "${file.path}"? This is permanent.`)) return;
    try {
      const res = await fetch(
        `/server/files/timelapse/${encodeURIComponent(file.path)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSelected(null);
      await load();
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  };

  const downloadUrl = (file: TimelapseFile) =>
    `/server/files/timelapse/${encodeURIComponent(file.path)}`;

  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-3 p-[clamp(0.75rem,2vw,1.5rem)] md:grid-cols-8 lg:grid-cols-12">
      <Card
        title="Timelapses"
        icon={<Film />}
        className="md:col-span-3 lg:col-span-5"
        action={
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      >
        <div className="sr-only" role="status" aria-live="polite">
          {loading
            ? "Loading timelapses."
            : err
              ? "Timelapses could not be loaded."
              : `${files.length} timelapses available.`}
        </div>
        <div aria-busy={loading}>
        {err && (
          <div className="text-[12px] text-[var(--color-error)] py-3 text-center">
            {err}
          </div>
        )}
        {!err && !loading && files.length === 0 && (
          <div className="py-8 text-center">
            <Film className="w-8 h-8 mx-auto text-[var(--color-fg-muted)]/30 mb-2" />
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">
              No timelapses yet
            </div>
            <div className="text-[11px] text-[var(--color-fg-muted)]/70 mt-1">
              Enable per-print on the Files page.
            </div>
          </div>
        )}
        <ul className="divide-y divide-[var(--color-border)] max-h-[60vh] overflow-y-auto -mx-[clamp(0.75rem,1.4vw,1.25rem)]">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                aria-pressed={selected?.path === f.path}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 border-l-2 border-transparent px-[clamp(0.75rem,1.4vw,1.25rem)] py-2 text-left transition-colors",
                  selected?.path === f.path
                    ? "border-l-[var(--color-accent)] bg-(--color-accent)/8"
                    : "hover:bg-[var(--color-elevated)]",
                )}
                onClick={() => setSelected(f)}
              >
                <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-sm border border-[var(--color-border)] bg-black">
                  <Film className="w-4 h-4 text-[var(--color-fg-muted)]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">
                    {f.path}
                  </span>
                  <span className="block text-[11px] text-[var(--color-fg-muted)] tabular-nums">
                    {formatBytes(f.size)} ·{" "}
                    {new Date(f.modified * 1000).toLocaleString()}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        </div>
      </Card>

      <Card title="Preview" icon={<Play />} className="md:col-span-5 lg:col-span-7">
        {!selected ? (
          <div className="py-12 text-center text-[var(--color-fg-muted)] text-[12px] uppercase tracking-[0.1em]">
            Select a timelapse to play
          </div>
        ) : (
          <div className="space-y-3">
            <video
              key={selected.path}
              src={downloadUrl(selected)}
              controls
              className="w-full rounded-md border border-[var(--color-border)] bg-black aspect-video"
            />
            <div className="text-[12px] font-mono break-all" title={selected.path}>
              {selected.path}
            </div>
            <div className="text-[11px] text-[var(--color-fg-muted)]">
              {formatBytes(selected.size)} ·{" "}
              {new Date(selected.modified * 1000).toLocaleString()}
            </div>
            <div className="flex gap-2 pt-2">
              <a
                href={downloadUrl(selected)}
                download={selected.path}
                className="inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 text-[12px] font-medium hover:bg-[var(--color-surface)]"
              >
                <Download className="w-3 h-3" /> Download
              </a>
              <Button size="md" variant="danger" onClick={() => remove(selected)}>
                <Trash2 className="w-3 h-3" /> Delete
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

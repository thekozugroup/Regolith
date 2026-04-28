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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
      <Card
        title="Timelapses"
        icon={<Film />}
        action={
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      >
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
        <ul className="divide-y divide-[rgba(63,63,70,0.4)] max-h-[60vh] overflow-y-auto -mx-3.5">
          {files.map((f) => (
            <li
              key={f.path}
              className={cn(
                "flex items-center gap-3 py-2 px-3.5 cursor-pointer transition-colors",
                selected?.path === f.path
                  ? "bg-[rgba(249,115,22,0.10)]"
                  : "hover:bg-[rgba(249,115,22,0.04)]",
              )}
              onClick={() => setSelected(f)}
            >
              <div className="w-12 h-9 bg-black border border-[var(--color-border)] rounded-sm flex items-center justify-center shrink-0">
                <Film className="w-4 h-4 text-[var(--color-fg-muted)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate">
                  {f.path}
                </div>
                <div className="text-[10px] text-[var(--color-fg-muted)] tabular-nums">
                  {formatBytes(f.size)} ·{" "}
                  {new Date(f.modified * 1000).toLocaleString()}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Preview" icon={<Play />}>
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
                className="inline-flex items-center gap-1.5 h-7.5 px-3 text-[12px] font-medium rounded-sm bg-[var(--color-elevated)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]"
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

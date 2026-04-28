import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { moonraker, type MoonrakerFile } from "@/lib/moonraker";
import { formatBytes } from "@/lib/utils";
import { FileText, Play } from "lucide-react";

export function Files() {
  const [files, setFiles] = useState<MoonrakerFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    moonraker
      .listFiles()
      .then((f) => {
        setFiles(f.sort((a, b) => b.modified - a.modified));
        setLoading(false);
      })
      .catch((e) => {
        setErr(e.message);
        setLoading(false);
      });
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3">
      <Card title="Files" icon={<FileText />} className="md:col-span-2">
        {loading && (
          <div className="text-[12px] text-[var(--color-fg-muted)] py-4 text-center uppercase tracking-[0.1em]">
            Loading…
          </div>
        )}
        {err && (
          <div className="text-[12px] text-[var(--color-error)] py-4 text-center">
            {err}
          </div>
        )}
        {!loading && !err && files.length === 0 && (
          <div className="text-[12px] text-[var(--color-fg-muted)] py-4 text-center uppercase tracking-[0.1em]">
            No files
          </div>
        )}
        <ul className="divide-y divide-[rgba(63,63,70,0.4)]">
          {files.map((f) => (
            <li
              key={f.path}
              className="flex items-center gap-3 py-2 hover:bg-[rgba(249,115,22,0.04)] -mx-3.5 px-3.5 group"
            >
              <img
                src={moonraker.thumbnailUrl(f.path, 32)}
                onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0")}
                className="w-8 h-8 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] object-cover"
                alt=""
              />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate">
                  {f.path}
                </div>
                <div className="text-[11px] text-[var(--color-fg-muted)] tabular-nums">
                  {formatBytes(f.size)} ·{" "}
                  {new Date(f.modified * 1000).toLocaleString()}
                </div>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => moonraker.startPrint(f.path)}
                className="opacity-0 group-hover:opacity-100"
              >
                <Play className="w-3 h-3" /> Print
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

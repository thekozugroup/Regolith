import { useEffect, useState } from "react";
import { Card } from "./Card";
import { Button } from "./Button";
import { History, Check, X, RefreshCw } from "lucide-react";
import { formatDuration, cn } from "@/lib/utils";

interface HistoryJob {
  job_id: string;
  exists: boolean;
  end_time?: number;
  filament_used: number;
  filename: string;
  metadata: {
    estimated_time?: number;
    filament_total?: number;
    filament_weight_total?: number;
  };
  print_duration: number;
  status: "completed" | "cancelled" | "klippy_shutdown" | "interrupted" | "in_progress" | "server_exit";
  start_time: number;
  total_duration: number;
}

export function PrintHistory() {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    total_jobs: number;
    total_time: number;
    total_filament_used: number;
    longest_job: number;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [list, totals] = await Promise.all([
        fetch("/server/history/list?limit=20&order=desc").then((r) => r.json()),
        fetch("/server/history/totals").then((r) => r.json()),
      ]);
      setJobs(list.result?.jobs ?? []);
      setStats(totals.result?.job_totals ?? null);
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

  return (
    <Card
      title="Print History"
      icon={<History />}
      action={
        <Button size="sm" variant="ghost" onClick={load}>
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      {/* Top stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-3 pb-3 border-b border-[var(--color-border)] mb-2">
          <Stat label="Total prints" value={stats.total_jobs.toString()} />
          <Stat
            label="Total time"
            value={formatDuration(stats.total_time)}
          />
          <Stat
            label="Filament used"
            value={
              stats.total_filament_used
                ? `${(stats.total_filament_used / 1000).toFixed(1)} m`
                : "0 m"
            }
          />
          <Stat
            label="Longest"
            value={formatDuration(stats.longest_job)}
          />
        </div>
      )}

      {err && (
        <div className="text-[12px] text-[var(--color-error)] py-3 text-center">
          {err}
        </div>
      )}
      {!err && !loading && jobs.length === 0 && (
        <div className="py-8 text-center">
          <History className="w-8 h-8 mx-auto text-[var(--color-fg-muted)]/30 mb-2" />
          <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">
            No prints yet
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <ul className="divide-y divide-[rgba(63,63,70,0.4)] -mx-3.5">
          {jobs.map((j) => {
            const success = j.status === "completed";
            const date = j.end_time ?? j.start_time;
            return (
              <li
                key={j.job_id}
                className="flex items-center gap-3 py-2 px-3.5 hover:bg-[rgba(249,115,22,0.04)]"
              >
                <span
                  className={cn(
                    "shrink-0 w-5 h-5 rounded-full flex items-center justify-center",
                    success
                      ? "bg-[rgba(16,185,129,0.15)] text-[var(--color-success)]"
                      : "bg-[rgba(239,68,68,0.15)] text-[var(--color-error)]",
                  )}
                  title={j.status}
                >
                  {success ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium truncate font-mono">
                    {j.filename}
                  </div>
                  <div className="text-[10px] text-[var(--color-fg-muted)] tabular-nums">
                    {new Date(date * 1000).toLocaleString()} ·{" "}
                    {formatDuration(j.print_duration)}
                    {j.filament_used
                      ? ` · ${(j.filament_used / 1000).toFixed(2)} m`
                      : ""}
                  </div>
                </div>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded-sm border text-[9px] font-bold uppercase tracking-[0.1em]",
                    success
                      ? "text-[var(--color-success)] bg-[rgba(16,185,129,0.10)] border-[rgba(16,185,129,0.3)]"
                      : "text-[var(--color-error)] bg-[rgba(239,68,68,0.10)] border-[rgba(239,68,68,0.3)]",
                  )}
                >
                  {j.status.replace(/_/g, " ")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
        {label}
      </div>
      <div className="text-[14px] font-semibold tabular-nums font-mono mt-0.5">
        {value}
      </div>
    </div>
  );
}

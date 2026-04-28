import { useEffect, useState } from "react";
import { Layers, RefreshCw } from "lucide-react";
import { Card } from "./Card";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

interface BedMeshData {
  profile_name: string;
  mesh_min: [number, number];
  mesh_max: [number, number];
  // Probed grid before bilinear interpolation
  probed_matrix: number[][];
  // Final smoothed mesh
  mesh_matrix: number[][];
  // Calibration metadata
  mesh_params: Record<string, number | string>;
}

/**
 * Fetches the active bed mesh from /printer/objects/query?bed_mesh
 * and renders the probed grid as a heat map.
 *
 * Read-only — reading state never disrupts a running calibration.
 */
export function BedMeshHeatmap() {
  const [mesh, setMesh] = useState<BedMeshData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/printer/objects/query?bed_mesh");
      const data = await res.json();
      const bm = data?.result?.status?.bed_mesh;
      if (!bm || !bm.probed_matrix || bm.probed_matrix.length === 0) {
        setMesh(null);
      } else {
        setMesh(bm as BedMeshData);
      }
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
      title="Bed Mesh"
      icon={<Layers />}
      action={
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      {err && (
        <div className="text-[12px] text-[var(--color-error)] py-4 text-center">
          {err}
        </div>
      )}
      {!err && loading && !mesh && (
        <div className="text-[11px] text-[var(--color-fg-muted)] py-4 text-center uppercase tracking-[0.1em]">
          Loading…
        </div>
      )}
      {!err && !loading && !mesh && (
        <div className="py-6 text-center">
          <div className="text-[11px] text-[var(--color-fg-muted)] uppercase tracking-[0.12em] mb-1">
            No mesh saved
          </div>
          <div className="text-[11px] text-[var(--color-fg-muted)]/70">
            Run "Calibrate Bed Mesh" above to generate one.
          </div>
        </div>
      )}
      {mesh && <MeshGrid mesh={mesh} />}
    </Card>
  );
}

function MeshGrid({ mesh }: { mesh: BedMeshData }) {
  const matrix = mesh.probed_matrix;
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const flat = matrix.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const range = Math.max(0.01, max - min); // avoid div0
  const meanZ = flat.reduce((s, n) => s + n, 0) / flat.length;
  const peakToPeak = max - min;

  // Color: bilinear from cool (low) → fg muted (mid) → warm (high)
  const colorFor = (v: number): string => {
    const norm = (v - min) / range; // 0..1
    if (norm < 0.5) {
      // low (cool blue → neutral)
      const t = norm * 2; // 0..1
      const r = Math.round(59 + (39 - 59) * t);
      const g = Math.round(130 + (39 - 130) * t);
      const b = Math.round(246 + (42 - 246) * t);
      return `rgb(${r},${g},${b})`;
    }
    // mid → high (neutral → orange/red)
    const t = (norm - 0.5) * 2; // 0..1
    const r = Math.round(39 + (249 - 39) * t);
    const g = Math.round(39 + (115 - 39) * t);
    const b = Math.round(42 + (22 - 42) * t);
    return `rgb(${r},${g},${b})`;
  };

  return (
    <div className="space-y-3">
      {/* Header stats */}
      <div className="flex items-center justify-between text-[11px]">
        <div className="text-[var(--color-fg-muted)] uppercase tracking-[0.1em] font-semibold">
          Profile · {mesh.profile_name}
        </div>
        <div className="font-mono tabular-nums text-[var(--color-fg-muted)]">
          {rows}×{cols}
        </div>
      </div>

      {/* The grid */}
      <div className="rounded-md border border-[var(--color-border)] overflow-hidden bg-black p-2">
        <div
          className="grid gap-px"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            aspectRatio: cols / rows,
          }}
        >
          {/* Mesh rows: probed_matrix is indexed [row][col] from FRONT-LEFT.
              We render row 0 at the BOTTOM so the visual matches the bed orientation. */}
          {[...matrix]
            .reverse()
            .flatMap((row, rIdx) =>
              row.map((v, cIdx) => {
                const deviation = v - meanZ;
                return (
                  <div
                    key={`${rIdx}-${cIdx}`}
                    className="aspect-square relative group flex items-center justify-center"
                    style={{ backgroundColor: colorFor(v) }}
                  >
                    <span className="font-mono text-[8px] tabular-nums text-white/85 mix-blend-luminosity pointer-events-none">
                      {deviation >= 0 ? "+" : ""}
                      {deviation.toFixed(2)}
                    </span>
                  </div>
                );
              }),
            )}
        </div>
      </div>

      {/* Footer stats */}
      <div className="grid grid-cols-3 gap-3 text-[11px]">
        <Stat label="Min Z" value={`${min.toFixed(3)}`} />
        <Stat label="Max Z" value={`${max.toFixed(3)}`} />
        <Stat
          label="Variance"
          value={`${peakToPeak.toFixed(3)} mm`}
          warn={peakToPeak > 0.2}
        />
      </div>

      {/* Color scale */}
      <div className="flex items-center gap-2 text-[10px] tabular-nums text-[var(--color-fg-muted)]">
        <span>{min.toFixed(2)}</span>
        <div
          className="flex-1 h-1.5 rounded-sm"
          style={{
            background:
              "linear-gradient(90deg, rgb(59,130,246), rgb(39,39,42), rgb(249,115,22))",
          }}
        />
        <span>{max.toFixed(2)}</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
        {label}
      </div>
      <div
        className={cn(
          "text-[13px] font-semibold tabular-nums font-mono mt-0.5",
          warn && "text-[var(--color-warning)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

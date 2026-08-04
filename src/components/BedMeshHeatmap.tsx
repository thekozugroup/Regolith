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
    // `load` settles its own errors into state; `void` marks the floating
    // call deliberate for @typescript-eslint/no-floating-promises.
    void load();
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
          <div className="text-[11px] text-[var(--color-fg-subtle)]">
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

  // Color: token-driven ramp, low → mid → high as info → elevated → error.
  // color-mix in oklab (rectangular — a polar mix could drag hues through
  // the wheel), so the ramp follows the theme instead of hand-rolled v3
  // channel math whose hot end was the retired legacy orange.
  const colorFor = (v: number): string => {
    const norm = (v - min) / range; // 0..1
    if (norm < 0.5) {
      const pct = Math.round((1 - norm * 2) * 100); // 100 → 0
      return `color-mix(in oklab, var(--color-info) ${pct}%, var(--color-elevated))`;
    }
    const pct = Math.round((norm - 0.5) * 2 * 100); // 0 → 100
    return `color-mix(in oklab, var(--color-error) ${pct}%, var(--color-elevated))`;
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
      <div className="rounded-inner border border-[var(--color-border)] overflow-hidden bg-black p-2">
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
                    <span className="font-mono text-[11px] tabular-nums text-white/85 mix-blend-luminosity pointer-events-none">
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

      {/* Discrete legend keeps the scale readable. */}
      <div className="flex items-center gap-2 text-[11px] tabular-nums text-[var(--color-fg-muted)]">
        <span>{min.toFixed(2)}</span>
        <div aria-hidden="true" className="flex h-1.5 flex-1 overflow-hidden">
          <span className="flex-1 bg-[var(--color-info)]" />
          <span className="flex-1 bg-[var(--color-elevated)]" />
          <span className="flex-1 bg-[var(--color-error)]" />
        </div>
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
      <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
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

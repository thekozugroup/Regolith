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
 * True only when the payload carries at least one finite probe height.
 * `probed_matrix: [[]]` and a matrix of nulls both survive a length check
 * and then poison every statistic downstream.
 */
function hasProbePoints(bm: unknown): bm is BedMeshData {
  if (!bm || typeof bm !== "object") return false;
  const matrix = (bm as { probed_matrix?: unknown }).probed_matrix;
  if (!Array.isArray(matrix)) return false;
  return matrix.some(
    (row) => Array.isArray(row) && row.some((v) => typeof v === "number" && Number.isFinite(v)),
  );
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
      // A `probed_matrix` of `[[]]` passes a plain length check but has no
      // probe points at all: Math.min(...[]) is Infinity and sum/0 is NaN,
      // and both reached the glass as the literal strings "Infinity" and
      // "NaN". Require at least one finite sample before claiming a mesh.
      setMesh(hasProbePoints(bm) ? (bm as BedMeshData) : null);
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
  // Only finite samples feed the statistics. `hasProbePoints` guarantees at
  // least one, so min/max/mean can never be Infinity or NaN from here on —
  // the two values that used to render as literal "Infinity" / "NaN" text.
  const flat = matrix.flat().filter((v) => Number.isFinite(v));
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const range = Math.max(0.01, max - min); // avoid div0
  const meanZ = flat.reduce((s, n) => s + n, 0) / flat.length;
  const peakToPeak = max - min;
  const num = (v: number, dp: number) => (Number.isFinite(v) ? v.toFixed(dp) : "—");

  // Color: token-driven ramp, low → mid → high as info → elevated → error.
  // color-mix in oklab (rectangular — a polar mix could drag hues through
  // the wheel), so the ramp follows the theme instead of hand-rolled v3
  // channel math whose hot end was the retired legacy orange.
  const colorFor = (v: number): string => {
    if (!Number.isFinite(v)) return "var(--color-elevated)";
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
        <div className="tabular-nums text-[var(--color-fg-muted)]">
          {rows}×{cols}
        </div>
      </div>

      {/* A11y: the grid below is colour fills plus numerals drawn with
          `mix-blend-luminosity` — a channel whose contrast is unmeasurable
          by construction and which no assistive tech can read at all. This
          table is the non-visual representation of the same data: the real
          min, max and peak-to-peak range, then every probed height by row
          and column. It is the accessible truth; the heat map is the
          at-a-glance view of it. Rows are named FRONT-first, matching both
          klipper's [row][col] indexing and the rendered orientation. */}
      <table className="sr-only">
        <caption>
          Probed bed mesh {rows} by {cols}, profile {mesh.profile_name}. Minimum{" "}
          {num(min, 3)} millimetres, maximum {num(max, 3)} millimetres, range
          peak to peak {num(peakToPeak, 3)} millimetres.
        </caption>
        <thead>
          <tr>
            <th scope="col">Row</th>
            {Array.from({ length: cols }, (_, c) => (
              <th key={c} scope="col">
                Column {c + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, rIdx) => (
            <tr key={rIdx}>
              <th scope="row">
                {rIdx === 0 ? "Row 1 (front)" : rIdx === rows - 1 ? `Row ${rows} (back)` : `Row ${rIdx + 1}`}
              </th>
              {row.map((v, cIdx) => (
                <td key={cIdx}>{num(v, 3)} mm</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* The grid */}
      <div aria-hidden="true" className="rounded-inner border border-[var(--color-border)] overflow-hidden bg-black p-2">
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
                    <span
                      aria-hidden="true"
                      className="text-[11px] tabular-nums text-white/85 mix-blend-luminosity pointer-events-none"
                    >
                      {Number.isFinite(deviation)
                        ? `${deviation >= 0 ? "+" : ""}${deviation.toFixed(2)}`
                        : "—"}
                    </span>
                  </div>
                );
              }),
            )}
        </div>
      </div>

      {/* Footer stats */}
      <div className="grid grid-cols-3 gap-3 text-[11px]">
        <Stat label="Min Z" value={num(min, 3)} />
        <Stat label="Max Z" value={num(max, 3)} />
        {/* This is max − min, which is the RANGE. "Variance" is a different
            statistic and the label was simply the wrong word for the number
            underneath it. */}
        <Stat
          label="Range (p-p)"
          value={`${num(peakToPeak, 3)} mm`}
          warn={peakToPeak > 0.2}
        />
      </div>

      {/* Discrete legend keeps the scale readable. */}
      <div
        aria-hidden="true"
        className="flex items-center gap-2 text-[11px] tabular-nums text-[var(--color-fg-muted)]"
      >
        <span>{num(min, 2)}</span>
        <div className="flex h-1.5 flex-1 overflow-hidden">
          <span className="flex-1 bg-[var(--color-info)]" />
          <span className="flex-1 bg-[var(--color-elevated)]" />
          <span className="flex-1 bg-[var(--color-error)]" />
        </div>
        <span>{num(max, 2)}</span>
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
          "text-[13px] font-semibold tabular-nums mt-0.5",
          warn && "text-[var(--color-warning)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

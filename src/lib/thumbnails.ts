/**
 * Embedded gcode previews, resolved from what Moonraker REPORTS rather than
 * from a guessed URL.
 *
 * The Fluidd convention — `<dir>/.thumbs/<basename>-300x300.png` — is a
 * convention, not a promise. Slicers are not required to embed a preview at
 * all, and plenty of real files have none, so probing that path blind meant a
 * 404 for every thumbless job: an `<img>` that fails, a red line in the
 * console, and a request on a machine whose whole job is to keep answering
 * the print loop. On a dashboard that reloads all day, that is permanent
 * noise hiding the errors that matter.
 *
 * `/server/files/metadata` already lists the previews a file actually
 * contains. Asking first turns a doomed request into no request.
 */

export interface EmbeddedThumbnail {
  width?: number;
  height?: number;
  size?: number;
  /** Path relative to the gcode file's own directory. */
  relative_path?: string;
}

/**
 * Choose the best embedded preview at or above `minWidth`, or the largest
 * available if none reach it. Returns the raw `relative_path`, or null when
 * the file genuinely has no preview — which is a normal answer, not a fault.
 */
export function pickThumbnail(value: unknown, minWidth = 200): string | null {
  if (!Array.isArray(value)) return null;
  const usable = value
    .filter(
      (entry): entry is EmbeddedThumbnail =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as EmbeddedThumbnail).relative_path === "string" &&
        (entry as EmbeddedThumbnail).relative_path !== "",
    )
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  if (usable.length === 0) return null;
  // Smallest that still clears the bar; otherwise the biggest there is.
  const adequate = usable.filter((t) => (t.width ?? 0) >= minWidth);
  const chosen = adequate.length > 0 ? adequate[adequate.length - 1] : usable[0];
  return chosen.relative_path ?? null;
}

/**
 * Absolute URL for a preview, given the gcode file it belongs to.
 *
 * `relative_path` is relative to the FILE's directory, not to the gcode root,
 * so a job in `calibration/` resolves under `calibration/`. Getting this
 * wrong is silent: it 404s and shows the placeholder, exactly like a file
 * with no preview at all.
 */
export function thumbnailUrlFor(
  gcodePath: string,
  relativePath: string,
): string | null {
  if (!relativePath) return null;
  const clean = relativePath.replace(/^\.?\//, "");
  const segments = gcodePath.split("/");
  segments.pop(); // drop the filename, keep its directory
  const parts = [...segments, ...clean.split("/")].filter(Boolean);
  return `/server/files/gcodes/${parts.map(encodeURIComponent).join("/")}`;
}

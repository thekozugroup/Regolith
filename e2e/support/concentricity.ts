/**
 * Concentric-corner law — shared sweep helper.
 *
 * THE LAW (S3 §3.2): a rounded child nested in a rounded container runs
 * concentric — inner radius = outer radius − gap — so both arcs share a
 * centre. The derived-radius token cascade (`--radius-inner`, inner =
 * outer − pad) is the implementation; this probe is the measurement, ported
 * verbatim from the 2026-08 full-app audit (1284 subject pairs) so the suite
 * enforces exactly what the audit measured.
 *
 * PROBE (runs in the page, self-contained): for every visible element with a
 * rounded corner, find the nearest visible rounded ancestor and measure each
 * corner's geometry. Exemptions measured in-page:
 *  - radius-0 children (sharp-inside-round is lawful)
 *  - native form controls (UA-drawn corners)
 *  - fully-round children (pills/circles obey centre alignment, not the law)
 *  - pill/circle ancestors
 *  - child overflowing its ancestor, elliptical corners, and corners whose
 *    nearest inset exceeds 48px on both axes (they float free of the corner)
 *
 * CLASSIFICATION (Node side, ported from the audit's report stage):
 *  - `.status-lamp` — the signature 1px lamp token: a pip cannot carry its
 *    container's arc; the lamp/dot rule (centre alignment) governs it
 *  - outside-arc — a corner past the end of the ancestor's arc on either
 *    axis is unconstrained by that arc
 *  - skew — insets differ (>1px): no concentric solution exists, but the
 *    radius must still meet the best the NEAR inset allows (±1px), the same
 *    inner = outer − gap law with gap = min inset
 *  - uniform — the pure case: inner = outer − gap, ±1px tolerance
 */

export interface CornerObservation {
  element: string;
  ancestor: string;
  corner: "tl" | "tr" | "br" | "bl";
  innerRadius: number;
  outerRadius: number;
  gapX: number;
  gapY: number;
  status: "measure" | "exempt" | "skip";
  reason?: string;
  path: string;
}

export interface ClassifiedCorner extends CornerObservation {
  klass: "pass" | "fail" | "skew" | "skew-ok" | "exempt" | "skip" | "outside-arc";
  gap?: number;
  expectedInner?: number;
  delta?: number;
}

/** Pass tolerance in px — borders and fractional layout own the last pixel. */
export const LAW_TOLERANCE = 1;

/** In-page measurement. Serialised into the browser — no imports at runtime. */
export const CONCENTRICITY_PROBE = () => {
  const NEST_MAX = 48; // corner-adjacency window (px)
  const CORNERS = ["tl", "tr", "br", "bl"] as const;

  function parseRadius(value: string, w: number, h: number): [number, number] {
    const parts = String(value || "0px").trim().split(/\s+/);
    const toPx = (s: string, base: number) =>
      s.endsWith("%") ? (parseFloat(s) / 100) * base : parseFloat(s) || 0;
    const x = toPx(parts[0], w);
    const y = parts.length > 1 ? toPx(parts[1], h) : toPx(parts[0], h);
    return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
  }

  function radiiOf(cs: CSSStyleDeclaration, r: DOMRect) {
    return {
      tl: parseRadius(cs.borderTopLeftRadius, r.width, r.height),
      tr: parseRadius(cs.borderTopRightRadius, r.width, r.height),
      br: parseRadius(cs.borderBottomRightRadius, r.width, r.height),
      bl: parseRadius(cs.borderBottomLeftRadius, r.width, r.height),
    } as Record<(typeof CORNERS)[number], [number, number]>;
  }

  function maxRadius(radii: Record<string, [number, number]>) {
    let m = 0;
    for (const k of Object.keys(radii)) m = Math.max(m, radii[k][0], radii[k][1]);
    return m;
  }

  function describe(el: Element): string {
    const cls = (el.getAttribute("class") || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join(".");
    const label = el.getAttribute("aria-label");
    const testid = el.getAttribute("data-testid");
    return (
      el.tagName.toLowerCase() +
      (el.id ? `#${el.id}` : "") +
      (cls ? `.${cls}` : "") +
      (testid ? `[data-testid=${testid}]` : "") +
      (label ? `[aria-label="${label.slice(0, 44)}"]` : "")
    );
  }

  function domPath(el: Element): string {
    const chain: string[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node && node !== document.body && depth < 8) {
      const parent: Element | null = node.parentElement;
      const idx = parent ? Array.prototype.indexOf.call(parent.children, node) : 0;
      chain.unshift(`${node.tagName.toLowerCase()}:${idx}`);
      node = parent;
      depth += 1;
    }
    return chain.join(">");
  }

  const NATIVE = new Set(["INPUT", "SELECT", "TEXTAREA", "PROGRESS", "METER", "OPTION"]);

  function visible(el: Element, r: DOMRect, cs: CSSStyleDeclaration): boolean {
    if (r.width < 1 || r.height < 1) return false;
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity || "1") === 0) return false;
    return true;
  }

  function round(n: number) {
    return Math.round(n * 100) / 100;
  }

  interface Row {
    element: string;
    ancestor: string;
    corner: "tl" | "tr" | "br" | "bl";
    innerRadius: number;
    outerRadius: number;
    gapX: number;
    gapY: number;
    status: "measure" | "exempt" | "skip";
    reason?: string;
    path: string;
  }

  const out: Row[] = [];
  const all = document.querySelectorAll("body *");

  for (const el of Array.prototype.slice.call(all) as Element[]) {
    // SVG geometry does not honour CSS border-radius — never subject.
    if (el.closest("svg")) continue;

    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, r, cs)) continue;

    const radii = radiiOf(cs, r);
    const inMax = maxRadius(radii);
    // Sharp inside round is legal — radius-0 children are exempt outright.
    if (inMax <= 0.01) continue;

    // Nearest rounded ancestor.
    let anc: Element | null = el.parentElement;
    let ancRadii: Record<string, [number, number]> | null = null;
    let ancRect: DOMRect | null = null;
    while (anc && anc !== document.documentElement) {
      if (!anc.closest("svg")) {
        const acs = getComputedStyle(anc);
        const ar = anc.getBoundingClientRect();
        if (visible(anc, ar, acs)) {
          const cand = radiiOf(acs, ar);
          if (maxRadius(cand) > 0.01) {
            ancRadii = cand;
            ancRect = ar;
            break;
          }
        }
      }
      anc = anc.parentElement;
    }
    if (!anc || !ancRadii || !ancRect) continue;

    const elName = describe(el);
    const ancName = describe(anc);
    const path = domPath(el);

    // Whole-element exemptions.
    const childRound = inMax >= Math.min(r.width, r.height) / 2 - 0.5;
    const ancRound =
      maxRadius(ancRadii) >= Math.min(ancRect.width, ancRect.height) / 2 - 0.5;
    const native = NATIVE.has(el.tagName);

    for (const corner of CORNERS) {
      const inner = radii[corner][0];
      const innerY = radii[corner][1];
      const outer = ancRadii[corner][0];

      let gapX: number;
      let gapY: number;
      if (corner === "tl") {
        gapX = r.left - ancRect.left;
        gapY = r.top - ancRect.top;
      } else if (corner === "tr") {
        gapX = ancRect.right - r.right;
        gapY = r.top - ancRect.top;
      } else if (corner === "br") {
        gapX = ancRect.right - r.right;
        gapY = ancRect.bottom - r.bottom;
      } else {
        gapX = r.left - ancRect.left;
        gapY = ancRect.bottom - r.bottom;
      }

      const base: Row = {
        element: elName,
        ancestor: ancName,
        corner,
        innerRadius: round(inner),
        outerRadius: round(outer),
        gapX: round(gapX),
        gapY: round(gapY),
        status: "measure",
        path,
      };

      if (native) {
        out.push({ ...base, status: "exempt", reason: "native control" });
        continue;
      }
      if (inner <= 0.01) {
        out.push({ ...base, status: "exempt", reason: "sharp corner (radius 0) inside round" });
        continue;
      }
      if (childRound) {
        // Fully-round elements obey centre alignment, not the radius law.
        out.push({ ...base, status: "exempt", reason: "fully round child" });
        continue;
      }
      if (ancRound) {
        out.push({ ...base, status: "exempt", reason: "ancestor is a pill/circle" });
        continue;
      }
      if (outer <= 0.01) {
        out.push({ ...base, status: "skip", reason: "ancestor corner is square" });
        continue;
      }
      if (gapX < -0.5 || gapY < -0.5) {
        out.push({ ...base, status: "skip", reason: "child overflows the ancestor at this corner" });
        continue;
      }
      if (Math.min(gapX, gapY) > NEST_MAX) {
        out.push({ ...base, status: "skip", reason: "corner floats free (nearest inset > 48px)" });
        continue;
      }
      if (Math.abs(inner - innerY) > 0.5) {
        out.push({ ...base, status: "skip", reason: "elliptical child corner" });
        continue;
      }

      out.push(base);
    }
  }

  return out;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Node-side classification — ported from the audit's report stage. */
export function classifyCorner(row: CornerObservation): ClassifiedCorner {
  if (row.status === "exempt") return { ...row, klass: "exempt" };
  // Signature lamp shape (`--radius-lamp`): the owner's own lamp/dot case —
  // a pip cannot carry its container's arc; centre alignment governs it.
  if (/(^|\.)status-lamp(\.|$|\[)/.test(row.element)) {
    return { ...row, klass: "exempt", reason: "signature lamp shape (--radius-lamp)" };
  }
  if (row.status === "skip") return { ...row, klass: "skip" };

  const R = row.outerRadius;
  if (row.gapX > R + LAW_TOLERANCE || row.gapY > R + LAW_TOLERANCE) {
    return {
      ...row,
      klass: "outside-arc",
      reason: "corner lies past the end of the ancestor's arc — unconstrained",
    };
  }
  if (Math.abs(row.gapX - row.gapY) > LAW_TOLERANCE) {
    // Skew: no concentric solution exists, but the near inset still binds.
    const gap = r2(Math.min(row.gapX, row.gapY));
    const expectedInner = r2(Math.max(0, R - gap));
    const delta = r2(row.innerRadius - expectedInner);
    return {
      ...row,
      gap,
      expectedInner,
      delta,
      klass: Math.abs(delta) <= LAW_TOLERANCE ? "skew-ok" : "skew",
      reason: `insets differ (${row.gapX} vs ${row.gapY}) — near-edge law`,
    };
  }
  const gap = r2((row.gapX + row.gapY) / 2);
  const expectedInner = r2(Math.max(0, R - gap));
  const delta = r2(row.innerRadius - expectedInner);
  return {
    ...row,
    gap,
    expectedInner,
    delta,
    klass: Math.abs(delta) <= LAW_TOLERANCE ? "pass" : "fail",
  };
}

/** Subject pairs — the denominator the pair-count floor watches. */
export function isSubjectPair(row: ClassifiedCorner): boolean {
  return (
    row.klass === "pass" ||
    row.klass === "fail" ||
    row.klass === "skew" ||
    row.klass === "skew-ok"
  );
}

/** Law violations: uniform-law misses and skew corners past the near-edge law. */
export function isViolation(row: ClassifiedCorner): boolean {
  return row.klass === "fail" || row.klass === "skew";
}

export function describeViolation(row: ClassifiedCorner, where: string): string {
  return (
    `${where} · ${row.corner} · ${row.element} in ${row.ancestor}: ` +
    `inner ${row.innerRadius} vs expected ${row.expectedInner} ` +
    `(outer ${row.outerRadius}, gap ${row.gap}, gapX ${row.gapX}, gapY ${row.gapY}, ` +
    `delta ${row.delta}, ${row.klass}) at ${row.path}`
  );
}

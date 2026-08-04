/**
 * The brand mark's persisted shape, and the only trusted way to read it.
 *
 * `BrandLogo` renders inside the sidebar and the app bar — chrome, on every
 * route. Before this file it did `JSON.parse(raw) as BrandConfig`, so a stored
 * `"null"` made `brand.type` a TypeError during render of a component that
 * sits ABOVE the route error boundary: a white screen on every page, fixable
 * only by clearing site data. The parse now goes through a real guard.
 */

import { readStoredJson, writeStoredJson } from "./safeStorage";

export type BrandConfig =
  | { type: "lucide"; name: string }
  | { type: "image"; src: string }
  | { type: "none" };

export const BRAND_STORAGE_KEY = "forge.brand.icon";
export const DEFAULT_BRAND: BrandConfig = { type: "lucide", name: "hammer" };

/**
 * Structural check, not a taste check: an unknown lucide `name` is fine (the
 * renderer falls back to its default glyph), but a missing `name`, a
 * non-string `src`, or a value that is not an object at all is not.
 */
export function isBrandConfig(value: unknown): value is BrandConfig {
  if (typeof value !== "object" || value === null) return false;
  const brand = value as { type?: unknown; name?: unknown; src?: unknown };
  if (brand.type === "none") return true;
  if (brand.type === "lucide") return typeof brand.name === "string";
  if (brand.type === "image") {
    return typeof brand.src === "string" && brand.src.length > 0;
  }
  return false;
}

export function loadBrand(): BrandConfig {
  return readStoredJson(BRAND_STORAGE_KEY, isBrandConfig, DEFAULT_BRAND);
}

/** Persisting is best-effort: a full quota must not break the picker. */
export function saveBrand(brand: BrandConfig): void {
  writeStoredJson(BRAND_STORAGE_KEY, brand);
}

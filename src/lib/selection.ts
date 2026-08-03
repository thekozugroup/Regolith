/**
 * Shallow equality for usePrinterSelector results: primitives by Object.is,
 * plain objects/arrays one level deep. Selectors therefore return either a
 * primitive or a FLAT bag of primitives — never nested objects, which would
 * defeat the comparison and re-render on every push.
 *
 * Standalone module (no React/moonraker imports) so the re-render gate is
 * directly unit-testable.
 */
export function selectionEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    Object.is(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

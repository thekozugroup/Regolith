export function getFocusLoopIndex(
  currentIndex: number,
  itemCount: number,
  backwards: boolean,
): number | null {
  if (itemCount <= 0) return null;
  if (backwards) {
    return currentIndex <= 0 ? itemCount - 1 : currentIndex - 1;
  }
  return currentIndex < 0 || currentIndex >= itemCount - 1
    ? 0
    : currentIndex + 1;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "details > summary:first-of-type",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function getModalFocusableElements(
  container: HTMLElement,
): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex >= 0,
  );
}

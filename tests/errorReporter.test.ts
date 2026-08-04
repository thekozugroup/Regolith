import { afterEach, describe, expect, test } from "bun:test";
import {
  clearReportedErrors,
  installErrorReporter,
  reportedErrors,
} from "../src/lib/errorReporter";

/**
 * The reporter is the backstop for the two failures React boundaries cannot
 * see. What has to hold: it records instead of throwing for ANY reason value,
 * it is bounded (it must not become the leak it exists to catch), and
 * installing it twice — which StrictMode does on every mount in dev — cannot
 * double-count.
 */

class FakeWindow {
  listeners = new Map<string, ((event: unknown) => void)[]>();
  addEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn),
    );
  }
  emit(type: string, event: unknown): void {
    [...(this.listeners.get(type) ?? [])].forEach((fn) => fn(event));
  }
  count(type: string): number {
    return (this.listeners.get(type) ?? []).length;
  }
}

const g = globalThis as Record<string, unknown>;
const originalWindow = g.window;

function withWindow(): { win: FakeWindow; uninstall: () => void } {
  const win = new FakeWindow();
  g.window = win;
  clearReportedErrors();
  const uninstall = installErrorReporter();
  return { win, uninstall };
}

afterEach(() => {
  g.window = originalWindow;
  clearReportedErrors();
});

describe("unhandled rejection reporter", () => {
  test("records a rejected promise nobody handled", () => {
    const { win, uninstall } = withWindow();
    win.emit("unhandledrejection", { reason: new Error("printer said no") });
    const [entry] = reportedErrors();
    expect(entry.kind).toBe("unhandledrejection");
    expect(entry.message).toBe("Error: printer said no");
    expect(entry.at).toBeGreaterThan(0);
    uninstall();
  });

  test("records an exception thrown outside render", () => {
    const { win, uninstall } = withWindow();
    win.emit("error", { error: new TypeError("x is not a function") });
    expect(reportedErrors()[0]).toMatchObject({
      kind: "error",
      message: "TypeError: x is not a function",
    });
    uninstall();
  });

  test("describes any reason value without throwing", () => {
    const { win, uninstall } = withWindow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const reasons = [
      undefined,
      null,
      "a bare string",
      42,
      { code: 500 },
      cyclic,
      Symbol("nope"),
      new DOMException("aborted", "AbortError"),
    ];
    for (const reason of reasons) {
      expect(() => win.emit("unhandledrejection", { reason })).not.toThrow();
    }
    expect(reportedErrors()).toHaveLength(reasons.length);
    for (const entry of reportedErrors()) {
      expect(typeof entry.message).toBe("string");
    }
    uninstall();
  });

  test("falls back to the message when no Error object is attached", () => {
    const { win, uninstall } = withWindow();
    win.emit("error", { error: undefined, message: "Script error." });
    expect(reportedErrors()[0].message).toBe("Script error.");
    uninstall();
  });

  test("the ring is bounded — the reporter cannot become the leak", () => {
    const { win, uninstall } = withWindow();
    for (let i = 0; i < 200; i++) {
      win.emit("unhandledrejection", { reason: `boom ${i}` });
    }
    const kept = reportedErrors();
    expect(kept).toHaveLength(20);
    // The most RECENT are the ones worth keeping.
    expect(kept[kept.length - 1].message).toBe("boom 199");
    expect(kept[0].message).toBe("boom 180");
    uninstall();
  });

  test("installing twice registers one listener — StrictMode double-mounts", () => {
    const { win, uninstall } = withWindow();
    const second = installErrorReporter();
    expect(win.count("unhandledrejection")).toBe(1);
    win.emit("unhandledrejection", { reason: "once" });
    expect(reportedErrors()).toHaveLength(1);
    second();
    uninstall();
  });

  test("uninstall detaches both listeners and the read handle", () => {
    const { win, uninstall } = withWindow();
    uninstall();
    win.emit("unhandledrejection", { reason: "after uninstall" });
    win.emit("error", { error: new Error("after uninstall") });
    expect(reportedErrors()).toEqual([]);
    expect(win.count("unhandledrejection")).toBe(0);
    expect(win.count("error")).toBe(0);
    expect((win as unknown as Record<string, unknown>).__regolithErrors).toBeUndefined();
  });

  test("a headless context installs nothing and returns a safe uninstall", () => {
    g.window = undefined;
    const uninstall = installErrorReporter();
    expect(() => uninstall()).not.toThrow();
    expect(reportedErrors()).toEqual([]);
  });
});

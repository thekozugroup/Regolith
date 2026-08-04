/**
 * The single door to `localStorage`.
 *
 * Two failure modes have to be survivable, because both happen on the
 * hardware this ships to:
 *
 *  1. **Storage throws.** Safari private mode, an iOS home-screen web app with
 *     storage disabled, a full quota, a locked-down kiosk profile — every one
 *     of these makes a bare `localStorage.getItem` throw. Several of our reads
 *     run in `useState` initializers and one (`applyStoredAccent`) runs in
 *     main.tsx BEFORE React mounts, where a throw is a permanently blank page
 *     with no error boundary to catch it.
 *
 *  2. **The stored value is garbage.** A half-finished write, a hand-edited
 *     key, an imported backup from a newer build, or another tab mid-upgrade.
 *     A preference read must degrade to its default, never to a crash — the
 *     printer keeps running while this UI is broken, and the owner needs the
 *     dashboard back without clearing site data from a phone.
 *
 * So: every accessor here is total. It answers with the fallback rather than
 * throwing, ever, for any input. Nothing in this file reports to the user —
 * a preference that could not be read is not an incident.
 */

/** Guarded handle. Touching the property itself can throw in some browsers. */
function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The raw string, or `null` for missing/unreadable. Never throws. */
export function readStored(key: string): string | null {
  try {
    const value = store()?.getItem(key);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Persist a string. Returns whether it stuck, for callers that care. */
export function writeStored(key: string, value: string): boolean {
  try {
    store()?.setItem(key, value);
    return true;
  } catch {
    // Quota exceeded or storage disabled. The in-memory state already
    // reflects the user's choice; it simply will not survive a reload.
    return false;
  }
}

export function removeStored(key: string): boolean {
  try {
    store()?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Keys currently present, filtered by prefix. Empty when storage is out. */
export function storedKeys(prefix = ""): string[] {
  try {
    const s = store();
    if (!s) return [];
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key != null && key.startsWith(prefix)) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

/**
 * Parse a JSON-valued key through a type guard.
 *
 * The guard is the point: `JSON.parse` succeeding proves the bytes were JSON,
 * not that they were the shape this build expects. `"null"`, `"42"` and
 * `'{"type":"lucide"}'` all parse cleanly and all three used to reach render
 * as a `BrandConfig`.
 */
export function readStoredJson<T>(
  key: string,
  isValid: (value: unknown) => boolean,
  fallback: T,
): T {
  const raw = readStored(key);
  if (raw == null || raw === "") return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  return isValid(parsed) ? (parsed as T) : fallback;
}

/** Serialize and persist. Cyclic or unserializable values are a no-op. */
export function writeStoredJson(key: string, value: unknown): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }
  if (typeof serialized !== "string") return false; // undefined / function
  return writeStored(key, serialized);
}

/**
 * A persisted boolean written as "1"/"0".
 *
 * Anything else — absent, "", "true", "yes", a JSON blob, a stray newline —
 * resolves to `fallback`. Callers therefore never see a third state.
 */
export function flagFromStorage(
  raw: string | null,
  fallback = false,
): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

/** Read a "1"/"0" flag straight from storage. */
export function readStoredFlag(key: string, fallback = false): boolean {
  return flagFromStorage(readStored(key), fallback);
}

export function writeStoredFlag(key: string, value: boolean): boolean {
  return writeStored(key, value ? "1" : "0");
}

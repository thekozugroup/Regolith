import type { GcodeMetadata } from "../components/PrintDialog";

export interface FileRevision {
  modified: number;
  size: number;
}

export type MetadataPriority = "selected" | "visible" | "background";
export interface MetadataRequest {
  revision?: FileRevision;
  priority?: MetadataPriority;
  /** Cancels this consumer only. Shared active HTTP reads are not aborted. */
  signal?: AbortSignal;
}

const PRIORITY = { selected: 0, visible: 1, background: 2 };
const CACHE_LIMIT = 128;
const CACHE_TTL_MS = 5 * 60_000;

interface Pending {
  filename: string;
  key: string;
  epoch: number;
  priority: number;
  started: boolean;
  consumers: Map<symbol, number>;
  promise: Promise<GcodeMetadata | null>;
  resolve: (value: GcodeMetadata | null) => void;
}

/** A shared, bounded read queue: details and previews use the SAME response.
 * Failures stay unknown and are never cached. No printer commands live here. */
export class FileMetadataQueue {
  private readonly cache = new Map<string, { at: number; value: GcodeMetadata }>();
  private readonly revisions = new Map<string, string>();
  private readonly pending = new Map<string, Pending>();
  private readonly waiting: Pending[] = [];
  private active = 0;
  private epoch = 0;
  private readonly read: (filename: string) => Promise<GcodeMetadata | null>;
  private readonly concurrency: number;
  private readonly cacheLimit: number;
  private readonly now: () => number;

  constructor(
    read: (filename: string) => Promise<GcodeMetadata | null>,
    concurrency = 2,
    cacheLimit = CACHE_LIMIT,
    now = Date.now,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("Metadata concurrency must be a positive integer");
    }
    if (!Number.isInteger(cacheLimit) || cacheLimit < 1) {
      throw new Error("Metadata cache limit must be a positive integer");
    }
    this.read = read;
    this.concurrency = concurrency;
    this.cacheLimit = cacheLimit;
    this.now = now;
  }

  request(filename: string, options: MetadataRequest = {}): Promise<GcodeMetadata | null> {
    if (options.signal?.aborted) return Promise.resolve(null);
    const revision = options.revision
      ? JSON.stringify([options.revision.modified, options.revision.size])
      : this.revisions.get(filename) ?? "unknown";
    this.revisions.delete(filename);
    this.revisions.set(filename, revision);
    while (this.revisions.size > this.cacheLimit) {
      this.revisions.delete(this.revisions.keys().next().value!);
    }
    const key = JSON.stringify([filename, revision, this.epoch]);
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < CACHE_TTL_MS) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached.value);
    }
    this.cache.delete(key);
    const priority = PRIORITY[options.priority ?? "background"];
    const shared = this.pending.get(key);
    if (shared) {
      return this.subscribe(shared, priority, options.signal);
    }
    let resolve!: Pending["resolve"];
    const promise = new Promise<GcodeMetadata | null>((done) => { resolve = done; });
    const entry: Pending = {
      filename, key, epoch: this.epoch, priority, started: false,
      consumers: new Map(), promise, resolve,
    };
    this.pending.set(key, entry);
    this.waiting.push(entry);
    const consumer = this.subscribe(entry, priority, options.signal);
    this.drain();
    return consumer;
  }

  /** Explicit refresh invalidates successful reads too. Old active responses
   * cannot repopulate the new cache; they still occupy their concurrency slot. */
  invalidate(): void {
    this.epoch += 1;
    this.cache.clear();
    this.revisions.clear();
    for (const entry of this.waiting.splice(0)) {
      this.pending.delete(entry.key);
      entry.resolve(null);
    }
  }

  private drain(): void {
    while (this.active < this.concurrency && this.waiting.length) {
      this.waiting.sort((a, b) => a.priority - b.priority);
      const entry = this.waiting.shift()!;
      entry.started = true;
      this.active += 1;
      void this.run(entry);
    }
  }

  private subscribe(entry: Pending, priority: number, signal?: AbortSignal): Promise<GcodeMetadata | null> {
    const token = Symbol();
    entry.consumers.set(token, priority);
    entry.priority = Math.min(...entry.consumers.values());
    // Preserve the original promise-sharing API for permanent consumers,
    // including current-job callers without a route lifetime signal.
    if (!signal) return entry.promise;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: GcodeMetadata | null) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        entry.consumers.delete(token);
        resolve(value);
      };
      const abort = () => {
        finish(null);
        if (entry.started) return;
        if (entry.consumers.size) {
          entry.priority = Math.min(...entry.consumers.values());
          return;
        }
        const index = this.waiting.indexOf(entry);
        if (index !== -1) this.waiting.splice(index, 1);
        this.pending.delete(entry.key);
        entry.resolve(null);
      };
      signal.addEventListener("abort", abort, { once: true });
      void entry.promise.then(finish);
    });
  }

  private async run(entry: Pending): Promise<void> {
    let value: GcodeMetadata | null = null;
    try {
      value = await this.read(entry.filename);
      const currentKey = JSON.stringify([
        entry.filename, this.revisions.get(entry.filename), this.epoch,
      ]);
      if (value !== null && entry.epoch === this.epoch && entry.key === currentKey) {
        this.cache.set(entry.key, { at: this.now(), value });
        while (this.cache.size > this.cacheLimit) {
          this.cache.delete(this.cache.keys().next().value!);
        }
      }
    } catch {
      // A failed optional read must not turn into a permanent "no preview".
    } finally {
      this.pending.delete(entry.key);
      this.active -= 1;
      entry.resolve(value);
      this.drain();
    }
  }
}

const queue = new FileMetadataQueue(async (filename) => {
  const response = await fetch(
    `/server/files/metadata?filename=${encodeURIComponent(filename)}`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) return null;
  const body: unknown = await response.json();
  const result = (body as { result?: unknown } | null)?.result;
  return result !== null && typeof result === "object" && !Array.isArray(result)
    ? result as GcodeMetadata
    : null;
});

export function requestFileMetadata(filename: string, options?: MetadataRequest) {
  return queue.request(filename, options);
}

export function invalidateFileMetadata(): void {
  queue.invalidate();
}

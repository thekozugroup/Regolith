import { afterEach, describe, expect, test } from "bun:test";
import { FileMetadataQueue, invalidateFileMetadata, requestFileMetadata } from "../src/lib/fileMetadata";
import { fetchFileMetadata, resetJobHistoryCache } from "../src/lib/useJobHistory";
import type { GcodeMetadata } from "../src/components/PrintDialog";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetJobHistoryCache();
});

function controlled(concurrency = 2) {
  const reads: Array<{
    filename: string;
    resolve: (metadata: GcodeMetadata | null) => void;
    reject: (error: Error) => void;
  }> = [];
  const queue = new FileMetadataQueue((filename) => new Promise((resolve, reject) => {
    reads.push({ filename, resolve, reject });
  }), concurrency);
  return { queue, reads };
}

describe("shared file metadata queue", () => {
  test("24 requested files never exceed two active reads", async () => {
    const { queue, reads } = controlled();
    const all = Array.from({ length: 24 }, (_, i) => queue.request(`file-${i}`));
    expect(reads).toHaveLength(2);
    for (let i = 0; i < all.length; i++) {
      expect(reads.length - i).toBeLessThanOrEqual(2);
      reads[i].resolve({ layer_count: i });
      await all[i];
    }
    expect(reads).toHaveLength(24);
    expect((await Promise.all(all))[23]?.layer_count).toBe(23);
  });

  test("thumbnail and details share the identical full response in flight", async () => {
    const { queue, reads } = controlled();
    const thumbnail = queue.request("nested/a.gcode", { priority: "visible" });
    const details = queue.request("nested/a.gcode", { priority: "selected" });
    expect(details).toBe(thumbnail);
    const metadata = { first_layer_bed_temp: 60, filament_type: "PLA", layer_count: 120 };
    reads[0].resolve(metadata);
    expect(await thumbnail).toBe(metadata);
    expect(await details).toBe(metadata);
    expect(await queue.request("nested/a.gcode")).toBe(metadata);
    expect(reads).toHaveLength(1);
  });

  test("selected then visible work outrank waiting background reads; promotion deduplicates", async () => {
    const { queue, reads } = controlled();
    const a = queue.request("active-a");
    const b = queue.request("active-b");
    const background = queue.request("background");
    const selected = queue.request("selected");
    const visible = queue.request("visible", { priority: "visible" });
    expect(queue.request("selected", { priority: "selected" })).toBe(selected);
    reads[0].resolve({});
    await a;
    expect(reads[2].filename).toBe("selected");
    reads[1].resolve({});
    await b;
    expect(reads[3].filename).toBe("visible");
    reads[2].resolve({});
    await selected;
    expect(reads[4].filename).toBe("background");
    reads[3].resolve({});
    reads[4].resolve({});
    await Promise.all([visible, background]);
  });

  test("failure is not cached and a later selection recovers without a retry loop", async () => {
    const { queue, reads } = controlled();
    const failure = queue.request("a");
    reads[0].reject(new Error("offline"));
    expect(await failure).toBeNull();
    expect(reads).toHaveLength(1);
    const retry = queue.request("a", { priority: "selected" });
    reads[1].resolve({ estimated_time: 123 });
    expect((await retry)?.estimated_time).toBe(123);
    expect(reads).toHaveLength(2);
  });

  test("same-name modified OR size changes invalidate successful cached metadata", async () => {
    let calls = 0;
    const queue = new FileMetadataQueue(async () => ({ layer_count: ++calls }));
    const request = (modified: number, size: number) => queue.request("same.gcode", { revision: { modified, size } });
    expect((await request(1, 10))?.layer_count).toBe(1);
    expect((await request(1, 10))?.layer_count).toBe(1);
    expect((await request(2, 10))?.layer_count).toBe(2);
    expect((await request(2, 11))?.layer_count).toBe(3);
    // Dashboard callers with no file listing use the newest known identity.
    expect((await queue.request("same.gcode"))?.layer_count).toBe(3);
  });

  test("an old same-name response cannot replace the newest cached revision", async () => {
    const { queue, reads } = controlled();
    const old = queue.request("same", { revision: { modified: 1, size: 10 } });
    const latest = queue.request("same", { revision: { modified: 2, size: 10 } });
    reads[1].resolve({ layer_count: 200 });
    await latest;
    reads[0].resolve({ layer_count: 100 });
    await old;
    expect((await queue.request("same"))?.layer_count).toBe(200);
    expect(reads).toHaveLength(2);
  });

  test("refresh cancels waiting reads and old active reads cannot refill cache or break the bound", async () => {
    const { queue, reads } = controlled(1);
    const old = queue.request("same");
    const cancelled = queue.request("waiting");
    queue.invalidate();
    expect(await cancelled).toBeNull();
    const fresh = queue.request("same");
    expect(reads).toHaveLength(1);
    reads[0].resolve({ layer_count: 1 });
    await old;
    expect(reads).toHaveLength(2);
    reads[1].resolve({ layer_count: 2 });
    await fresh;
    expect((await queue.request("same"))?.layer_count).toBe(2);
    expect(reads).toHaveLength(2);
  });

  test("cache is bounded, LRU, and expires even without a revision", async () => {
    let calls = 0;
    let time = 0;
    const queue = new FileMetadataQueue(async () => ({ layer_count: ++calls }), 2, 2, () => time);
    await queue.request("a");
    await queue.request("b");
    expect((await queue.request("a"))?.layer_count).toBe(1);
    await queue.request("c");
    expect((await queue.request("b"))?.layer_count).toBe(4);
    time = 5 * 60_000;
    expect((await queue.request("b"))?.layer_count).toBe(5);
  });

  test("unmount cancels unsent reads without draining them after the active read completes", async () => {
    const { queue, reads } = controlled(1);
    const active = queue.request("sent");
    const first = new AbortController();
    const second = new AbortController();
    const a = queue.request("unsent-a", { signal: first.signal });
    const b = queue.request("unsent-b", { signal: second.signal });
    first.abort();
    second.abort();
    expect(await a).toBeNull();
    expect(await b).toBeNull();
    reads[0].resolve({});
    await active;
    expect(reads.map((read) => read.filename)).toEqual(["sent"]);
  });

  test("one cancelled subscriber never cancels another subscriber's queued shared read", async () => {
    const { queue, reads } = controlled(1);
    const active = queue.request("sent");
    const thumbnail = new AbortController();
    const selected = new AbortController();
    const preview = queue.request("shared", { priority: "visible", signal: thumbnail.signal });
    const details = queue.request("shared", { priority: "selected", signal: selected.signal });
    thumbnail.abort();
    expect(await preview).toBeNull();
    reads[0].resolve({});
    await active;
    expect(reads[1].filename).toBe("shared");
    reads[1].resolve({ layer_count: 42 });
    expect((await details)?.layer_count).toBe(42);
    expect(reads).toHaveLength(2);
  });

  test("cancelling the selected subscriber restores remaining waiting work's visible priority", async () => {
    const { queue, reads } = controlled(1);
    const active = queue.request("sent");
    const earlierVisible = queue.request("earlier-visible", { priority: "visible" });
    const lateVisible = queue.request("late-visible", { priority: "visible" });
    const selected = new AbortController();
    const details = queue.request("late-visible", { priority: "selected", signal: selected.signal });
    selected.abort();
    expect(await details).toBeNull();
    reads[0].resolve({});
    await active;
    expect(reads[1].filename).toBe("earlier-visible");
    reads[1].resolve({});
    await earlierVisible;
    reads[2].resolve({});
    await lateVisible;
  });

  test("already-sent shared reads retain their concurrency slot after one consumer cancels", async () => {
    const { queue, reads } = controlled(1);
    const controller = new AbortController();
    const cancelled = queue.request("shared", { signal: controller.signal });
    const remaining = queue.request("shared");
    const waiting = queue.request("next");
    controller.abort();
    expect(await cancelled).toBeNull();
    expect(reads).toHaveLength(1);
    reads[0].resolve({ layer_count: 123 });
    expect((await remaining)?.layer_count).toBe(123);
    expect(reads).toHaveLength(2);
    reads[1].resolve({});
    await waiting;
  });

  test("an already-aborted signal does not submit work and cancelled queued work remains retryable", async () => {
    const { queue, reads } = controlled(1);
    const controller = new AbortController();
    controller.abort();
    expect(await queue.request("aborted", { signal: controller.signal })).toBeNull();
    expect(reads).toHaveLength(0);
    const active = queue.request("sent");
    const queued = new AbortController();
    const cancelled = queue.request("retry", { signal: queued.signal });
    queued.abort();
    expect(await cancelled).toBeNull();
    const retry = queue.request("retry");
    reads[0].resolve({});
    await active;
    reads[1].resolve({ layer_count: 7 });
    expect((await retry)?.layer_count).toBe(7);
  });
});

describe("metadata transport and job-history projection", () => {
  test("small preview, details, and job estimate use one complete encoded metadata read", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ result: {
        estimated_time: 3600, first_layer_extr_temp: 220, layer_count: 123,
        thumbnails: [
          { width: 32, relative_path: ".thumbs/a-32.png" },
          { width: 300, relative_path: ".thumbs/a-300.png" },
        ],
      } }));
    }) as typeof fetch;
    invalidateFileMetadata();
    const revision = { modified: 10, size: 100 };
    const [list, full, job] = await Promise.all([
      fetchFileMetadata("nested/a & b.gcode", { revision, priority: "visible" }),
      requestFileMetadata("nested/a & b.gcode", { revision, priority: "selected" }),
      fetchFileMetadata("nested/a & b.gcode", { priority: "selected" }),
    ]);
    expect(urls).toEqual(["/server/files/metadata?filename=nested%2Fa%20%26%20b.gcode"]);
    expect(full?.first_layer_extr_temp).toBe(220);
    expect(job.slicerEstimate).toBe(3600);
    expect(list).toEqual({ available: true, slicerEstimate: 3600,
      thumbnailUrl: "/server/files/gcodes/nested/.thumbs/a-300.png",
      thumbnailSmallUrl: "/server/files/gcodes/nested/.thumbs/a-32.png" });
    expect((await fetchFileMetadata("nested/a & b.gcode")).slicerEstimate).toBe(3600);
    expect(urls).toHaveLength(1);
  });

  test("unavailable and malformed reads remain unknown and are recoverable; valid thumbless files are known", async () => {
    const bodies = [new Response("offline", { status: 503 }), new Response("bad json"),
      new Response(JSON.stringify({ result: [] })),
      new Response(JSON.stringify({ result: { estimated_time: 0, layer_count: 100 } }))];
    globalThis.fetch = (async () => bodies.shift()!) as typeof fetch;
    for (let i = 0; i < 3; i++) {
      expect(await fetchFileMetadata("recoverable")).toEqual({ available: false,
        slicerEstimate: null, thumbnailUrl: null, thumbnailSmallUrl: null });
    }
    expect(await fetchFileMetadata("recoverable")).toEqual({ available: true,
      slicerEstimate: null, thumbnailUrl: null, thumbnailSmallUrl: null });
    expect(bodies).toHaveLength(0);
  });
});

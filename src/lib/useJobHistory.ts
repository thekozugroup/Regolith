/**
 * Print-history calibration inputs for the remaining-time estimate (WP-ETA).
 *
 * Two read-only Moonraker REST reads, both optional, both failing to `null`:
 *
 *   GET /server/history/list  → recent completed jobs, for the median factor
 *   GET /server/files/metadata → this file's slicer estimate
 *
 * Moonraker's `[history]` component can be disabled, a slicer may emit no
 * `estimated_time` at all, and a printer may simply have no prints yet. Every
 * one of those is a normal state, not an error: nothing is retried in a loop,
 * nothing is announced, and `computeJobTiming` reduces to its uncalibrated
 * behaviour. There is no toast and no banner anywhere in this file.
 *
 * Nothing here is in the print-critical path — these are display values read
 * after a job is already running.
 */

import { useEffect, useState } from "react";
import { calibrationFactor, type JobCalibration } from "./jobProgress";
import { pickThumbnail, thumbnailUrlFor } from "./thumbnails";

/** Enough history to see a trend without dragging in a different filament era. */
const HISTORY_LIMIT = 20;
/** Recomputed at most this often; the factor moves over weeks, not seconds. */
const CALIBRATION_TTL_MS = 5 * 60 * 1000;
/** History/metadata are conveniences — never let one hang a render path. */
const FETCH_TIMEOUT_MS = 8_000;

export interface FileMetadata {
  /** The slicer's own estimate in seconds, or null. */
  slicerEstimate: number | null;
  /** URL of an embedded preview, or null when the file has none. */
  thumbnailUrl: string | null;
  /** Smallest embedded preview that still fills a 32px list tile, or null.
   *  Falls back to the same answer as `thumbnailUrl` when the slicer only
   *  wrote one size. */
  thumbnailSmallUrl: string | null;
}

/** A file's metadata never changes, so cache it forever by name. */
const metadataCache = new Map<string, FileMetadata>();

let calibrationCache: { at: number; value: JobCalibration | null } | null = null;
let calibrationInFlight: Promise<JobCalibration | null> | null = null;

async function getJson(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(path, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Endpoint absent, component disabled, offline, malformed body — all the
    // same answer: we do not have this, carry on without it.
    return null;
  }
}

/** Median calibration factor over recent completed jobs, or null. */
export async function fetchCalibration(): Promise<JobCalibration | null> {
  const now = Date.now();
  if (calibrationCache && now - calibrationCache.at < CALIBRATION_TTL_MS) {
    return calibrationCache.value;
  }
  if (calibrationInFlight) return calibrationInFlight;

  calibrationInFlight = (async () => {
    const body = await getJson(
      `/server/history/list?limit=${HISTORY_LIMIT}&order=desc`,
    );
    const jobs = (body as { result?: { jobs?: unknown } } | null)?.result?.jobs;
    const value = Array.isArray(jobs) ? calibrationFactor(jobs) : null;
    calibrationCache = { at: Date.now(), value };
    return value;
  })();

  try {
    return await calibrationInFlight;
  } finally {
    calibrationInFlight = null;
  }
}

/**
 * One read of `/server/files/metadata`, answering both questions the mission
 * panel has about a file: how long the slicer thought it would take, and
 * whether it carries a preview at all.
 *
 * Asking about the preview HERE is what removes the thumbnail 404: the panel
 * used to guess the Fluidd path and probe it with an Image(), so every
 * thumbless job logged a failed request on every dashboard load.
 */
export async function fetchFileMetadata(
  filename: string,
): Promise<FileMetadata> {
  const cached = metadataCache.get(filename);
  if (cached !== undefined) return cached;

  const body = await getJson(
    `/server/files/metadata?filename=${encodeURIComponent(filename)}`,
  );
  const result = (body as { result?: Record<string, unknown> } | null)?.result;
  const raw = result?.estimated_time;
  const relative = pickThumbnail(result?.thumbnails);
  const relativeSmall = pickThumbnail(result?.thumbnails, 32);
  const value: FileMetadata = {
    slicerEstimate:
      typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null,
    thumbnailUrl: relative ? thumbnailUrlFor(filename, relative) : null,
    thumbnailSmallUrl: relativeSmall
      ? thumbnailUrlFor(filename, relativeSmall)
      : null,
  };
  metadataCache.set(filename, value);
  return value;
}

export interface JobHistoryInputs {
  slicerEstimate: number | null;
  calibration: JobCalibration | null;
  /** Embedded preview URL for the current job, or null when it has none. */
  thumbnailUrl: string | null;
}

const EMPTY: JobHistoryInputs = {
  slicerEstimate: null,
  calibration: null,
  thumbnailUrl: null,
};

/**
 * Calibration inputs for the file currently printing. Pass `undefined` when
 * no job is running — nothing is fetched and the caller gets the empty pair,
 * which makes `computeJobTiming` behave exactly as it does with no options.
 */
export function useJobHistory(filename: string | undefined): JobHistoryInputs {
  const [inputs, setInputs] = useState<JobHistoryInputs>(EMPTY);

  useEffect(() => {
    if (!filename) {
      setInputs(EMPTY);
      return;
    }
    let live = true;
    setInputs(EMPTY);
    // Two INDEPENDENT reads, applied as each lands. They were awaited
    // together, which made the slower one gate the faster: a Moonraker whose
    // `[history]` component is disabled or slow held the file's own metadata
    // — including its embedded preview — hostage for the full 8s fetch
    // timeout. Nothing here depends on the other having arrived.
    void (async () => {
      const metadata = await fetchFileMetadata(filename);
      if (live) setInputs((prev) => ({ ...prev, ...metadata }));
    })();
    void (async () => {
      const calibration = await fetchCalibration();
      if (live) setInputs((prev) => ({ ...prev, calibration }));
    })();
    return () => {
      live = false;
    };
  }, [filename]);

  return inputs;
}

/** Test seam: drop every cached read so a fresh probe is taken. */
export function resetJobHistoryCache(): void {
  metadataCache.clear();
  calibrationCache = null;
  calibrationInFlight = null;
}

import { useEffect, useRef, useState } from "react";
import { moonraker } from "./moonraker";

const HOST_SAMPLE_FRESH_MS = 15_000;
const HOST_FALLBACK_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;
const STABLE_RETRY_BASE_MS = 5_000;
const STABLE_RETRY_MAX_MS = 60_000;

export interface SystemInfo {
  cpu?: string;
  memUsed?: number;
  memTotal?: number;
  uptime?: number;
  klipper?: string;
  moonraker?: string;
}

export interface SystemInfoState {
  info: SystemInfo;
  stableError: string | null;
  liveError: string | null;
  hostUpdatedAt: number | null;
  memoryUpdatedAt: number | null;
  uptimeUpdatedAt: number | null;
  connected: boolean;
  now: number;
  error: string | null;
}

export function hostSampleIsFresh(at: number | null, now: number): boolean {
  return at != null && now - at >= 0 && now - at < HOST_SAMPLE_FRESH_MS;
}

export function hostInfoFromProcStats(host: unknown): Pick<SystemInfo, "memUsed" | "memTotal" | "uptime"> {
  if (host == null || typeof host !== "object") return {};
  const data = host as {
    system_memory?: { total?: unknown; available?: unknown };
    system_uptime?: unknown;
  };
  const rawTotal = data.system_memory?.total;
  const rawAvailable = data.system_memory?.available;
  const pairValid = typeof rawTotal === "number" && Number.isFinite(rawTotal) && rawTotal > 0 &&
    typeof rawAvailable === "number" && Number.isFinite(rawAvailable) && rawAvailable >= 0 && rawAvailable <= rawTotal;
  const total = pairValid ? rawTotal as number : undefined;
  const available = pairValid ? rawAvailable as number : undefined;
  const rawUptime = data.system_uptime;
  return {
    memTotal: total,
    memUsed: total != null && available != null ? total - available : undefined,
    uptime: typeof rawUptime === "number" && Number.isFinite(rawUptime) && rawUptime >= 0 ? rawUptime : undefined,
  };
}

export function stableSystemInfo(root: unknown, printerInfo: unknown, serverInfo: unknown): SystemInfo {
  const rootRecord = objectRecord(root);
  const result = objectRecord(rootRecord?.result);
  const system = objectRecord(result?.system_info);
  const printer = objectRecord(objectRecord(printerInfo)?.result);
  const server = objectRecord(objectRecord(serverInfo)?.result);
  if (!result || (!system && !objectRecord(result.cpu_info))) {
    throw new Error("Host system information response was malformed.");
  }
  const cpu = cpuDescription(system, result);
  const klipper = printer?.software_version;
  const moonrakerVersion = server?.moonraker_version;
  if (typeof klipper !== "string" || !klipper || typeof moonrakerVersion !== "string" || !moonrakerVersion) {
    throw new Error("Host details response is missing a valid software version.");
  }
  return { cpu, klipper, moonraker: moonrakerVersion };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function hostSampleInfo(sample: {
  memTotalKb: number | null;
  memAvailKb: number | null;
  uptimeS: number | null;
}): Pick<SystemInfo, "memUsed" | "memTotal" | "uptime"> {
  return hostInfoFromProcStats({
    system_memory: { total: sample.memTotalKb, available: sample.memAvailKb },
    system_uptime: sample.uptimeS,
  });
}

export function hasHostInfo(info: Pick<SystemInfo, "memUsed" | "memTotal" | "uptime">): boolean {
  return info.memTotal !== undefined || info.uptime !== undefined;
}

export function hostChannelsNeedFallback(
  memoryUpdatedAt: number | null,
  uptimeUpdatedAt: number | null,
  now: number,
  requestStartedAt = now,
): { memory: boolean; uptime: boolean } {
  return {
    memory: !hostSampleIsFresh(memoryUpdatedAt, now) && (memoryUpdatedAt == null || memoryUpdatedAt < requestStartedAt),
    uptime: !hostSampleIsFresh(uptimeUpdatedAt, now) && (uptimeUpdatedAt == null || uptimeUpdatedAt < requestStartedAt),
  };
}

export function hostChannelsFresh(memoryUpdatedAt: number | null, uptimeUpdatedAt: number | null, now: number): boolean {
  return hostSampleIsFresh(memoryUpdatedAt, now) && hostSampleIsFresh(uptimeUpdatedAt, now);
}

export function cpuDescription(systemInfo: unknown, root: unknown): string | undefined {
  const nested = systemInfo != null && typeof systemInfo === "object"
    ? (systemInfo as { cpu_info?: Record<string, unknown> }).cpu_info
    : undefined;
  const top = root != null && typeof root === "object"
    ? (root as { cpu_info?: Record<string, unknown> }).cpu_info
    : undefined;
  const info = top ?? nested;
  for (const cpu of [info?.cpu_desc, info?.processor, info?.model]) {
    if (typeof cpu === "string" && cpu.trim()) return cpu.trim();
  }
  return undefined;
}

/** Stable host identity/version data plus Moonraker's already-pushed host stats. */
export function useSystemInfo(
  enabled: boolean,
  connected: boolean,
  restartKey: string,
): SystemInfoState {
  const [state, setState] = useState<SystemInfoState>({ info: {}, stableError: null, liveError: null, hostUpdatedAt: null, memoryUpdatedAt: null, uptimeUpdatedAt: null, connected: false, now: Date.now(), error: null });
  const lastRestartKey = useRef(restartKey);
  const klippyWasUnavailable = useRef(false);
  const [restartGeneration, setRestartGeneration] = useState(0);

  useEffect(() => {
    setState((previous) => ({ ...previous, connected, now: Date.now() }));
  }, [connected]);

  useEffect(() => {
    if (!enabled) return;
    const ageId = window.setInterval(() => setState((previous) => ({ ...previous, now: Date.now() })), 1_000);
    return () => window.clearInterval(ageId);
  }, [enabled]);

  useEffect(() => {
    const wasReady = lastRestartKey.current === "ready";
    const isReady = restartKey === "ready";
    lastRestartKey.current = restartKey;
    if (!isReady) {
      if (wasReady) klippyWasUnavailable.current = true;
    } else if (klippyWasUnavailable.current) {
      klippyWasUnavailable.current = false;
      setRestartGeneration((generation) => generation + 1);
    }
  }, [restartKey]);

  useEffect(() => {
    if (!enabled || !connected) return;
    let disposed = false;
    let stableController: AbortController | null = null;
    let fallbackController: AbortController | null = null;
    let fallbackInFlight = false;
    let stableSucceeded = false;
    let stableRetryId: number | null = null;
    let stableRetryAttempt = 0;
    let memoryUpdatedAt = 0;
    let uptimeUpdatedAt = 0;

    const fetchJson = async (url: string, signal: AbortSignal) => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
      return response.json();
    };

    const loadStable = async () => {
      if (disposed || stableSucceeded) return;
      const controller = new AbortController();
      stableController = controller;
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const responses = await Promise.all([
          fetchJson("/machine/system_info", controller.signal),
          fetchJson("/printer/info", controller.signal),
          fetchJson("/server/info", controller.signal),
        ]);
        if (disposed) return;
        const stable = stableSystemInfo(...responses);
        stableSucceeded = true;
        stableRetryAttempt = 0;
        if (stableRetryId != null) window.clearTimeout(stableRetryId);
        setState((previous) => ({
          ...previous,
          info: {
            ...previous.info,
            ...stable,
          },
          stableError: null,
        }));
      } catch (error) {
        if (disposed) return;
        controller.abort();
        stableRetryAttempt += 1;
        const delay = Math.min(STABLE_RETRY_BASE_MS * 2 ** (stableRetryAttempt - 1), STABLE_RETRY_MAX_MS);
        setState((previous) => ({
          ...previous,
          stableError: error instanceof Error && error.name !== "AbortError"
            ? error.message
            : "Host details are temporarily unavailable (request timed out).",
        }));
        stableRetryId = window.setTimeout(() => void loadStable(), delay);
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const applyHost = (host: unknown) => {
      const hostInfo = hostInfoFromProcStats(host);
      const updatedAt = Date.now();
      if (hostInfo.memTotal != null) memoryUpdatedAt = updatedAt;
      if (hostInfo.uptime != null) uptimeUpdatedAt = updatedAt;
      setState((previous) => ({
        ...previous,
        info: {
          ...previous.info,
          ...(hostInfo.memTotal != null ? {
            memTotal: hostInfo.memTotal,
            memUsed: hostInfo.memUsed,
          } : {}),
          ...(hostInfo.uptime != null ? { uptime: hostInfo.uptime } : {}),
        },
        liveError: hostChannelsFresh(memoryUpdatedAt, uptimeUpdatedAt, updatedAt) ? null : previous.liveError,
        hostUpdatedAt: updatedAt,
        memoryUpdatedAt: hostInfo.memTotal != null ? updatedAt : previous.memoryUpdatedAt,
        uptimeUpdatedAt: hostInfo.uptime != null ? updatedAt : previous.uptimeUpdatedAt,
      }));
    };

    const refreshFallback = async () => {
      if (disposed || fallbackInFlight) return;
      const now = Date.now();
      const memoryFresh = memoryUpdatedAt > 0 && now - memoryUpdatedAt < HOST_SAMPLE_FRESH_MS;
      const uptimeFresh = uptimeUpdatedAt > 0 && now - uptimeUpdatedAt < HOST_SAMPLE_FRESH_MS;
      if (memoryFresh && uptimeFresh) return;
      fallbackInFlight = true;
      fallbackController?.abort();
      const controller = new AbortController();
      fallbackController = controller;
      const requestStartedAt = Date.now();
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const data = await fetchJson("/machine/proc_stats", controller.signal);
        if (disposed) return;
        const hostInfo = hostInfoFromProcStats(data.result);
        const channels = hostChannelsNeedFallback(memoryUpdatedAt || null, uptimeUpdatedAt || null, requestStartedAt);
        if (!hasHostInfo(hostInfo)) {
          setState((previous) => ({ ...previous, liveError: "Host telemetry response contains no valid memory or uptime values." }));
        } else {
          const merged: Record<string, unknown> = {};
          const result = objectRecord(data.result);
          if (channels.memory && hostInfo.memTotal != null) merged.system_memory = result?.system_memory;
          if (channels.uptime && hostInfo.uptime != null) merged.system_uptime = result?.system_uptime;
          if (Object.keys(merged).length > 0) applyHost(merged);
        }
      } catch (error) {
        if (!disposed) {
          setState((previous) => ({
            ...previous,
            liveError: error instanceof Error ? `${error.message} Live host data is stale.` : "Host data unavailable; live host data is stale.",
          }));
        }
      } finally {
        fallbackInFlight = false;
        window.clearTimeout(timeout);
      }
    };

    const receivePush = () => {
      const latest = moonraker.getLatestHostSample();
      if (latest && hostSampleIsFresh(latest.at, Date.now())) {
        const hostInfo = hostSampleInfo(latest);
        if (!hasHostInfo(hostInfo)) return;
        if (hostInfo.memTotal != null) memoryUpdatedAt = latest.at;
        if (hostInfo.uptime != null) uptimeUpdatedAt = latest.at;
        setState((previous) => ({
          ...previous,
          info: {
            ...previous.info,
            ...(hostInfo.memTotal != null ? { memTotal: hostInfo.memTotal, memUsed: hostInfo.memUsed } : {}),
            ...(hostInfo.uptime != null ? { uptime: hostInfo.uptime } : {}),
          },
          liveError: hostChannelsFresh(memoryUpdatedAt, uptimeUpdatedAt, Date.now()) ? null : previous.liveError,
          hostUpdatedAt: latest.at,
          memoryUpdatedAt: hostInfo.memTotal != null ? latest.at : previous.memoryUpdatedAt,
          uptimeUpdatedAt: hostInfo.uptime != null ? latest.at : previous.uptimeUpdatedAt,
        }));
      }
    };

    void loadStable();
    receivePush();
    const unsubscribe = moonraker.onHostStats(receivePush);
    const initialFallbackId = window.setTimeout(() => void refreshFallback(), 2_000);
    const fallbackId = window.setInterval(() => void refreshFallback(), HOST_FALLBACK_INTERVAL_MS);
    return () => {
      disposed = true;
      stableController?.abort();
      fallbackController?.abort();
      if (stableRetryId != null) window.clearTimeout(stableRetryId);
      unsubscribe();
      window.clearTimeout(initialFallbackId);
      window.clearInterval(fallbackId);
    };
  }, [enabled, connected, restartGeneration]);

  return { ...state, error: [state.stableError, state.liveError].filter(Boolean).join(" ") || null };
}

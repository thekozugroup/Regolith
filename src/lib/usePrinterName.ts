import { useEffect, useState } from "react";
import { useProfile } from "@/lib/useProfile";

/**
 * The printer's own name (Moonraker `/printer/info` hostname) for the brand
 * area. ONE fetch per app load, cached at module level — every consumer
 * shares the same request and the resolved name. Until it resolves (or if it
 * never does: offline, mock preview server), callers degrade to the active
 * profile's display name, so the UI never shows an empty gap.
 */
let cachedName: string | null = null;
let inflight: Promise<string | null> | null = null;

function fetchPrinterName(): Promise<string | null> {
  inflight ??= fetch("/printer/info")
    .then((r) => r.json())
    .then((d: { result?: { hostname?: unknown } }) => {
      const hostname = d?.result?.hostname;
      const name =
        typeof hostname === "string" && hostname.trim().length > 0
          ? hostname.trim()
          : null;
      if (name) cachedName = name;
      return name;
    })
    // Deliberately no retry: a failed probe leaves the profile name in
    // place for the session rather than hammering a dead endpoint.
    .catch(() => null);
  return inflight;
}

export function usePrinterName(): string {
  const profile = useProfile();
  const [name, setName] = useState<string | null>(cachedName);

  useEffect(() => {
    if (cachedName !== null) return;
    let live = true;
    void fetchPrinterName().then((resolved) => {
      if (live && resolved) setName(resolved);
    });
    return () => {
      live = false;
    };
  }, []);

  return name ?? profile.name;
}

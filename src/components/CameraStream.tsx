import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Robust MJPG camera stream.
 *
 * Why this component instead of a plain <img>:
 *   - Vite's dev proxy buffers long-running MJPG streams unpredictably,
 *     causing visible lag / freezing every few seconds. We bypass it by
 *     hitting mjpg_streamer's port 8080 directly via the printer hostname.
 *   - <img src> stalls silently if the connection drops or the server
 *     stutters. We watch the onLoad event — if no progressive frames in
 *     N seconds, we force a reconnect by changing the URL.
 *   - In production (built bundle served by nginx on the printer) the
 *     proxy isn't in the path so direct/relative is the same.
 */

interface Props {
  className?: string;
  /** Override hostname; defaults to current page host (works on tailnet + LAN). */
  host?: string;
  /** Stuck-watchdog timeout in ms — force reload if no frame in this window. */
  stallMs?: number;
}

export function CameraStream({ className, host, stallMs = 4000 }: Props) {
  const [generation, setGeneration] = useState(0);
  const [hasError, setHasError] = useState(false);
  const lastFrameRef = useRef(Date.now());
  const imgRef = useRef<HTMLImageElement>(null);

  // Build the direct URL — port 8080 to bypass nginx + vite proxy
  const buildUrl = (gen: number) => {
    const h = host ?? location.hostname;
    return `http://${h}:8080/?action=stream&_=${gen}`;
  };

  const url = buildUrl(generation);

  // Stuck watchdog — poll every second; if no progress, bump generation
  useEffect(() => {
    lastFrameRef.current = Date.now();
    const id = setInterval(() => {
      const idle = Date.now() - lastFrameRef.current;
      if (idle > stallMs) {
        setGeneration((g) => g + 1);
        lastFrameRef.current = Date.now();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [stallMs, generation]);

  // MJPG progressive: each chunk fires onLoad on most browsers.
  // We use a polling probe via fetch HEAD to verify reachability instead.
  useEffect(() => {
    let stopped = false;
    const probe = async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 1500);
        await fetch(buildUrl(generation).replace("action=stream", "action=snapshot"), {
          method: "GET",
          signal: ctl.signal,
        });
        clearTimeout(t);
        if (!stopped) lastFrameRef.current = Date.now();
      } catch {
        /* ignore */
      }
    };
    probe();
    const id = setInterval(probe, 1500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, host]);

  return (
    <div className={cn("relative bg-black", className)}>
      {hasError ? (
        <div className="absolute inset-0 flex items-center justify-center text-[var(--color-fg-muted)] text-[12px] uppercase tracking-[0.1em] font-mono">
          Stream offline
        </div>
      ) : null}
      <img
        ref={imgRef}
        key={generation}
        src={url}
        alt="Live"
        onLoad={() => {
          lastFrameRef.current = Date.now();
          setHasError(false);
        }}
        onError={() => setHasError(true)}
        className="w-full h-full object-cover"
        draggable={false}
      />
    </div>
  );
}

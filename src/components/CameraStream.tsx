import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
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
  /** Show fullscreen toggle button. */
  fullscreenable?: boolean;
}

export function CameraStream({
  className,
  host,
  stallMs = 4000,
  fullscreenable = true,
}: Props) {
  const [generation, setGeneration] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastFrameRef = useRef(Date.now());
  const imgRef = useRef<HTMLImageElement>(null);

  // Sync fullscreen state with browser-level fullscreen
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (containerRef.current) {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // Some browsers / permissions deny; ignore
    }
  };

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
    <div ref={containerRef} className={cn("relative bg-black group", className)}>
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
        className={cn(
          "w-full h-full",
          isFullscreen ? "object-contain" : "object-cover",
        )}
        draggable={false}
      />
      {fullscreenable && (
        <button
          onClick={toggleFullscreen}
          className={cn(
            "absolute top-2 right-2 w-7 h-7 rounded bg-black/60 backdrop-blur-sm border border-white/10 z-10",
            "flex items-center justify-center text-white/80 hover:text-white hover:bg-black/80",
            "transition-opacity",
            isFullscreen
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
          )}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? (
            <Minimize2 className="w-3.5 h-3.5" strokeWidth={2} />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" strokeWidth={2} />
          )}
        </button>
      )}
    </div>
  );
}

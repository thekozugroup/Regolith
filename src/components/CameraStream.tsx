import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { cameraRetryDelay } from "@/lib/retry";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  /** Override hostname; defaults to current page host (works on tailnet + LAN). */
  host?: string;
  /** Stop automatic network churn after this many retries. */
  maxAutomaticRetries?: number;
  /** Show fullscreen toggle button. */
  fullscreenable?: boolean;
}

type CameraStatus = "connecting" | "live" | "retrying" | "offline";

const STATUS_LABELS: Record<CameraStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  retrying: "Retrying",
  offline: "Offline",
};

/** MJPEG stream with bounded, user-recoverable failure handling. */
export function CameraStream({
  className,
  host,
  maxAutomaticRetries = 5,
  fullscreenable = true,
}: Props) {
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<CameraStatus>("connecting");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const statusRef = useRef<CameraStatus>("connecting");

  const updateStatus = useCallback((next: CameraStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current != null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current != null || statusRef.current === "offline") return;

    const attempt = retryAttemptRef.current;
    if (attempt >= maxAutomaticRetries) {
      updateStatus("offline");
      return;
    }

    retryAttemptRef.current = attempt + 1;
    updateStatus("retrying");
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      updateStatus("connecting");
      setGeneration((current) => current + 1);
    }, cameraRetryDelay(attempt));
  }, [maxAutomaticRetries, updateStatus]);

  const retryNow = useCallback(() => {
    clearRetryTimer();
    retryAttemptRef.current = 0;
    updateStatus("connecting");
    setGeneration((current) => current + 1);
  }, [clearRetryTimer, updateStatus]);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => clearRetryTimer, [clearRetryTimer]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (containerRef.current) {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // Browser permissions may deny fullscreen. The stream remains usable.
    }
  };

  const developmentHost = import.meta.env.DEV
    ? import.meta.env.VITE_REGOLITH_PRINTER_HOST || "forge.local"
    : undefined;
  const hostname = host ?? developmentHost ?? location.hostname;
  const url = `http://${hostname}:8080/?action=stream&_=${generation}`;
  // Concurrent React may discard and redo a render (a Moonraker push landing
  // mid route-transition does exactly this on load). An <img> created in a
  // DISCARDED render still starts its network fetch, so putting `url`
  // straight on the element double-hits the camera. Assign src only after
  // THIS instance actually committed: one fetch per generation, ever.
  const [committedSrc, setCommittedSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    setCommittedSrc(url);
  }, [url]);
  const available = status === "live";

  return (
    <div ref={containerRef} className={cn("group relative bg-black", className)}>
      {!available && (
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 px-6 text-center">
          <div aria-live="polite" className="text-[12px] font-medium text-white/70">
            {status === "connecting" && "Connecting to camera…"}
            {status === "retrying" && "Camera unavailable. Retrying…"}
            {status === "offline" && "Camera is offline. Printing controls are unaffected."}
          </div>
          {status === "offline" && (
            <button
              type="button"
              onClick={retryNow}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-inner border border-white/20 bg-white/10 px-3 text-[12px] font-medium text-white hover:bg-white/15"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try camera again
            </button>
          )}
        </div>
      )}
      {/* No key: the element is reused and the src ATTRIBUTE is the only
          load trigger, so each generation produces exactly one fetch when
          the committed src lands — a keyed remount would fetch the stale
          committed URL first. */}
      <img
        src={committedSrc}
        alt="Live printer camera"
        onLoad={() => {
          clearRetryTimer();
          retryAttemptRef.current = 0;
          updateStatus("live");
        }}
        onError={scheduleRetry}
        className={cn(
          "h-full w-full transition-opacity",
          !available && "opacity-0",
          isFullscreen ? "object-contain" : "object-cover",
        )}
        draggable={false}
      />
      <div
        aria-live="polite"
        className="absolute left-2 top-2 z-10 flex min-h-7 items-center gap-1.5 rounded-inner border border-white/15 bg-black/70 px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/90 backdrop-blur-sm"
      >
        <span
          aria-hidden="true"
          className={cn(
            "status-lamp",
            status === "live" && "text-[var(--color-success)]",
            (status === "connecting" || status === "retrying") &&
              "text-[var(--color-warning)]",
            status === "offline" && "text-[var(--color-error)]",
          )}
        />
        {STATUS_LABELS[status]}
      </div>
      {available && (
        <div
          className={cn(
            "absolute right-2 top-2 z-10 flex gap-1.5 transition-opacity",
            isFullscreen
              ? "opacity-100"
              : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100",
          )}
        >
          <button
            type="button"
            onClick={retryNow}
            aria-label="Refresh camera stream"
            title="Refresh camera"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-inner border border-white/15 bg-black/70 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          {fullscreenable && (
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit camera fullscreen" : "Open camera fullscreen"}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-inner border border-white/15 bg-black/70 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white"
            >
              {isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

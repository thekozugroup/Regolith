import { useEffect } from "react";
import { useNavigate } from "react-router";
import { moonraker } from "./moonraker";
import { getSafetyState } from "./safety";

/**
 * Global keyboard shortcuts.
 *
 * Active everywhere except when an input/textarea/console is focused.
 *
 *   ?         show help (toast)
 *   g d       go to dashboard
 *   g f       go to files
 *   g c       go to control
 *   g t       go to tune
 *   g k       go to console
 *   g s       go to settings
 *   space     pause/resume print (with confirm if would interrupt)
 *   esc       close confirms / dismiss alerts
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    let chord: string | null = null;
    let chordTimer: number | null = null;

    const isTyping = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        el.isContentEditable
      );
    };

    const handler = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Space: toggle pause
      if (e.code === "Space") {
        e.preventDefault();
        const ps = moonraker.getState().print_stats?.state;
        if (ps === "printing") {
          if (confirm("Pause print?")) moonraker.pause().catch(() => {});
        } else if (ps === "paused") {
          if (confirm("Resume print?")) moonraker.resume().catch(() => {});
        }
        return;
      }

      // Help
      if (e.key === "?") {
        e.preventDefault();
        showHelp();
        return;
      }

      // Chord prefix "g"
      if (chord === "g") {
        if (chordTimer) clearTimeout(chordTimer);
        chord = null;
        switch (e.key.toLowerCase()) {
          case "d":
            navigate("/");
            break;
          case "f":
            navigate("/print");
            break;
          case "c":
            navigate("/control");
            break;
          case "t":
            navigate("/tune");
            break;
          case "k":
            navigate("/console");
            break;
          case "s":
            navigate("/settings");
            break;
        }
        return;
      }
      if (e.key.toLowerCase() === "g") {
        chord = "g";
        if (chordTimer) clearTimeout(chordTimer);
        chordTimer = window.setTimeout(() => {
          chord = null;
        }, 1500);
        return;
      }

      // Tune-page-only: emergency stop with `e e e` (triple-tap)
      // (Keeps it deliberate; no accidental presses.)
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (chordTimer) clearTimeout(chordTimer);
    };
  }, [navigate]);

  // Suppress unused-import lint
  void getSafetyState;
}

function showHelp(): void {
  const lines = [
    "Keyboard shortcuts:",
    "",
    "  ?         show this help",
    "  g d       Dashboard",
    "  g f       Files",
    "  g c       Control",
    "  g t       Tune",
    "  g k       Console",
    "  g s       Settings",
    "  space     Pause / Resume print",
  ];
  alert(lines.join("\n"));
}

import { useEffect, useState } from "react";
import { readStored, writeStored } from "./safeStorage";

export type ExperienceMode = "basic" | "expert";

const STORAGE_KEY = "forge.experience-mode";
const CHANGE_EVENT = "forge:experience-mode-changed";

export function normalizeExperienceMode(value: string | null): ExperienceMode {
  return value === "expert" ? "expert" : "basic";
}

function readExperienceMode(): ExperienceMode {
  return normalizeExperienceMode(readStored(STORAGE_KEY));
}

export function setExperienceMode(mode: ExperienceMode): void {
  writeStored(STORAGE_KEY, mode);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useExperienceMode() {
  const [mode, setMode] = useState<ExperienceMode>(readExperienceMode);

  useEffect(() => {
    const sync = () => setMode(readExperienceMode());
    window.addEventListener("storage", sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  return [mode, setExperienceMode] as const;
}

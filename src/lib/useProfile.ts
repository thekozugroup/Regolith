import { useEffect, useState } from "react";
import {
  getActiveProfile,
  listProfiles,
  onProfileChange,
  type PrinterProfile,
} from "@/profiles";

/**
 * Subscribe to the active profile. Re-renders when the user switches
 * profiles or uploads/removes a custom one.
 */
export function useProfile(): PrinterProfile {
  const [profile, setProfile] = useState<PrinterProfile>(() => getActiveProfile());
  useEffect(() => onProfileChange(() => setProfile(getActiveProfile())), []);
  return profile;
}

export function useProfileList(): PrinterProfile[] {
  const [list, setList] = useState<PrinterProfile[]>(() => listProfiles());
  useEffect(() => onProfileChange(() => setList(listProfiles())), []);
  return list;
}

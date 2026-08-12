import { useCallback, useState } from "react";
import { DEFAULT_IDE_SETTINGS, normalizeIdeSettings } from "../lib/settings";
import type { IdeSettings } from "../types/settings";

const SETTINGS_KEY = "webforge.ideSettings.v1";

function loadSettings(): IdeSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? normalizeIdeSettings(JSON.parse(raw)) : DEFAULT_IDE_SETTINGS;
  } catch {
    return DEFAULT_IDE_SETTINGS;
  }
}

export function useIdeSettings() {
  const [settings, setSettingsState] = useState<IdeSettings>(loadSettings);
  const setSettings = useCallback((next: IdeSettings | ((current: IdeSettings) => IdeSettings)) => {
    setSettingsState((current) => {
      const value = normalizeIdeSettings(typeof next === "function" ? next(current) : next);
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)); } catch { /* best effort */ }
      return value;
    });
  }, []);
  const resetSettings = useCallback(() => setSettings(DEFAULT_IDE_SETTINGS), [setSettings]);
  return { settings, setSettings, resetSettings };
}

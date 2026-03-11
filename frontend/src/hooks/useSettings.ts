import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'ai-historian-settings';

interface Settings {
  reducedMotion: boolean;
  autoWatch: boolean;
  voiceEnabled: boolean;
  showCaptions: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  reducedMotion: false,
  autoWatch: false,
  voiceEnabled: true,
  showCaptions: true,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS;
    const obj = parsed as Record<string, unknown>;
    return {
      reducedMotion: typeof obj['reducedMotion'] === 'boolean' ? obj['reducedMotion'] : DEFAULT_SETTINGS.reducedMotion,
      autoWatch: typeof obj['autoWatch'] === 'boolean' ? obj['autoWatch'] : DEFAULT_SETTINGS.autoWatch,
      voiceEnabled: typeof obj['voiceEnabled'] === 'boolean' ? obj['voiceEnabled'] : DEFAULT_SETTINGS.voiceEnabled,
      showCaptions: typeof obj['showCaptions'] === 'boolean' ? obj['showCaptions'] : DEFAULT_SETTINGS.showCaptions,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

type SettingsKey = keyof Settings;

export function useSettings(): [Settings, (key: SettingsKey, value: boolean) => void] {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const updateSetting = useCallback((key: SettingsKey, value: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Sync across tabs
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        setSettings(loadSettings());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return [settings, updateSetting];
}

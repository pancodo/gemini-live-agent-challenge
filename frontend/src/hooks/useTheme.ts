import { useCallback, useEffect } from 'react';
import { useSettings, type Theme } from './useSettings';

export type { Theme };

/**
 * useTheme — manages the app-wide color theme (light | dark).
 * Applies `data-theme="light"|"dark"` on the document root element.
 * The documentary player (.player-root) ignores this via `color-scheme: only dark`.
 */
export function useTheme(): {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (t: Theme) => void;
} {
  const [settings, updateSetting] = useSettings();
  const { theme } = settings;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback(
    (t: Theme) => updateSetting('theme', t),
    [updateSetting]
  );

  return { theme, resolvedTheme: theme, setTheme };
}

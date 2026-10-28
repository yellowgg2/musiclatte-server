import { useLayoutEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const key = 'musiclatte.theme';

function resolveTheme(value: string | null | undefined): Theme {
  return value === 'dark' ? 'dark' : 'light';
}

function readTheme(): Theme {
  try {
    return resolveTheme(localStorage.getItem(key));
  } catch {
    return resolveTheme(document.documentElement.dataset.theme);
  }
}

export function initializeTheme(): Theme {
  const theme = readTheme();
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const applied = document.documentElement.dataset.theme;
    return applied ? resolveTheme(applied) : readTheme();
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useLayoutEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setTheme(resolveTheme(event.newValue));
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  return [
    theme,
    (value: Theme) => {
      setTheme(value);
      try {
        localStorage.setItem(key, value);
      } catch {
        /* Keep the in-memory preference when browser storage is unavailable. */
      }
    },
  ] as const;
}

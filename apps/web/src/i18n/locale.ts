import { useEffect, useState } from 'react';
import type { Locale } from './index';
const key = 'musiclatte.locale';
export function resolveLocale(saved: string | null, languages: readonly string[]): Locale {
  if (saved === 'ko' || saved === 'en') return saved;
  for (const language of languages) {
    const locale = language.toLowerCase().split('-')[0];
    if (locale === 'ko' || locale === 'en') return locale;
  }
  return 'en';
}
function initialLocale(): Locale {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(key);
  } catch {
    /* Preference persistence is optional. */
  }
  return resolveLocale(saved, navigator.languages);
}
export function useLocale() {
  const [locale, setLocale] = useState(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key) setLocale(resolveLocale(event.newValue, navigator.languages));
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  return [
    locale,
    (value: Locale) => {
      setLocale(value);
      try {
        localStorage.setItem(key, value);
      } catch {
        /* Use the in-memory preference. */
      }
    },
  ] as const;
}

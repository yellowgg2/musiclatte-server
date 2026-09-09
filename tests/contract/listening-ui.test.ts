import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
/** Listening labels, scope and failure help have equivalent nonempty locale keys. */
it('should provide matching listening copy for KO and EN', () => {
  const locales = ['ko', 'en'].map((locale) =>
    JSON.parse(readFileSync(`apps/web/src/i18n/${locale}.json`, 'utf8')),
  );
  const keys = Object.keys(locales[0]).filter((key) => key.startsWith('listening.'));
  expect(keys.length).toBeGreaterThan(10);
  expect(keys.sort()).toEqual(
    Object.keys(locales[1])
      .filter((key) => key.startsWith('listening.'))
      .sort(),
  );
  for (const locale of locales) for (const key of keys) expect(locale[key].trim()).not.toBe('');
});
/** Presets represent rolling elapsed UTC intervals instead of calendar-day boundaries. */
it('should freeze seven and thirty day query ranges', async () => {
  const { listeningRange } = await import('../../apps/web/src/listening/state');
  const now = Date.parse('2026-09-09T13:25:00.000Z');
  expect(listeningRange('all', now)).toEqual({});
  for (const days of ['7', '30'] as const) {
    const range = listeningRange(days, now);
    expect(range.to).toBe(new Date(now).toISOString());
    expect(Date.parse(range.to!) - Date.parse(range.from!)).toBe(Number(days) * 86400000);
  }
});

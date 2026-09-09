import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
/** Both product locales expose the same nonempty mix copy. */
it('should provide matching mix locale keys', () => {
  const locales = ['ko', 'en'].map((locale) =>
    JSON.parse(readFileSync(`apps/web/src/i18n/${locale}.json`, 'utf8')),
  );
  const keys = Object.keys(locales[0]).filter((key) => key.startsWith('mix.'));
  expect(keys.length).toBeGreaterThan(10);
  expect(keys.sort()).toEqual(
    Object.keys(locales[1])
      .filter((key) => key.startsWith('mix.'))
      .sort(),
  );
  for (const locale of locales)
    for (const key of keys) expect(locale[key].trim().length).toBeGreaterThan(0);
});

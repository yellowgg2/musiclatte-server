import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { qualityScope, qualityStorageKey, decodeQuality } from '../../apps/web/src/player/quality';
import en from '../../apps/web/src/i18n/en.json';
import ko from '../../apps/web/src/i18n/ko.json';
it('hashes normalized API/account/instance scope without readable identity', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const one = qualityScope('https://api.test:443/', 'instance', 'CaseName', 'https://web.test');
  const key = await qualityStorageKey(one);
  expect(key).toMatch(/^musiclatte:quality:v1:[a-f0-9]{64}$/);
  expect(key).not.toContain('CaseName');
  expect(
    await qualityStorageKey(
      qualityScope('https://api.test', 'instance', 'CaseName', 'https://web.test'),
    ),
  ).toBe(key);
  for (const scope of [
    qualityScope('https://other.test', 'instance', 'CaseName', 'https://web.test'),
    qualityScope('https://api.test', 'other', 'CaseName', 'https://web.test'),
    qualityScope('https://api.test', 'instance', 'other', 'https://web.test'),
  ])
    expect(await qualityStorageKey(scope)).not.toBe(key);
  vi.unstubAllGlobals();
});
it('allows only enum storage values and complete nonempty bilingual copy', () => {
  expect(decodeQuality('{"quality":"economy","token":"secret"}')).toBeNull();
  expect(decodeQuality('economy')).toBe('economy');
  const keys = Object.keys(en).filter((k) => k.startsWith('quality.'));
  expect(keys.length).toBeGreaterThanOrEqual(15);
  expect(Object.keys(ko).filter((k) => k.startsWith('quality.'))).toEqual(keys);
  for (const k of keys) {
    expect(en[k as keyof typeof en].trim()).not.toBe('');
    expect(ko[k as keyof typeof ko].trim()).not.toBe('');
  }
});

import { describe, expect, it } from 'vitest';
import en from '../../apps/web/src/i18n/en.json';
import ko from '../../apps/web/src/i18n/ko.json';

const locales = { en, ko };
const repeatKeys = [
  'player.repeat',
  'player.repeat.label',
  'player.repeat.off',
  'player.repeat.one',
  'player.repeat.all',
] as const;

describe('player repeat locale contract', () => {
  /** Both product locales expose complete repeat copy with matching interpolation names. */
  it('should provide matching nonempty current and next repeat labels', () => {
    for (const copy of Object.values(locales)) {
      const repeat = copy as Record<string, string>;
      for (const key of repeatKeys) expect(repeat[key]?.trim(), key).not.toBe('');
      expect(
        [...(repeat['player.repeat.label'] ?? '').matchAll(/\{([^}]+)\}/g)].map(
          (match) => match[1],
        ),
      ).toEqual(['current', 'next']);
    }
    expect(Object.keys(ko).filter((key) => key.startsWith('player.repeat'))).toEqual(
      Object.keys(en).filter((key) => key.startsWith('player.repeat')),
    );
  });
});

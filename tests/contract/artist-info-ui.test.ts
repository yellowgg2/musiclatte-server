import { describe, expect, it } from 'vitest';
import { clientFeatures } from '../../apps/web/src/capabilities/client-features.js';
import ko from '../../apps/web/src/i18n/ko.json';
import en from '../../apps/web/src/i18n/en.json';

describe('artist information UI contract', () => {
  it('enables the completed consumer with matching localized state copy', () => {
    expect(clientFeatures['music.artistInfo']).toBe(true);
    const keys = Object.keys(ko).filter((key) => key.startsWith('artistInfo.'));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.sort()).toEqual(
      Object.keys(en)
        .filter((key) => key.startsWith('artistInfo.'))
        .sort(),
    );
    for (const key of keys) {
      expect(ko[key as keyof typeof ko]).not.toBe('');
      expect(en[key as keyof typeof en]).not.toBe('');
    }
  });
});

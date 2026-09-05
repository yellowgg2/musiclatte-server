import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type Locale = 'ko' | 'en';
interface I18n {
  messages: Record<Locale, Record<string, string>>;
  formatCount: (count: number, locale: Locale) => string;
  formatDate: (date: Date, locale: Locale, timeZone?: string) => string;
}
async function makeSUT(): Promise<I18n> {
  const path = resolve('apps/web/src/i18n/index.ts');
  expect(existsSync(path), 'locale module must exist').toBe(true);
  return import(path);
}
describe('workspace foundation', () => {
  /** The executing runtime must match the locked project contract. */
  it('should use the pinned Node and npm toolchain', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(process.versions.node).toBe(readFileSync('.node-version', 'utf8').trim());
    expect(manifest.engines.node).toBe(process.versions.node);
    expect(readFileSync('.nvmrc', 'utf8').trim()).toBe(process.versions.node);
    expect(manifest.packageManager).toBe('npm@11.19.0');
  });
  /** Every locale has the same nonempty copy, without unmatched placeholders. */
  it('should expose matching KO and EN resources', async () => {
    const { messages } = await makeSUT();
    expect(Object.keys(messages).sort()).toEqual(['en', 'ko']);
    expect(Object.keys(messages.ko).sort()).toEqual(Object.keys(messages.en).sort());
    expect(Object.keys(messages.ko).length).toBeGreaterThan(0);
    for (const key of Object.keys(messages.ko)) {
      expect(messages.ko[key]?.trim()).toBeTruthy();
      expect(messages.en[key]?.trim()).toBeTruthy();
      expect(messages.ko[key]?.match(/\{[^}]+\}/g) ?? []).toEqual(
        messages.en[key]?.match(/\{[^}]+\}/g) ?? [],
      );
    }
  });
  /** Counts use locale number formatting and reject invalid counts. */
  it('should format zero and grouped counts and reject invalid input', async () => {
    const sut = await makeSUT();
    for (const locale of ['ko', 'en'] as const) {
      expect(sut.formatCount(0, locale)).toBe('0');
      expect(sut.formatCount(12345, locale)).toBe(new Intl.NumberFormat(locale).format(12345));
    }
    for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => sut.formatCount(value, 'ko')).toThrow(RangeError);
    }
  });
  /** Explicit date zones avoid host-dependent output and preserve locale order. */
  it('should format dates in both locales and reject invalid dates', async () => {
    const sut = await makeSUT();
    const date = new Date('2026-01-01T23:30:00Z');
    for (const locale of ['ko', 'en'] as const) {
      expect(sut.formatDate(date, locale)).toBe(
        new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date),
      );
      expect(sut.formatDate(date, locale, 'Asia/Seoul')).toBe(
        new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(
          date,
        ),
      );
    }
    expect(() => sut.formatDate(new Date('invalid'), 'en')).toThrow(RangeError);
  });
  /** Local agent state, secrets and generated artifacts never become source candidates. */
  it('should ignore sensitive artifacts while retaining source and lockfiles', () => {
    const ignored = [
      'AGENTS.md',
      'apps/web/AGENTS.md',
      'AGENTS.override.md',
      '.serena/project.yml',
      '.codex/config.toml',
      '.agents/skills/test.md',
      '.env',
      'apps/api/.env.local',
      'data/test.sqlite',
      'media/a.mp3',
      'secrets/test.txt',
      'apps/web/dist/index.html',
      'node_modules/test.js',
    ];
    for (const path of ignored)
      expect(
        execFileSync('git', ['check-ignore', '--no-index', path], { encoding: 'utf8' }).trim(),
      ).toBe(path);
    for (const path of ['package-lock.json', 'apps/api/src/app.ts', '.env.example']) {
      expect(() =>
        execFileSync('git', ['check-ignore', '--no-index', path], { stdio: 'pipe' }),
      ).toThrow();
    }
  });
});

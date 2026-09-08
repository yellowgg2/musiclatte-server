import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function makeSUT() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'metadata-cover-cache-')));
  roots.push(root);
  const cache = join(root, 'covers');
  mkdirSync(cache);
  const path = resolve('apps/api/src/metadata/gonic-cover-cache.ts');
  expect(existsSync(path), 'targeted cover cache adapter exists').toBe(true);
  const { createGonicCoverCache } = await import(path);
  return { root, cache, refresh: createGonicCoverCache(cache), createGonicCoverCache };
}
describe('gonic cover cache invalidation', () => {
  /** Evict every warmed size/format only for the requested track and album, retaining unrelated cache. */
  it('should refresh edited and restored covers without touching other tracks or audio', async () => {
    const c = await makeSUT();
    const affected = ['tr-1-64.png', 'tr-1-600.jpeg', 'al-2-300.webp', 'al-2-300.png'];
    const retained = [
      'tr-10-64.png',
      'tr-2-64.png',
      'tr-1-invalid.png',
      'tr-1-64.png.tmp',
      'al-3-300.jpeg',
    ];
    for (const name of [...affected, ...retained]) writeFileSync(join(c.cache, name), 'old');
    writeFileSync(join(c.root, 'audio'), 'audio');
    c.refresh(['tr-1', 'al-2', 'tr-1']);
    for (const name of affected.filter((name) => !name.endsWith('.webp')))
      expect(existsSync(join(c.cache, name))).toBe(false);
    for (const name of [...retained, 'al-2-300.webp'])
      expect(readFileSync(join(c.cache, name), 'utf8')).toBe('old');
    writeFileSync(join(c.cache, 'tr-1-64.png'), 'changed');
    c.refresh(['tr-1']);
    expect(existsSync(join(c.cache, 'tr-1-64.png'))).toBe(false);
    expect(readFileSync(join(c.root, 'audio'), 'utf8')).toBe('audio');
  });
  /** IDs are validated as a whole before any mutation, including a valid prefix followed by traversal. */
  it('should reject malformed IDs before removing any cache entry', async () => {
    const c = await makeSUT();
    for (const invalid of ['../tr-1', 'tr-1/../../secret', 'tr-1.*', 'ar-1', 'tr-0', 'tr-01']) {
      writeFileSync(join(c.cache, 'tr-1-64.png'), 'old');
      expect(() => c.refresh(['tr-1', invalid])).toThrow();
      expect(readFileSync(join(c.cache, 'tr-1-64.png'), 'utf8')).toBe('old');
    }
  });
  /** A shared filename that is a directory or symlink is refused, never followed or recursively removed. */
  it.each(['symlink', 'directory'])('should fail closed for a matching %s', async (kind) => {
    const c = await makeSUT();
    const target = join(c.root, 'outside');
    writeFileSync(target, 'preserve');
    if (kind === 'symlink') symlinkSync(target, join(c.cache, 'tr-1-64.png'));
    else mkdirSync(join(c.cache, 'tr-1-64.png'));
    expect(() => c.refresh(['tr-1'])).toThrow();
    expect(readFileSync(target, 'utf8')).toBe('preserve');
  });
  /** A directory replacement after startup invalidates ownership; no replacement files are deleted. */
  it('should reject a replaced cache root', async () => {
    const c = await makeSUT();
    renameSync(c.cache, join(c.root, 'old'));
    mkdirSync(c.cache);
    writeFileSync(join(c.cache, 'tr-1-64.png'), 'preserve');
    expect(() => c.refresh(['tr-1'])).toThrow();
    expect(readFileSync(join(c.cache, 'tr-1-64.png'), 'utf8')).toBe('preserve');
    expect(() => c.createGonicCoverCache(`${c.root}/..`)).toThrow();
  });
});

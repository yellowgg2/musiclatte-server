import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { metadataDirectory } from './runtime-config.js';

/** Pinned gonic 0.22 cache filenames; this adapter never opens media or gonic's database. */
export function createGonicCoverCache(root: string) {
  metadataDirectory(root, false);
  const original = lstatSync(root, { bigint: true });
  const owned = () => {
    const current = lstatSync(root, { bigint: true });
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== original.dev ||
      current.ino !== original.ino
    )
      throw new Error('cover_cache_unavailable');
  };
  return (ids: readonly string[]) => {
    if (ids.length > 8 || ids.some((id) => !/^(?:tr|al)-[1-9][0-9]{0,18}$/.test(id)))
      throw new Error('cover_cache_unavailable');
    const targets = new Set(ids);
    owned();
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const match = /^((?:tr|al)-[1-9][0-9]{0,18})-[1-9][0-9]*\.(?:jpeg|png|gif|bmp|tiff)$/.exec(
        entry.name,
      );
      if (!match || !targets.has(match[1]!)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('cover_cache_unavailable');
      owned();
      try {
        // Unlink only this derived image. No recursion and no traversal of a symlink target.
        unlinkSync(join(root, entry.name));
      } catch (error) {
        // gonic's LRU may have removed the same image after directory enumeration.
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
  };
}

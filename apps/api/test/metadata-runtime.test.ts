import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('metadata runtime', () => {
  it('resolves worker uploads for both single-cover and replace-all patches', async () => {
    const { metadataWorkerCoverUploadId } = await import('../src/metadata-worker-runtime.js');
    expect(
      metadataWorkerCoverUploadId({
        cover: { op: 'set', selector: { kind: 'new' }, uploadId: 'single' },
      }),
    ).toBe('single');
    expect(
      metadataWorkerCoverUploadId({ cover: { op: 'replaceAll', uploadId: 'normalized' } }),
    ).toBe('normalized');
    expect(metadataWorkerCoverUploadId({ cover: { op: 'clearAll' } })).toBeUndefined();
  });
  /** Each bounded cycle gives saved items a turn even when the file queue stays busy. */
  it('should alternate recovery, one file job and due reflection without requiring the import engine', async () => {
    const path = resolve('apps/api/src/metadata-worker-runtime.ts');
    expect(existsSync(path), 'metadata runtime must exist').toBe(true);
    const { createMetadataScheduler } = await import(path);
    const calls: string[] = [];
    const scheduler = createMetadataScheduler({
      recover: async () => {
        calls.push('recover');
        return false;
      },
      file: async () => {
        calls.push('file');
        return true;
      },
      reflect: async () => {
        calls.push('reflect');
        return true;
      },
    });
    await scheduler.cycle(new AbortController().signal);
    await scheduler.cycle(new AbortController().signal);
    expect(calls).toEqual(['recover', 'file', 'reflect', 'recover', 'file', 'reflect']);
    const stopped = new AbortController();
    stopped.abort();
    await scheduler.cycle(stopped.signal);
    expect(calls).toHaveLength(6);
  });
  it('gives organization filesystem work a bounded turn after metadata recovery', async () => {
    const { createMetadataScheduler } = await import('../src/metadata-worker-runtime.js');
    const calls: string[] = [];
    const task = (name: string) => async () => {
      calls.push(name);
      return false;
    };
    const scheduler = createMetadataScheduler({
      recover: task('recover'),
      organize: task('organize'),
      file: task('file'),
      reflect: task('reflect'),
    });
    await scheduler.cycle(new AbortController().signal);
    expect(calls).toEqual(['recover', 'organize', 'file', 'reflect']);
  });
  it('recognizes only transient SQLite writer contention for bounded retry', async () => {
    const { metadataWorkerContention } = await import('../src/metadata-worker-runtime.js');
    expect(metadataWorkerContention(new Error('database is locked'))).toBe(true);
    expect(metadataWorkerContention(new Error('database_is_locked'))).toBe(true);
    expect(metadataWorkerContention(new Error('invalid_metadata'))).toBe(false);
  });
  it('does not let one transient writer collision starve later scheduler owners', async () => {
    const { createMetadataScheduler } = await import('../src/metadata-worker-runtime.js');
    const calls: string[] = [];
    const scheduler = createMetadataScheduler({
      recover: async () => {
        calls.push('recover');
        throw new Error('database is locked');
      },
      organize: async () => {
        calls.push('organize');
        return false;
      },
      file: async () => {
        calls.push('file');
        return false;
      },
      reflect: async () => {
        calls.push('reflect');
        return false;
      },
      inventory: async () => {
        calls.push('inventory');
        return true;
      },
    });
    expect(await scheduler.cycle(new AbortController().signal)).toBe(true);
    expect(calls).toEqual(['recover', 'organize', 'file', 'reflect', 'inventory']);
  });
  it('gives inventory a bounded turn after foreground metadata work', async () => {
    const { createMetadataScheduler } = await import('../src/metadata-worker-runtime.js');
    const calls: string[] = [];
    const task = (name: string) => async () => {
      calls.push(name);
      return false;
    };
    await createMetadataScheduler({
      recover: task('recover'),
      organize: task('organize'),
      inventory: task('inventory'),
      file: task('file'),
      reflect: task('reflect'),
    }).cycle(new AbortController().signal);
    expect(calls).toEqual(['recover', 'organize', 'file', 'reflect', 'inventory']);
  });
  /** Health inspection cannot create management storage or execute a helper. */
  it('should report disabled or missing worker state without creating it', async () => {
    const path = resolve('apps/api/src/metadata-worker-runtime.ts');
    expect(existsSync(path)).toBe(true);
    const { metadataWorkerHealth } = await import(path);
    expect(metadataWorkerHealth({})).toBe(false);
    expect(
      metadataWorkerHealth({
        METADATA_ENABLED: 'true',
        MANAGEMENT_DIRECTORY: '/missing-musiclatte-private',
      }),
    ).toBe(false);
    expect(existsSync('/missing-musiclatte-private')).toBe(false);
  });
});

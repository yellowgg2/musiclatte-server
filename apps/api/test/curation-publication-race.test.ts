import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createMetadataFixture } from '../../../packages/test-support/src/metadata-fixtures.js';
import {
  createMediaFence,
  createMediaPublicationLedger,
  verifyLockedSnapshot,
} from '../src/metadata/media-fence.js';
import { createMetadataFileStore } from '../src/metadata/file-store.js';
const cache = join(homedir(), '.cache/musiclatte-toolchain');
const python = process.env.METADATA_TEST_PYTHON ?? join(cache, 'metadata-python/bin/python');
const ffmpeg = process.env.METADATA_TEST_FFMPEG ?? join(cache, 'ffmpeg-9.0.1/ffmpeg');
const ffprobe = process.env.METADATA_TEST_FFPROBE ?? join(cache, 'ffmpeg-9.0.1/ffprobe');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

it.each(['candidate_verified', 'file_saved'] as const)(
  'keeps both processes serialized at %s and recovers lost acknowledgement under the same fence',
  async (crashAt) => {
    const c = await createTestContext();
    try {
      const root = realpathSync(c.root);
      const dir = (name: string) => {
        const path = join(root, name);
        mkdirSync(path, { mode: 0o700 });
        return path;
      };
      const musicRoot = dir('music');
      const privateRoot = dir('private');
      const lockRoot = dir('locks');
      await createMetadataFixture({ root: musicRoot, python, ffmpeg, version: 4 });
      const identity = 'a'.repeat(64);
      const original = hash(readFileSync(join(musicRoot, 'source.mp3')));
      let now = 1000;
      const publications = createMediaPublicationLedger(c.db, () => now);
      const store = createMetadataFileStore({
        musicRoot,
        privateRoot,
        lockRoot,
        publications,
        python,
        ffmpeg,
        ffprobe,
        helperPath: resolve('apps/api/helpers/file_transaction.py'),
        timeoutMs: 60000,
        maxFileBytes: 10 * 1024 * 1024,
      });
      const fence = createMediaFence({
        root: lockRoot,
        python,
        helperPath: resolve('apps/api/helpers/media_fence.py'),
        timeoutMs: 5000,
      });
      const input = {
        itemId: 'synthetic',
        fileIdentity: identity,
        key: 'source.mp3',
        generation: 1,
        expectedDigest: original,
        patch: { title: { op: 'set', value: 'Changed synthetic' } },
        preserveOwnership: true,
      };
      await expect(
        store.execute(input, {
          onEvent: async (event, control) => {
            if (event.stage === crashAt) {
              now = 100000;
              await expect(fence.acquire(identity, 'verify')).rejects.toThrow('file_busy');
              control.kill();
            }
          },
        }),
      ).rejects.toThrow('worker_interrupted');
      expect(c.db.connection.prepare('SELECT dirty FROM media_publications').get()?.dirty).toBe(1);
      const recovery = await store.recover({ ...input, generation: 2 }, async () => {
        await expect(fence.acquire(identity, 'publish')).rejects.toThrow('file_busy');
      });
      expect(recovery.state).toBe(crashAt === 'file_saved' ? 'file_saved' : 'preimage');
      expect(recovery.digest === original).toBe(crashAt !== 'file_saved');
      await fence.withMediaFence(identity, 'verify', async (held) => {
        const current = publications.begin(identity, held.nonce);
        expect(current.generation).toBe(3);
        expect(() =>
          publications.validate({ fileIdentity: identity, generation: 1, owner: 'synthetic:1' }),
        ).toThrow('fence_lost');
      });
    } finally {
      c.cleanup();
    }
  },
);

it('rejects external changes during verification without recording a successful receipt', async () => {
  const c = await createTestContext();
  try {
    const root = join(realpathSync(c.root), 'locks');
    mkdirSync(root, { mode: 0o700 });
    const file = join(realpathSync(c.root), 'synthetic');
    writeFileSync(file, 'before');
    const fence = createMediaFence({
      root,
      python,
      helperPath: resolve('apps/api/helpers/media_fence.py'),
      timeoutMs: 5000,
    });
    let committed = false;
    await expect(
      fence.withMediaFence('b'.repeat(64), 'verify', (held) =>
        verifyLockedSnapshot(
          held,
          async () => ({ digest: hash(readFileSync(file)) }),
          async () => {
            writeFileSync(file, 'after');
            return 'result';
          },
          () => {
            committed = true;
          },
        ),
      ),
    ).rejects.toThrow('revision_conflict');
    expect(committed).toBe(false);
  } finally {
    c.cleanup();
  }
});

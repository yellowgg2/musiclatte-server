import { afterEach, describe, expect, it } from 'vitest';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  appendFileSync,
  chmodSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMetadataFixture } from '../../../packages/test-support/src/metadata-fixtures.js';
import { createTestContext, proof } from '../../../tests/support/session-storage-harness.js';
const cache = join(homedir(), '.cache/musiclatte-toolchain');
const python = process.env.METADATA_TEST_PYTHON ?? join(cache, 'metadata-python/bin/python');
const ffmpeg = process.env.METADATA_TEST_FFMPEG ?? join(cache, 'ffmpeg-9.0.1/ffmpeg');
const ffprobe = process.env.METADATA_TEST_FFPROBE ?? join(cache, 'ffmpeg-9.0.1/ffprobe');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let temp: string | undefined;
afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});
async function fixture() {
  const path = resolve('apps/api/src/metadata/file-store.ts');
  expect(existsSync(path)).toBe(true);
  const { createMetadataFileStore } = (await import(
    path
  )) as typeof import('../src/metadata/file-store.js');
  temp = realpathSync(mkdtempSync(join(tmpdir(), 'musiclatte-transaction-')));
  const musicRoot = join(temp, 'music');
  const privateRoot = join(temp, 'private');
  mkdirSync(musicRoot);
  mkdirSync(privateRoot, { mode: 0o700 });
  await createMetadataFixture({ root: musicRoot, python, ffmpeg, version: 4 });
  const original = readFileSync(join(musicRoot, 'source.mp3'));
  const store = createMetadataFileStore({
    python,
    ffmpeg,
    ffprobe,
    musicRoot,
    privateRoot,
    helperPath: resolve('apps/api/helpers/file_transaction.py'),
    timeoutMs: 60000,
    maxFileBytes: 10 * 1024 * 1024,
  });
  const input = {
    itemId: 'synthetic-item',
    fileIdentity: 'a'.repeat(64),
    key: 'source.mp3',
    generation: 1,
    expectedDigest: digest(original),
    patch: { title: { op: 'set', value: 'Changed synthetic' } },
    preserveOwnership: true,
  };
  return { store, input, musicRoot, privateRoot, original };
}
describe('durable metadata file transaction', () => {
  it('should reconstruct a receipt after death immediately after rename, before directory fsync', async () => {
    const s = await fixture();
    const wrapper = join(temp!, 'rename-crash.py');
    writeFileSync(
      wrapper,
      `import sys, os, json\nsys.path.insert(0,${JSON.stringify(resolve('apps/api/helpers'))})\nimport file_transaction as t\nreplace=os.replace\ndef crash(source,target,**kwargs):\n    replace(source,target,**kwargs)\n    if target == "source.mp3":\n        os._exit(73)\nos.replace=crash\nt.transaction(json.loads(sys.stdin.buffer.readline()))\n`,
    );
    const { createMetadataFileStore } = await import('../src/metadata/file-store.js');
    const crashing = createMetadataFileStore({
      python,
      ffmpeg,
      ffprobe,
      musicRoot: s.musicRoot,
      privateRoot: s.privateRoot,
      helperPath: wrapper,
      timeoutMs: 60000,
      maxFileBytes: 10 * 1024 * 1024,
    });
    const stages: string[] = [];
    await expect(
      crashing.execute(s.input, {
        onEvent: async (event) => {
          stages.push(event.stage);
        },
      }),
    ).rejects.toThrow('worker_interrupted');
    expect(stages).toEqual(['backup_verified', 'candidate_verified']);
    const result = await s.store.recover({ ...s.input, generation: 2 });
    expect(result.state).toBe('file_saved');
    expect(result.digest).not.toBe(s.input.expectedDigest);
  });
  it('should fence DB acknowledgements and recover a lost receipt without reauthorizing expired input', async () => {
    const s = await fixture();
    const c = await createTestContext();
    try {
      const { createMetadataRepository } = await import('../src/storage/metadata-repository.js');
      const { createMetadataWorker } = await import('../src/metadata/worker.js');
      c.sessions.create(proof);
      const actor = String(c.db.connection.prepare('SELECT id_hash FROM sessions').get()!.id_hash);
      c.mediaLinks.create({
        id: 'media',
        libraryId: 'library',
        relativeFileKey: 'source.mp3',
        gonicSongId: 'song',
      });
      let now = 1000;
      const repo = createMetadataRepository({ database: c.db, clock: () => now });
      repo.createOrReplay({
        id: 'job',
        identityKey: '1'.repeat(64),
        libraryId: 'library',
        operationIdHash: '2'.repeat(64),
        requestHash: '3'.repeat(64),
        items: [
          {
            id: s.input.itemId,
            mediaLinkId: 'media',
            fileIdentity: s.input.fileIdentity,
            bindingRevision: 1,
            trackId: 'song',
            expectedRevision: 'initial',
            expectedDigest: s.input.expectedDigest,
            actorSessionId: actor,
            policyRevision: 1,
            patch: { title: { op: 'set', value: 'Changed synthetic' } },
          },
        ],
      });
      const claim = repo.claimNext({ workerId: 'dead-worker', leaseDurationMs: 1000 })!;
      await expect(
        s.store.execute(s.input, {
          onEvent: async (event, control) => {
            if (event.stage === 'backup_verified') {
              repo.recordBackup({ ...claim, backup: event.backup });
              repo.transition({ ...claim, stage: 'backed_up' });
            }
            if (event.stage === 'candidate_verified')
              repo.transition({
                ...claim,
                stage: 'prepared',
                resultDigest: event.digest,
                resultRevision: 'candidate',
                candidateKey: event.candidateKey,
              });
            if (event.stage === 'file_saved') {
              control.kill();
              throw new Error('worker_interrupted');
            }
          },
        }),
      ).rejects.toThrow('worker_interrupted');
      const published = readFileSync(join(s.musicRoot, 'source.mp3'));
      now = 2001;
      let authorized = false;
      const worker = createMetadataWorker({
        repository: repo,
        fileStore: s.store,
        workerId: 'replacement',
        leaseDurationMs: 1000,
        authorize: async () => {
          authorized = true;
          throw new Error('permission_changed');
        },
        revision: (_, value) => value,
      });
      expect(await worker.runOnce()).toBe(true);
      expect(authorized).toBe(false);
      expect(repo.getJob('job', '1'.repeat(64))!.items[0]!.stage).toBe('file_saved');
      expect(readFileSync(join(s.musicRoot, 'source.mp3'))).toEqual(published);
      expect(() => repo.assertClaim(claim)).toThrow('conflict');
    } finally {
      c.cleanup();
    }
  });
  it.each(['candidate_verified', 'file_saved'])(
    'should preserve an external modification and require manual recovery at %s',
    async (cutpoint) => {
      const s = await fixture();
      let reached = false;
      await expect(
        s.store.execute(s.input, {
          onEvent: async (event, control) => {
            if (event.stage === cutpoint) {
              reached = true;
              appendFileSync(join(s.musicRoot, 'source.mp3'), 'external-synthetic-change');
              if (cutpoint === 'file_saved') {
                control.kill();
                throw new Error('worker_interrupted');
              }
            }
          },
        }),
      ).rejects.toThrow();
      expect(reached).toBe(true);
      const bytes = readFileSync(join(s.musicRoot, 'source.mp3'));
      const recovered = await s.store.recover({ ...s.input, generation: 2 });
      expect(recovered.state).toBe('recovery_required');
      expect(readFileSync(join(s.musicRoot, 'source.mp3'))).toEqual(bytes);
    },
  );
  it('should reject read-only and injected disk-full writes before replacing the original', async () => {
    const s = await fixture();
    chmodSync(join(s.musicRoot, 'source.mp3'), 0o400);
    await expect(s.store.execute(s.input, { onEvent: async () => {} })).rejects.toThrow(
      'permission_changed',
    );
    chmodSync(join(s.musicRoot, 'source.mp3'), 0o600);
    const wrapper = join(temp!, 'disk-full.py');
    writeFileSync(
      wrapper,
      `import sys, runpy, errno\nsys.path.insert(0,${JSON.stringify(resolve('apps/api/helpers'))})\nimport file_transaction as t\ndef full(*args):\n    raise OSError(errno.ENOSPC, "synthetic disk full")\nt.copy_fd=full\nimport json\ntry:\n    t.transaction(json.loads(sys.stdin.buffer.readline()))\nexcept OSError:\n    t.emit({"error":"write_failed"})\n`,
    );
    const { createMetadataFileStore } = await import('../src/metadata/file-store.js');
    const failing = createMetadataFileStore({
      python,
      ffmpeg,
      ffprobe,
      musicRoot: s.musicRoot,
      privateRoot: s.privateRoot,
      helperPath: wrapper,
      timeoutMs: 60000,
      maxFileBytes: 10 * 1024 * 1024,
    });
    await expect(failing.execute(s.input, { onEvent: async () => {} })).rejects.toThrow(
      'write_failed',
    );
    expect(readFileSync(join(s.musicRoot, 'source.mp3'))).toEqual(s.original);
  });
  it('should preserve an open stream and backup while publishing and restoring exact bytes', async () => {
    const s = await fixture();
    const fd = openSync(join(s.musicRoot, 'source.mp3'), 'r');
    const events: string[] = [];
    try {
      const saved = await s.store.execute(s.input, {
        onEvent: async (event: { stage: string }) => {
          events.push(event.stage);
        },
      });
      expect(events).toEqual(['backup_verified', 'candidate_verified', 'file_saved']);
      const old = Buffer.alloc(s.original.length);
      readSync(fd, old, 0, old.length, 0);
      expect(old).toEqual(s.original);
      expect(readFileSync(join(s.privateRoot, saved.backup.relativeKey))).toEqual(s.original);
      const changed = readFileSync(join(s.musicRoot, 'source.mp3'));
      expect(digest(changed)).toBe(saved.digest);
      expect(changed).not.toEqual(s.original);
      const restored = await s.store.execute(
        {
          ...s.input,
          itemId: 'restore-item',
          expectedDigest: saved.digest,
          patch: {},
          restore: { relativeKey: saved.backup.relativeKey, digest: s.input.expectedDigest },
        },
        { onEvent: async () => {} },
      );
      expect(restored.digest).toBe(s.input.expectedDigest);
      expect(readFileSync(join(s.musicRoot, 'source.mp3'))).toEqual(s.original);
      expect(readFileSync(join(s.privateRoot, restored.backup.relativeKey))).toEqual(changed);
    } finally {
      closeSync(fd);
    }
  });
  it.each(['backup_verified', 'candidate_verified', 'file_saved'])(
    'should recover conservatively after a parent crash at %s',
    async (cutpoint) => {
      const s = await fixture();
      let reached = false;
      await expect(
        s.store.execute(s.input, {
          onEvent: async (event: { stage: string }, control: { kill(): void }) => {
            if (event.stage === cutpoint) {
              reached = true;
              control.kill();
              throw new Error('worker_interrupted');
            }
          },
        }),
      ).rejects.toThrow();
      expect(reached).toBe(true);
      const result = await s.store.recover({ ...s.input, generation: 2 });
      expect(result.state).toBe(cutpoint === 'file_saved' ? 'file_saved' : 'preimage');
      expect(digest(readFileSync(join(s.musicRoot, 'source.mp3')))).toBe(result.digest);
      if (cutpoint !== 'file_saved') expect(result.digest).toBe(s.input.expectedDigest);
    },
  );
  it('should hold its OS lock across acknowledgements and reject stale input', async () => {
    const s = await fixture();
    let blocked = false;
    await s.store.execute(s.input, {
      onEvent: async (event: { stage: string }) => {
        if (event.stage === 'candidate_verified') {
          await expect(
            s.store.execute(
              { ...s.input, itemId: 'other', generation: 2 },
              { onEvent: async () => {} },
            ),
          ).rejects.toThrow('file_busy');
          blocked = true;
        }
      },
    });
    expect(blocked).toBe(true);
    await expect(
      s.store.execute({ ...s.input, itemId: 'stale' }, { onEvent: async () => {} }),
    ).rejects.toThrow('revision_conflict');
  });
});

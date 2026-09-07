import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createRecentContext } from '../../../tests/support/recent-harness.js';
import { password } from '../../../tests/support/auth-harness.js';
import { createSessionService } from '../src/auth/session-service.js';

let context: Awaited<ReturnType<typeof createTestContext>> | undefined;
let recent: Awaited<ReturnType<typeof createRecentContext>> | undefined;
afterEach(async () => {
  context?.cleanup();
  context = undefined;
  await recent?.cleanup();
  recent = undefined;
});
const python =
  process.env.METADATA_TEST_PYTHON ??
  join(homedir(), '.cache/musiclatte-toolchain/metadata-python/bin/python');
async function makeSUT() {
  context = await createTestContext();
  const root = realpathSync(context.root);
  const musicRoot = join(root, 'music');
  mkdirSync(join(musicRoot, 'Library'), { recursive: true });
  writeFileSync(join(musicRoot, 'Library', 'synthetic.mp3'), 'synthetic-audio', { mode: 0o644 });
  return { ...context, musicRoot };
}
describe('metadata file boundaries', () => {
  /** Deterministic concurrent mutation is detected on both bounded digest attempts. */
  it('should report read_unstable when file bytes change during hashing', async () => {
    const { runProcess } = await import(resolve('apps/api/src/imports/process-runner.ts'));
    const c = await makeSUT();
    const rootStat = statSync(c.musicRoot, { bigint: true });
    const script = `import json, os, runpy, sys
request=json.load(sys.stdin)
module=runpy.run_path(request.pop("helper"))
original=os.read
def changed(fd,size):
    result=original(fd,size)
    if len(result)>1:
        with open(os.path.join(request["root"],request["key"]),"ab") as output:
            output.write(b"x")
    return result
os.read=changed
try:
    module["inspect"](request)
    print("unexpected_success")
except module["FileAccessError"] as error:
    print(str(error))
`;
    const result = await runProcess({
      executable: python,
      args: ['-I', '-B', '-c', script],
      cwd: c.musicRoot,
      allowedCwds: [c.musicRoot],
      stdinText: JSON.stringify({
        helper: resolve('apps/api/helpers/file_access.py'),
        root: c.musicRoot,
        key: 'Library/synthetic.mp3',
        rootIdentity: { device: String(rootStat.dev), inode: String(rootStat.ino) },
        maxFileBytes: 1024,
      }),
      limits: { stdoutBytes: 1000, stderrBytes: 1000, graceMs: 50 },
    });
    expect(result.stdout.trim()).toBe('read_unstable');
  });
  /** Disabled metadata needs no runtime; enabled mode validates private config without importing engine roles. */
  it('should fail closed on missing private metadata runtime configuration', async () => {
    const path = resolve('apps/api/src/metadata/config.ts');
    expect(existsSync(path)).toBe(true);
    const { readMetadataConfig } = await import(path);
    expect(readMetadataConfig({})).toEqual({ enabled: false });
    expect(() => readMetadataConfig({ METADATA_ENABLED: 'yes' })).toThrow(
      'invalid_metadata_config',
    );
    expect(() => readMetadataConfig({ METADATA_ENABLED: 'true' })).toThrow(
      'invalid_metadata_config',
    );
    const c = await makeSUT();
    const policyPath = join(c.root, 'policy.json');
    writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 1,
        enabled: true,
        libraries: [
          {
            id: 'library-1',
            musicFolderId: '0',
            relativeRoot: 'Library',
            editors: ['editor'],
            writeProfile: 'exclusive',
            preserveOwnership: true,
          },
        ],
        restoreManagers: [],
        limits: { maxTargets: 100, maxFileBytes: 1000000, timeoutMs: 5000 },
      }),
      { mode: 0o600 },
    );
    const env = {
      METADATA_ENABLED: 'true',
      METADATA_POLICY_PATH: policyPath,
      METADATA_MUSIC_ROOT: c.musicRoot,
      METADATA_PYTHON: python,
      METADATA_HELPER_PATH: resolve('apps/api/helpers/file_access.py'),
    };
    expect(readMetadataConfig(env)).toMatchObject({
      enabled: true,
      policy: { enabled: true },
      musicRoot: c.musicRoot,
      python,
    });
    expect(() => readMetadataConfig({ ...env, METADATA_MUSIC_ROOT: 'relative' })).toThrow(
      'invalid_metadata_config',
    );
  });
  /** Current-account path resolution links legacy files without fabricating download history. */
  it('should resolve known and legacy tracks and reject revoked or changed account bindings', async () => {
    const path = resolve('apps/api/src/metadata/resolver.ts');
    expect(existsSync(path)).toBe(true);
    const { createMetadataFileResolver } = await import(path);
    const { parseMetadataPolicy } = await import(resolve('apps/api/src/metadata/policy.ts'));
    const { createMetadataFileAccess } = await import(
      resolve('apps/api/src/metadata/file-access.ts')
    );
    recent = await createRecentContext();
    const c = recent;
    const known = c.seed();
    writeFileSync(join(c.musicRoot, 'imports', 'legacy.mp3'), 'synthetic legacy');
    c.songs.push({
      id: 'legacy-track',
      title: 'Synthetic legacy',
      isDir: false,
      path: 'imports/legacy.mp3',
    });
    const sessionService = createSessionService(c.options);
    const token = c.headers.cookie.slice(c.headers.cookie.indexOf('=') + 1);
    const verified = await sessionService.verify(token, 'cookie');
    const policy = parseMetadataPolicy({
      schemaVersion: 1,
      enabled: true,
      libraries: [
        {
          id: 'music',
          musicFolderId: '0',
          relativeRoot: 'imports',
          editors: [password.username],
          writeProfile: 'exclusive',
          preserveOwnership: true,
        },
      ],
      restoreManagers: [],
      limits: { maxTargets: 100, maxFileBytes: 1000000, timeoutMs: 5000 },
    });
    const options = {
      database: c.storage.db,
      clock: () => 1000,
      policy,
      sessionService,
      signingKey: Buffer.alloc(32, 1),
      fileAccess: createMetadataFileAccess({
        python,
        musicRoot: c.musicRoot,
        helperPath: resolve('apps/api/helpers/file_access.py'),
        timeoutMs: 5000,
        maxFileBytes: 1000000,
      }),
      workerReady: () => true,
    };
    const resolver = createMetadataFileResolver(options);
    const existing = await resolver.resolve(verified, 'song-1');
    expect(existing.mediaLinkId).toBe('media-1');
    const legacy = await resolver.resolve(verified, 'legacy-track');
    expect(legacy.editable).toBe(true);
    expect((await resolver.resolve(verified, 'legacy-track')).mediaLinkId).toBe(legacy.mediaLinkId);
    expect(
      c.storage.db.connection.prepare('SELECT count(*) AS count FROM download_events').get(),
    ).toEqual({ count: 1 });
    const before = legacy.fileRevision;
    writeFileSync(join(c.musicRoot, 'imports', 'legacy.mp3'), 'changed synthetic legacy');
    expect((await resolver.resolve(verified, 'legacy-track')).fileRevision).not.toBe(before);
    expect(
      (
        await createMetadataFileResolver({ ...options, workerReady: () => false }).resolve(
          verified,
          'legacy-track',
        )
      ).editable,
    ).toBe(false);
    known.song.path = 'other/song.mp3';
    await expect(resolver.resolve(verified, 'song-1')).rejects.toThrow();
    await expect(resolver.resolve(verified, '../private')).rejects.toThrow();
    await expect(
      createMetadataFileResolver({
        ...options,
        policy: { ...policy, libraries: [{ ...policy.libraries[0], editors: ['other-user'] }] },
      }).resolve(verified, 'legacy-track'),
    ).rejects.toThrow();
    c.storage.sessions.revoke(verified.session.raw);
    await expect(resolver.resolve(verified, 'legacy-track')).rejects.toThrow();
  });
  /** Private helper requests travel on bounded stdin, not command-line arguments or logs. */
  it('should pass a bounded JSON request to the existing process runner', async () => {
    const { runProcess } = await import(resolve('apps/api/src/imports/process-runner.ts'));
    const c = await makeSUT();
    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', "process.stdin.on('data', d => process.stdout.write(d))"],
      cwd: c.musicRoot,
      allowedCwds: [c.musicRoot],
      stdinText: '{"synthetic":true}',
      limits: { stdoutBytes: 100, stderrBytes: 100, graceMs: 50 },
    });
    expect(result.stdout).toBe('{"synthetic":true}');
  });
  /** Real descriptor traversal rejects parent and leaf symlinks while preserving read-only diagnostics. */
  it('should inspect stable files and refuse symlink traversal and replaced roots', async () => {
    const path = resolve('apps/api/src/metadata/file-access.ts');
    expect(existsSync(path)).toBe(true);
    const { createMetadataFileAccess } = await import(path);
    const c = await makeSUT();
    const access = createMetadataFileAccess({
      python,
      musicRoot: c.musicRoot,
      helperPath: resolve('apps/api/helpers/file_access.py'),
      timeoutMs: 5000,
      maxFileBytes: 1024 * 1024,
    });
    const first = await access.inspect('Library/synthetic.mp3');
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.writable).toBe(true);
    expect(first.size).toBe(15);
    for (const key of [
      '../outside',
      '/absolute',
      'Library/../synthetic.mp3',
      'Library//synthetic.mp3',
      'Library\\synthetic.mp3',
    ])
      await expect(access.inspect(key)).rejects.toThrow();
    symlinkSync('synthetic.mp3', join(c.musicRoot, 'Library', 'leaf.mp3'));
    symlinkSync('Library', join(c.musicRoot, 'parent'));
    await expect(access.inspect('Library/leaf.mp3')).rejects.toThrow('file_unavailable');
    await expect(access.inspect('parent/synthetic.mp3')).rejects.toThrow('file_unavailable');
    linkSync(
      join(c.musicRoot, 'Library', 'synthetic.mp3'),
      join(c.musicRoot, 'Library', 'hardlink.mp3'),
    );
    expect((await access.inspect('Library/synthetic.mp3')).writable).toBe(false);
    chmodSync(join(c.musicRoot, 'Library', 'synthetic.mp3'), 0o444);
    expect((await access.inspect('Library/synthetic.mp3')).writable).toBe(false);
    renameSync(c.musicRoot, `${c.musicRoot}-old`);
    mkdirSync(c.musicRoot);
    await expect(access.inspect('Library/synthetic.mp3')).rejects.toThrow('file_unavailable');
  });
  /** File revisions bind the stable signing key, library and bytes, never a login session. */
  it('should keep revisions stable until contents or canonical scope changes', async () => {
    const path = resolve('apps/api/src/metadata/revision.ts');
    expect(existsSync(path)).toBe(true);
    const { createMetadataRevision } = await import(path);
    const revision = createMetadataRevision(Buffer.alloc(32, 1));
    const input = {
      libraryId: 'library-1',
      relativeFileKey: 'Library/synthetic.mp3',
      digest: 'a'.repeat(64),
    };
    expect(revision.fileRevision(input)).toBe(
      createMetadataRevision(Buffer.alloc(32, 1)).fileRevision(input),
    );
    expect(revision.fileRevision(input)).not.toBe(
      revision.fileRevision({ ...input, digest: 'b'.repeat(64) }),
    );
    expect(revision.fileRevision(input)).not.toBe(
      revision.fileRevision({ ...input, libraryId: 'library-2' }),
    );
    expect(() => revision.assertExpected(input, 'stale-revision')).toThrow('revision_conflict');
    expect(() => revision.assertExpected(input, '한'.repeat(64))).toThrow('revision_conflict');
    expect(() => revision.fileRevision({ ...input, relativeFileKey: '../outside' })).toThrow();
  });
  /** Policy is independent of imports/admin status and rejects ambiguous or unsafe writable roots. */
  it('should require explicit editor and restore roles with a verified writable profile', async () => {
    const path = resolve('apps/api/src/metadata/policy.ts');
    expect(existsSync(path)).toBe(true);
    const { parseMetadataPolicy, canEditMetadata, canRestoreMetadata } = await import(path);
    const input = {
      schemaVersion: 1,
      enabled: true,
      libraries: [
        {
          id: 'library-1',
          musicFolderId: 'folder-1',
          relativeRoot: 'Library',
          editors: ['editor'],
          writeProfile: 'exclusive',
          preserveOwnership: true,
        },
      ],
      restoreManagers: ['manager'],
      limits: { maxTargets: 100, maxFileBytes: 1000000, timeoutMs: 5000 },
    };
    const policy = parseMetadataPolicy(input);
    expect(canEditMetadata(policy, 'editor', 'library-1')).toBe(true);
    expect(canEditMetadata(policy, 'manager', 'library-1')).toBe(false);
    expect(
      canRestoreMetadata(
        policy,
        { username: 'manager', adminRole: true, musicFolderIds: ['folder-1'] },
        'library-1',
      ),
    ).toBe(true);
    expect(
      canRestoreMetadata(
        policy,
        { username: 'manager', adminRole: false, musicFolderIds: ['folder-1'] },
        'library-1',
      ),
    ).toBe(false);
    expect(
      canRestoreMetadata(
        policy,
        { username: 'manager', adminRole: true, musicFolderIds: [] },
        'library-1',
      ),
    ).toBe(false);
    for (const extra of [
      {
        libraries: [
          ...input.libraries,
          { ...input.libraries[0], id: 'other', relativeRoot: 'Library/nested' },
        ],
      },
      { libraries: [{ ...input.libraries[0], relativeRoot: '../escape' }] },
      { limits: { ...input.limits, maxTargets: 101 } },
      { unknown: true },
    ])
      expect(() => parseMetadataPolicy({ ...input, ...extra })).toThrow('invalid_metadata_policy');
    expect(
      canEditMetadata(
        parseMetadataPolicy({
          ...input,
          libraries: [{ ...input.libraries[0], writeProfile: 'read_only' }],
        }),
        'editor',
        'library-1',
      ),
    ).toBe(false);
  });
});

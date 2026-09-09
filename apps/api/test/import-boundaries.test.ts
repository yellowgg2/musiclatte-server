import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

const videoId = 'AbCdEf_12-3';
interface Library {
  id: string;
  musicFolderId: string;
  relativeRoot: string;
  allowedUsers: readonly string[];
}
interface Policy {
  enabled: boolean;
  libraries: readonly Library[];
  engineManagers: readonly string[];
}
interface Metadata {
  relativeRoot: string;
  channelName: string;
  channelId: string;
  title: string;
  videoId: string;
}
interface Files {
  buildMediaFileKey: (metadata: Metadata, existingChannels?: readonly string[]) => string;
  prepareMediaFileKey: (root: string, metadata: Metadata) => string;
  resolveFileKey: (root: string, key: string) => string;
  publishMediaFile: (options: {
    musicRoot: string;
    stagingRoot: string;
    stagedFileKey: string;
    fileKey: string;
    videoId: string;
    inspectAudio: (file: FileHandle) => Promise<{ valid: boolean; sourceId: string }>;
  }) => Promise<'published' | 'duplicate_candidate'>;
}
interface PolicyModule {
  loadImportPolicy: (path: string | undefined, enabled: boolean) => Policy;
  resolveLibrary: (policy: Policy, username: string, libraryId: string) => Library;
}
interface ProcessOptions {
  executable: string;
  args: readonly string[];
  cwd: string;
  allowedCwds: readonly string[];
  env?: Record<string, string>;
  signal?: AbortSignal;
  limits: { stdoutBytes: number; stderrBytes: number; graceMs: number };
  jobId?: string;
  itemId?: string;
  logger?: (event: Record<string, string>) => void;
}
interface ProcessModule {
  runProcess: (
    options: ProcessOptions,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: string | null }>;
}
async function makeSUT<T>(name: string): Promise<T> {
  const path = resolve(`apps/api/src/imports/${name}.ts`);
  expect(existsSync(path), `${name} boundary must exist`).toBe(true);
  return import(path);
}
const roots: string[] = [];
function createTestContext() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'musiclatte-boundary-')));
  roots.push(root);
  const musicRoot = join(root, 'music');
  const stagingRoot = join(root, 'staging');
  mkdirSync(musicRoot);
  mkdirSync(stagingRoot);
  const metadata = {
    relativeRoot: 'owner/imports',
    channelName: '채널',
    channelId: 'UC_channel-1',
    title: '노래',
    videoId,
  };
  return { root, musicRoot, stagingRoot, metadata };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('YouTube source boundary', () => {
  /** Accepted individual video spellings collapse to one canonical identity without network I/O. */
  it('should canonicalize watch short and shorts URLs', async () => {
    const { parseYouTubeSource } = await makeSUT<{
      parseYouTubeSource: (input: string) => { videoId: string; canonicalUrl: string };
    }>('source-url');
    for (const input of [
      `https://www.youtube.com/watch?v=${videoId}`,
      `https://music.youtube.com/watch?v=${videoId}`,
      `https://m.youtube.com/watch?v=${videoId}`,
      `https://youtube.com/watch?v=${videoId}`,
      `https://youtu.be/${videoId}`,
      `https://youtube.com/shorts/${videoId}`,
      `https://www.youtube.com/watch?v=${videoId}&t=12s`,
      `https://youtu.be/${videoId}?si=share_token&t=12`,
    ])
      expect(parseYouTubeSource(input)).toEqual({
        videoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      });
  });
  it('should import only the selected video from playlist and radio share links', async () => {
    const { parseYouTubeSource } = await import('../src/imports/source-url.js');
    for (const url of [
      'https://www.youtube.com/watch?v=s3_uirvnSdI&list=RDVf2PhH7d7j0&index=20',
      'https://music.youtube.com/watch?v=s3_uirvnSdI&list=PL123',
      'https://youtu.be/s3_uirvnSdI?list=RD123&index=2',
    ])
      expect(parseYouTubeSource(url)).toEqual({
        videoId: 's3_uirvnSdI',
        canonicalUrl: 'https://www.youtube.com/watch?v=s3_uirvnSdI',
      });
  });
  /** URL parser normalization and extra selectors cannot broaden the downloader target. */
  it('should reject unsafe and ambiguous selectors with a safe error', async () => {
    const { parseYouTubeSource } = await makeSUT<{
      parseYouTubeSource: (input: string) => unknown;
    }>('source-url');
    for (const input of [
      `http://youtu.be/${videoId}`,
      `https://youtu.be:443/${videoId}`,
      `https://user@youtu.be/${videoId}`,
      `https://youtu.be/${videoId}#fragment`,
      `https://youtu.be/${videoId}#`,
      `https://youtu.be/${videoId}/extra`,
      `https://www.youtube.com/watch?v=${videoId}&list=`,
      `https://www.youtube.com/watch?v=${videoId}&list=PL123&index=-1`,
      `https://www.youtube.com/watch?v=${videoId}&list=PL123&list=RD123`,
      `https://www.youtube.com/watch?v=${videoId}&v=${videoId}`,
      `https://www.youtube.com/watch?v=${videoId}&index=2`,
      `https://www.youtube.com/watch?v=${videoId}&url=https://evil.invalid`,
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/results?search_query=a',
      `https://youtube.com.evil.invalid/watch?v=${videoId}`,
      `https://127.0.0.1/watch?v=${videoId}`,
      `https://www.youtube.com/redirect?q=https://youtu.be/${videoId}`,
      `https://youtu.be/../${videoId}`,
      `https://youtu.be/%2e%2e/${videoId}`,
      `https://youtu.be/${videoId}?v=${videoId}`,
      `https://youtu.be/${videoId}?unknown=1`,
      `https://youtu.be/${videoId}?si=x&si=y`,
      `https://youtu.be/${videoId}?t=https://evil.invalid`,
      `https://youtu.be/${videoId}?si=%0a`,
      ` https://youtu.be/${videoId}`,
      `https://youtu.be/${videoId}\n`,
      `https://youtu.be\\${videoId}`,
      'https://youtu.be/short',
      'https://youtu.be/AbCdEf_12-!',
      `https://youtu.be/%41bCdEf_12-3`,
    ])
      expect(() => parseYouTubeSource(input), input).toThrow('invalid_source');
  });
});

describe('import account policy', () => {
  function policyFixture() {
    return {
      schemaVersion: 1,
      libraries: [
        {
          id: 'library-1',
          musicFolderId: '1',
          relativeRoot: 'owner/imports',
          allowedUsers: ['alice'],
        },
      ],
      engineManagers: ['operator'],
    };
  }
  /** Disabled imports need no policy file and every enabled lookup is deny-by-default and immutable. */
  it('should load an immutable policy and enforce account membership', async () => {
    const sut = await makeSUT<PolicyModule>('policy');
    const { root } = createTestContext();
    const path = join(root, 'policy.json');
    expect(sut.loadImportPolicy(undefined, false)).toEqual({
      enabled: false,
      libraries: [],
      engineManagers: [],
    });
    writeFileSync(path, JSON.stringify(policyFixture()));
    const policy = sut.loadImportPolicy(path, true);
    expect(sut.resolveLibrary(policy, 'alice', 'library-1')).toMatchObject({
      musicFolderId: '1',
      relativeRoot: 'owner/imports',
    });
    for (const [user, id] of [
      ['bob', 'library-1'],
      ['Alice', 'library-1'],
      ['alice', 'missing'],
    ])
      expect(() => sut.resolveLibrary(policy, user!, id!)).toThrow('library_denied');
    expect(() =>
      sut.resolveLibrary(sut.loadImportPolicy(undefined, false), 'alice', 'library-1'),
    ).toThrow('library_denied');
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.libraries)).toBe(true);
    expect(Object.isFrozen(policy.libraries[0])).toBe(true);
    expect(Object.isFrozen(policy.libraries[0]?.allowedUsers)).toBe(true);
    expect(Object.isFrozen(policy.engineManagers)).toBe(true);
  });
  /** Unknown fields, duplicate principals, root overlap and path normalization are rejected before use. */
  it('should reject malformed policies without leaking file or input details', async () => {
    const sut = await makeSUT<PolicyModule>('policy');
    const { root } = createTestContext();
    const path = join(root, 'policy.json');
    const valid = policyFixture();
    const library = valid.libraries[0]!;
    const invalid: unknown[] = [
      null,
      [],
      {},
      { ...valid, schemaVersion: 2 },
      { ...valid, extra: 'secret' },
      { ...valid, engineManagers: ['x', 'x'] },
      { ...valid, engineManagers: [''] },
      { ...valid, libraries: [{ ...library, extra: true }] },
      { ...valid, libraries: [library, library] },
      { ...valid, libraries: [{ ...library, allowedUsers: ['alice', 'alice'] }] },
      { ...valid, libraries: [{ ...library, allowedUsers: [' alice'] }] },
      ...[
        '',
        '/',
        '.',
        '..',
        '/absolute',
        'a/../b',
        'a//b',
        'a/./b',
        'a/',
        'C:\\root',
        'a\\b',
        'a\u0000b',
      ].map((relativeRoot) => ({ ...valid, libraries: [{ ...library, relativeRoot }] })),
      ...['owner/imports/nested', 'owner', 'OWNER/IMPORTS'].map((relativeRoot) => ({
        ...valid,
        libraries: [library, { ...library, id: 'library-2', relativeRoot }],
      })),
    ];
    for (const value of invalid) {
      writeFileSync(path, JSON.stringify(value));
      expect(() => sut.loadImportPolicy(path, true)).toThrow('invalid_import_policy');
    }
    writeFileSync(path, '{broken');
    expect(() => sut.loadImportPolicy(path, true)).toThrow('invalid_import_policy');
    expect(() => sut.loadImportPolicy(undefined, true)).toThrow('invalid_import_policy');
    // Segment siblings do not overlap; a principal may intentionally access multiple libraries.
    writeFileSync(
      path,
      JSON.stringify({
        ...valid,
        libraries: [library, { ...library, id: 'library-2', relativeRoot: 'owner/imports-other' }],
      }),
    );
    expect(sut.loadImportPolicy(path, true).libraries).toHaveLength(2);
  });
});

describe('media file boundary', () => {
  /** Stable IDs disambiguate display collisions and reuse the existing channel after a rename. */
  it('should sanitize bounded Unicode filenames and reuse channel IDs without renaming legacy files', async () => {
    const sut = await makeSUT<Files>('file-keys');
    const ctx = createTestContext();
    const key = sut.prepareMediaFileKey(ctx.musicRoot, ctx.metadata);
    expect(key).toBe(`owner/imports/채널 [UC_channel-1]/노래 [${videoId}].mp3`);
    const renamed = sut.prepareMediaFileKey(ctx.musicRoot, {
      ...ctx.metadata,
      channelName: '새 이름',
    });
    expect(renamed).toBe(key);
    const weird = sut.buildMediaFileKey({
      ...ctx.metadata,
      title: 'CON',
      channelName: '../aux:*?<>|\\',
    });
    expect(weird).not.toMatch(/[\\:*?<>|]/);
    expect(weird).toContain(`CON_ [${videoId}].mp3`);
    const long = sut.buildMediaFileKey({ ...ctx.metadata, title: '🎼한'.repeat(300) });
    expect(long.split('/').every((segment) => Buffer.byteLength(segment) <= 255)).toBe(true);
    expect(sut.buildMediaFileKey({ ...ctx.metadata, title: 'Cafe\u0301' })).toContain('Café');
    expect(sut.buildMediaFileKey({ ...ctx.metadata, videoId: 'ZbCdEf_12-3' })).not.toBe(key);
    expect(() => sut.buildMediaFileKey({ ...ctx.metadata, channelId: '../../escape' })).toThrow(
      'invalid_file_key',
    );
    writeFileSync(join(dirname(sut.resolveFileKey(ctx.musicRoot, key)), 'legacy.mp3'), 'legacy');
    sut.prepareMediaFileKey(ctx.musicRoot, ctx.metadata);
    expect(
      readFileSync(join(dirname(sut.resolveFileKey(ctx.musicRoot, key)), 'legacy.mp3'), 'utf8'),
    ).toBe('legacy');
  });
  /** Existing symlinks, path aliases and ambiguous stable-ID folders fail closed. */
  it('should reject root and component escapes and non-directory parents', async () => {
    const sut = await makeSUT<Files>('file-keys');
    const ctx = createTestContext();
    for (const key of ['../escape', '/escape', 'a/../b', 'a//b', 'a\\b', 'C:/escape', './a'])
      expect(() => sut.resolveFileKey(ctx.musicRoot, key)).toThrow('invalid_file_key');
    symlinkSync(ctx.stagingRoot, join(ctx.musicRoot, 'outside'));
    expect(() => sut.resolveFileKey(ctx.musicRoot, 'outside/song.mp3')).toThrow('invalid_file_key');
    symlinkSync(ctx.musicRoot, join(ctx.root, 'root-alias'));
    expect(() => sut.resolveFileKey(join(ctx.root, 'root-alias'), 'song.mp3')).toThrow(
      'invalid_file_key',
    );
    mkdirSync(join(ctx.musicRoot, 'nested'));
    expect(() => sut.resolveFileKey(join(ctx.root, 'root-alias', 'nested'), 'song.mp3')).toThrow(
      'invalid_file_key',
    );
    writeFileSync(join(ctx.musicRoot, 'file'), 'x');
    expect(() => sut.resolveFileKey(ctx.musicRoot, 'file/song.mp3')).toThrow('invalid_file_key');
    const key = sut.prepareMediaFileKey(ctx.musicRoot, ctx.metadata);
    const target = sut.resolveFileKey(ctx.musicRoot, key);
    symlinkSync(join(ctx.stagingRoot, 'absent'), target);
    expect(() => sut.resolveFileKey(ctx.musicRoot, key)).toThrow('invalid_file_key');
    mkdirSync(join(ctx.musicRoot, 'owner/imports/second [UC_channel-1]'));
    expect(() => sut.prepareMediaFileKey(ctx.musicRoot, ctx.metadata)).toThrow('file_conflict');
  });
  async function publicationContext() {
    const sut = await makeSUT<Files>('file-keys');
    const ctx = createTestContext();
    const fileKey = sut.prepareMediaFileKey(ctx.musicRoot, ctx.metadata);
    const stagedFileKey = 'result.mp3';
    writeFileSync(join(ctx.stagingRoot, stagedFileKey), `synthetic-audio:${videoId}`);
    const inspectAudio = async (file: FileHandle) => {
      const text = await file.readFile('utf8');
      return { valid: text.startsWith('synthetic-audio:'), sourceId: text.split(':')[1] ?? '' };
    };
    return { sut, ctx, options: { ...ctx, fileKey, stagedFileKey, videoId, inspectAudio } };
  }
  /** Durable publication leaves one complete file, cleans pending names and only accepts verified same-source duplicates. */
  it('should publish without overwrite and distinguish duplicates from conflicts', async () => {
    const { sut, ctx, options } = await publicationContext();
    expect(await sut.publishMediaFile(options)).toBe('published');
    const target = sut.resolveFileKey(ctx.musicRoot, options.fileKey);
    const original = readFileSync(target);
    expect(await sut.publishMediaFile(options)).toBe('duplicate_candidate');
    expect(readFileSync(target)).toEqual(original);
    expect(readdirSync(dirname(target)).some((name) => name.endsWith('.pending'))).toBe(false);
    writeFileSync(target, 'synthetic-audio:ZbCdEf_12-3');
    await expect(sut.publishMediaFile(options)).rejects.toThrow('file_conflict');
    expect(readFileSync(target, 'utf8')).toBe('synthetic-audio:ZbCdEf_12-3');
    writeFileSync(target, 'invalid');
    await expect(sut.publishMediaFile(options)).rejects.toThrow('file_conflict');
  });
  /** Rechecking the open parent prevents an async verifier from redirecting publication through a symlink. */
  it('should reject a replaced parent and redact verifier errors', async () => {
    const { sut, ctx, options } = await publicationContext();
    await expect(
      sut.publishMediaFile({
        ...options,
        inspectAudio: async () => {
          throw new Error('private-path-and-metadata');
        },
      }),
    ).rejects.toThrow(/^publish_failed$/);
    const parent = dirname(sut.resolveFileKey(ctx.musicRoot, options.fileKey));
    await expect(
      sut.publishMediaFile({
        ...options,
        inspectAudio: async (file) => {
          const result = await options.inspectAudio(file);
          renameSync(parent, `${parent}-moved`);
          symlinkSync(ctx.stagingRoot, parent);
          return result;
        },
      }),
    ).rejects.toThrow('invalid_file_key');
    expect(readdirSync(ctx.stagingRoot)).toEqual(['result.mp3']);
    expect(readdirSync(`${parent}-moved`)).toEqual([]);
  });
  /** Simultaneous publishers cannot replace the winner or leave partial audio behind. */
  it('should resolve concurrent publication to one complete target', async () => {
    const { sut, ctx, options } = await publicationContext();
    const results = await Promise.all([
      sut.publishMediaFile(options),
      sut.publishMediaFile(options),
    ]);
    expect(results.sort()).toEqual(['duplicate_candidate', 'published']);
    expect(readFileSync(sut.resolveFileKey(ctx.musicRoot, options.fileKey), 'utf8')).toBe(
      `synthetic-audio:${videoId}`,
    );
  });
  /** Staging must be outside scan roots and validation failure must not create a target. */
  it('should reject scan-root staging, symlink payloads and invalid audio', async () => {
    const { sut, ctx, options } = await publicationContext();
    await expect(sut.publishMediaFile({ ...options, stagingRoot: ctx.musicRoot })).rejects.toThrow(
      'invalid_file_key',
    );
    await expect(
      sut.publishMediaFile({
        ...options,
        stagingRoot: ctx.root,
        stagedFileKey: 'staging/result.mp3',
      }),
    ).rejects.toThrow('invalid_file_key');
    writeFileSync(join(ctx.stagingRoot, options.stagedFileKey), 'invalid');
    await expect(sut.publishMediaFile(options)).rejects.toThrow('invalid_media');
    expect(existsSync(sut.resolveFileKey(ctx.musicRoot, options.fileKey))).toBe(false);
    symlinkSync(join(ctx.stagingRoot, options.stagedFileKey), join(ctx.stagingRoot, 'alias.mp3'));
    await expect(sut.publishMediaFile({ ...options, stagedFileKey: 'alias.mp3' })).rejects.toThrow(
      'invalid_file_key',
    );
  });
});

describe('bounded no-shell process runner', () => {
  function processOptions(root: string, args: readonly string[]): ProcessOptions {
    return {
      executable: process.execPath,
      args,
      cwd: root,
      allowedCwds: [root],
      limits: { stdoutBytes: 4096, stderrBytes: 4096, graceMs: 60 },
    };
  }
  /** Shell metacharacters remain literal argv and ambient credentials are not inherited. */
  it('should preserve argv literals and return bounded output and exit status', async () => {
    const { runProcess } = await makeSUT<ProcessModule>('process-runner');
    const { root } = createTestContext();
    const literals = [
      '`touch marker`',
      '$(touch marker)',
      '; touch marker',
      '\ntouch marker',
      '한글',
    ];
    const events: Record<string, string>[] = [];
    const result = await runProcess({
      ...processOptions(root, [
        '-e',
        'console.log(JSON.stringify(process.argv.slice(1))); console.error("private-stderr"); process.exitCode=7',
        ...literals,
      ]),
      logger: (event) => events.push(event),
    });
    expect(JSON.parse(result.stdout)).toEqual(literals);
    expect(result.stderr.trim()).toBe('private-stderr');
    expect(result.exitCode).toBe(7);
    expect(existsSync(join(root, 'marker'))).toBe(false);
    expect(JSON.stringify(events)).not.toContain('private-stderr');
    expect(
      events.every((event) =>
        Object.keys(event).every((key) =>
          ['stage', 'failureCode', 'jobId', 'itemId'].includes(key),
        ),
      ),
    ).toBe(true);
    const env = await runProcess({
      ...processOptions(root, ['-e', 'console.log(JSON.stringify(process.env))']),
      env: { LANG: 'C' },
    });
    expect(JSON.parse(env.stdout)).toMatchObject({ LANG: 'C' });
    for (const key of ['HOME', 'PATH', 'NODE_OPTIONS', 'IMPORT_WORKER_PASSWORD'])
      expect(JSON.parse(env.stdout)).not.toHaveProperty(key);
    await expect(
      runProcess({ ...processOptions(root, []), env: { NODE_OPTIONS: '--inspect' } }),
    ).rejects.toThrow('invalid_process');
    await expect(runProcess({ ...processOptions(root, []), allowedCwds: [] })).rejects.toThrow(
      'invalid_process',
    );
  });
  /** Limits are byte based per stream and failures never carry raw output or executable paths. */
  it('should abort output overflow and redact spawn failures', async () => {
    const { runProcess } = await makeSUT<ProcessModule>('process-runner');
    const { root } = createTestContext();
    for (const stream of ['stdout', 'stderr'])
      await expect(
        runProcess(
          processOptions(root, [
            '-e',
            `process.${stream}.write('한'.repeat(4096)); setInterval(()=>{},1000)`,
          ]),
        ),
      ).rejects.toThrow('process_output_limit');
    await expect(
      runProcess({ ...processOptions(root, []), executable: join(root, 'private-missing') }),
    ).rejects.toThrow(/^process_spawn_failed$/);
    const abort = new AbortController();
    abort.abort('private reason');
    await expect(runProcess({ ...processOptions(root, []), signal: abort.signal })).rejects.toThrow(
      /^process_aborted$/,
    );
  });
  /** A leader cannot report success while an inherited process group continues running. */
  it('should clean descendants after an early leader exit', async () => {
    const { runProcess } = await makeSUT<ProcessModule>('process-runner');
    const { root } = createTestContext();
    const childScript =
      "require('node:fs').writeFileSync('orphan-pid',String(process.pid)); setInterval(()=>{},1000)";
    const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'});child.unref();setTimeout(()=>process.exit(0),100);`;
    try {
      await expect(runProcess(processOptions(root, ['-e', script]))).rejects.toThrow(
        'process_cleanup_failed',
      );
      const pid = Number(readFileSync(join(root, 'orphan-pid'), 'utf8'));
      await expect
        .poll(
          () => {
            try {
              process.kill(pid, 0);
              return false;
            } catch {
              return true;
            }
          },
          { timeout: 3000 },
        )
        .toBe(true);
    } finally {
      if (existsSync(join(root, 'orphan-pid'))) {
        try {
          process.kill(Number(readFileSync(join(root, 'orphan-pid'), 'utf8')), 'SIGKILL');
        } catch {
          /* already stopped */
        }
      }
    }
  });
  /** Group cancellation handles both graceful exit and TERM-resistant descendants before settling. */
  it('should terminate the process group after abort including stubborn children', async () => {
    const { runProcess } = await makeSUT<ProcessModule>('process-runner');
    const { root } = createTestContext();
    for (const stubborn of [false, true]) {
      const abort = new AbortController();
      const childScript = `${stubborn ? "process.on('SIGTERM',()=>{});" : ''}require('node:fs').writeFileSync('ready-child',String(process.pid));setInterval(()=>{},1000)`;
      const script = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'inherit'});setInterval(()=>{},1000);`;
      const result = runProcess({ ...processOptions(root, ['-e', script]), signal: abort.signal });
      const checked = expect(result).rejects.toThrow('process_aborted');
      try {
        await expect
          .poll(() => existsSync(join(root, 'ready-child')), { timeout: 3000 })
          .toBe(true);
      } finally {
        abort.abort();
        await checked;
      }
      const childPid = Number(readFileSync(join(root, 'ready-child'), 'utf8'));
      await expect
        .poll(
          () => {
            try {
              process.kill(childPid, 0);
              return false;
            } catch {
              return true;
            }
          },
          { timeout: 3000 },
        )
        .toBe(true);
      rmSync(join(root, 'ready-child'));
    }
  });
});

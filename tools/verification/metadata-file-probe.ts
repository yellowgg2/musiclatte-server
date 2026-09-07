import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createMetadataFixture } from '../../packages/test-support/src/metadata-fixtures.js';
import { createMetadataFileStore } from '../../apps/api/src/metadata/file-store.js';
const path = process.argv[process.argv.indexOf('--config') + 1];
if (!path || !isAbsolute(path)) throw new Error('private_config_required');
const config = JSON.parse(readFileSync(path, 'utf8')) as {
  musicRoot: string;
  privateRoot: string;
  python: string;
  ffmpeg: string;
  ffprobe: string;
  helperPath: string;
};
if (process.platform !== 'linux') throw new Error('linux_probe_required');
for (const root of [config.musicRoot, config.privateRoot]) {
  if (
    !isAbsolute(root) ||
    realpathSync(root) !== root ||
    readdirSync(root).length ||
    !root.includes('musiclatte-p4-')
  )
    throw new Error('empty_owned_probe_directory_required');
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const requireResult = (condition: boolean) => {
  if (!condition) throw new Error('probe_failed');
};
const version = (tool: string, args: string[]) =>
  execFileSync(tool, args, { encoding: 'utf8', timeout: 10000 }).split('\n')[0];
let evidence: string | undefined;
try {
  await createMetadataFixture({
    root: config.musicRoot,
    python: config.python,
    ffmpeg: config.ffmpeg,
    version: 4,
  });
  const original = readFileSync(join(config.musicRoot, 'source.mp3'));
  const store = createMetadataFileStore({
    ...config,
    timeoutMs: 60000,
    maxFileBytes: 10 * 1024 * 1024,
  });
  const input = {
    itemId: 'probe-edit',
    fileIdentity: 'a'.repeat(64),
    key: 'source.mp3',
    generation: 1,
    expectedDigest: hash(original),
    patch: { title: { op: 'set', value: 'Synthetic Linux probe' } },
    preserveOwnership: true,
  };
  const fd = openSync(join(config.musicRoot, 'source.mp3'), 'r');
  let saved;
  try {
    saved = await store.execute(input, { onEvent: async () => {} });
    const held = Buffer.alloc(original.length);
    readSync(fd, held, 0, held.length, 0);
    requireResult(held.equals(original));
  } finally {
    closeSync(fd);
  }
  requireResult(hash(readFileSync(join(config.musicRoot, 'source.mp3'))) === saved.digest);
  requireResult(readFileSync(join(config.privateRoot, saved.backup.relativeKey)).equals(original));
  const restored = await store.execute(
    {
      ...input,
      itemId: 'probe-restore',
      expectedDigest: saved.digest,
      patch: {},
      restore: { relativeKey: saved.backup.relativeKey, digest: input.expectedDigest },
    },
    { onEvent: async () => {} },
  );
  requireResult(restored.digest === input.expectedDigest);
  requireResult(readFileSync(join(config.musicRoot, 'source.mp3')).equals(original));
  const crashInput = { ...input, itemId: 'probe-crash' };
  let killed = false;
  try {
    await store.execute(crashInput, {
      onEvent: async (event, control) => {
        if (event.stage === 'file_saved') {
          killed = true;
          control.kill();
          throw new Error('worker_interrupted');
        }
      },
    });
    throw new Error('crash_not_observed');
  } catch {
    requireResult(killed);
  }
  const recovered = await store.recover({ ...crashInput, generation: 2 });
  requireResult(recovered.state === 'file_saved');
  requireResult(recovered.digest === hash(readFileSync(join(config.musicRoot, 'source.mp3'))));
  evidence = JSON.stringify({
    result: 'passed',
    node: process.version,
    python: version(config.python, ['--version']),
    ffmpeg: version(config.ffmpeg, ['-version']),
    ffprobe: version(config.ffprobe, ['-version']),
    filesystem: execFileSync('stat', ['-f', '-c', '%T', config.musicRoot], {
      encoding: 'utf8',
    }).trim(),
    checks: [
      'open-stream-preserved',
      'new-stream-changed',
      'backup-exact',
      'restore-exact',
      'restart-receipt',
    ],
    cleanup: 'owned-files-removed; empty mount roots retained',
  });
} finally {
  for (const root of [config.musicRoot, config.privateRoot]) {
    for (const name of readdirSync(root)) rmSync(join(root, name), { recursive: true });
  }
}
console.log(evidence);

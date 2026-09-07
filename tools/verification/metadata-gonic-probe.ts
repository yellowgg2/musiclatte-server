import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createMetadataFixture } from '../../packages/test-support/src/metadata-fixtures.js';
import { createMetadataHelper } from '../../apps/api/src/metadata/helper-client.js';
import { createMetadataFileStore } from '../../apps/api/src/metadata/file-store.js';
import { createSubsonicClient } from '../../apps/api/src/subsonic/client.js';
import { createExactPathLookup } from '../../apps/api/src/subsonic/exact-path-lookup.js';
import {
  captureMetadataReferences,
  compareMetadataReferences,
} from '../../apps/api/src/metadata/reference-check.js';
import { compareMetadataProjection } from '../../apps/api/src/metadata/reflection.js';
const configPath = process.argv[process.argv.indexOf('--config') + 1];
if (!configPath || !isAbsolute(configPath)) throw new Error('private_config_required');
const c = JSON.parse(readFileSync(configPath, 'utf8')) as {
  upstream: string;
  proof: { username: string; t: string; s: string };
  musicRoot: string;
  privateRoot: string;
  python: string;
  ffmpeg: string;
  ffprobe: string;
  helperDirectory: string;
};
if (process.platform !== 'linux') throw new Error('linux_probe_required');
for (const root of [c.musicRoot, c.privateRoot])
  if (!isAbsolute(root) || !root.includes('musiclatte-p4-') || readdirSync(root).length)
    throw new Error('empty_owned_probe_directory_required');
const client = createSubsonicClient({ upstream: c.upstream, proof: c.proof, timeoutMs: 10000 });
const toolOptions = {
  python: c.python,
  ffmpeg: c.ffmpeg,
  ffprobe: c.ffprobe,
  musicRoot: c.musicRoot,
  privateRoot: c.privateRoot,
  timeoutMs: 60000,
  maxFileBytes: 10 * 1024 * 1024,
};
const helper = createMetadataHelper({
  ...toolOptions,
  helperPath: join(c.helperDirectory, 'metadata.py'),
});
const store = createMetadataFileStore({
  ...toolOptions,
  helperPath: join(c.helperDirectory, 'file_transaction.py'),
});
const check = (ok: boolean, stage: string) => {
  if (!ok) throw new Error(`probe_failed:${stage}`);
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const signal = AbortSignal.timeout(180000);
const library = { relativeRoot: 'channel', musicFolderId: '0' };
async function scan() {
  await client.startScan({ signal });
  await delay(200);
  for (let i = 0; i < 100; i++) {
    if (!(await client.getScanStatus({ signal })).scanning) return;
    await delay(100);
  }
  throw new Error('scan_timeout');
}
async function idFor(key: string) {
  return createExactPathLookup(client, { signal, assertOwned: () => signal.throwIfAborted() })(
    library,
    key,
  );
}
async function pixels(bytes: Buffer) {
  const key = join(c.privateRoot, 'cover-observation');
  writeFileSync(key, bytes, { mode: 0o600 });
  try {
    return execFileSync(
      c.ffmpeg,
      [
        '-v',
        'error',
        '-nostdin',
        '-i',
        key,
        '-vf',
        'scale=1:1',
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-',
      ],
      { maxBuffer: 1024, timeout: 10000 },
    );
  } finally {
    rmSync(key);
  }
}
async function coverEquals(id: string, expected: Buffer, size = 16) {
  const response = await fetch(client.mediaRequest('getCoverArt', id, { size, signal }));
  if (!response.ok) return false;
  const actual = await pixels(Buffer.from(await response.arrayBuffer()));
  const wanted = await pixels(expected);
  return (
    actual.length === 3 &&
    wanted.length === 3 &&
    actual.every((value, i) => Math.abs(value - wanted[i]!) <= 4)
  );
}
let playlistId: string | undefined;
let songId: string | undefined;
let evidence: unknown;
try {
  const channel = join(c.musicRoot, 'channel');
  mkdirSync(channel);
  await createMetadataFixture({
    root: channel,
    python: c.python,
    ffmpeg: c.ffmpeg,
    version: 4,
    durationSeconds: 150,
  });
  // A single artwork choice makes the ordinary profile deterministic; S03 separately retains other APIC.
  execFileSync(
    c.python,
    [
      '-I',
      '-B',
      '-c',
      'import sys\nfrom mutagen.id3 import ID3\np=sys.stdin.read()\nt=ID3(p,translate=False);t.delall("APIC:back");t.save(p,v2_version=4,v23_sep=None)',
    ],
    { input: join(channel, 'source.mp3') },
  );
  copyFileSync(join(channel, 'source.mp3'), join(channel, 'zz-second.mp3'));
  // Raster fixture inputs must not become folder cover files.
  for (const name of ['old.png', 'new.png', 'new.jpg']) {
    copyFileSync(join(channel, name), join(c.privateRoot, name));
    rmSync(join(channel, name));
  }
  copyFileSync(
    join(channel, 'source.mp3'),
    join(channel, '.musiclatte-synthetic.metadata-pending'),
  );
  await scan();
  songId = await idFor('channel/source.mp3');
  const secondId = await idFor('channel/zz-second.mp3');
  const directoryId = (await client.getSong(songId)).parent!;
  check(
    (await client.registrationDirectory(directoryId)).child.filter((x) => !x.isDir).length === 2,
    'pending-excluded',
  );
  const playlist = await client.createPlaylist({
    name: 'Musiclatte synthetic metadata probe',
    songIds: [songId, secondId, songId],
  });
  playlistId = playlist.id;
  await client.starSong(songId);
  const references = await captureMetadataReferences(client, songId);
  const original = readFileSync(join(channel, 'source.mp3'));
  const before = await helper.read({ key: 'channel/source.mp3' });
  const oldSong = await client.getSong(songId);
  const oldCover = oldSong.coverArt!;
  check(await coverEquals(oldCover, readFileSync(join(c.privateRoot, 'old.png'))), 'initial-cover');
  const response = await fetch(client.mediaRequest('stream', songId, { signal }));
  check(response.ok && !!response.body, 'open-stream');
  const reader = response.body!.getReader();
  const first = await reader.read();
  const oldChunks: Buffer[] = [Buffer.from(first.value!)];
  const saved = await store.execute(
    {
      itemId: 'probe-change',
      fileIdentity: 'a'.repeat(64),
      key: 'channel/source.mp3',
      generation: 1,
      expectedDigest: before.fullDigest,
      preserveOwnership: true,
      patch: {
        title: { op: 'set', value: 'Synthetic updated title' },
        artist: { op: 'set', value: ['Synthetic updated artist'] },
        album: { op: 'set', value: 'Synthetic updated album' },
        lyrics: {
          op: 'set',
          selector: { language: 'eng', description: '' },
          text: 'An original new synthetic line.',
        },
        cover: {
          op: 'set',
          selector: { kind: 'front', description: 'front' },
          uploadId: 'synthetic',
        },
      },
      cover: {
        root: c.privateRoot,
        key: 'new.png',
        rootIdentity: {
          device: String((await import('node:fs')).statSync(c.privateRoot, { bigint: true }).dev),
          inode: String((await import('node:fs')).statSync(c.privateRoot, { bigint: true }).ino),
        },
      },
    },
    { onEvent: async () => {} },
  );
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    oldChunks.push(Buffer.from(next.value));
  }
  check(Buffer.concat(oldChunks).equals(original), 'held-stream-exact');
  await scan();
  check((await idFor('channel/source.mp3')) === songId, 'stable-id');
  const updated = await client.getSong(songId);
  const updatedSnapshot = await helper.read({ key: 'channel/source.mp3' });
  const coverMatched = await coverEquals(
    updated.coverArt!,
    readFileSync(join(c.privateRoot, 'new.png')),
  );
  const projection = compareMetadataProjection(updatedSnapshot, updated, {
    filename: 'source.mp3',
    coverMatches: coverMatched,
  });
  check(
    projection.status === 'reflection_mismatch' && projection.mismatched.join(',') === 'cover',
    'warmed-cover-mismatch-only',
  );
  // A fresh size diagnoses the upstream source; production must still report the warmed-size mismatch.
  check(
    await coverEquals(updated.coverArt!, readFileSync(join(c.privateRoot, 'new.png')), 15),
    'uncached-cover-source',
  );
  check(
    (await client.search('Synthetic updated title')).song.some((x) => x.id === songId),
    'search',
  );
  check(
    compareMetadataReferences(references, await captureMetadataReferences(client, songId)),
    'references',
  );
  const current = readFileSync(join(channel, 'source.mp3'));
  const newStream = await fetch(client.mediaRequest('stream', songId, { signal }));
  check(Buffer.from(await newStream.arrayBuffer()).equals(current), 'new-stream');
  const range = await fetch(
    client.mediaRequest('stream', songId, { signal, range: 'bytes=256-511' }),
  );
  check(
    range.status === 206 &&
      Buffer.from(await range.arrayBuffer()).equals(current.subarray(256, 512)),
    'range',
  );
  const conditional = client.mediaRequest('stream', songId, { signal, range: 'bytes=256-511' });
  conditional.headers.set('If-Range', response.headers.get('Last-Modified')!);
  const ifRange = await fetch(conditional);
  check(ifRange.status === 200, 'old-if-range');
  await ifRange.body?.cancel();
  const secondProjection = compareMetadataProjection(
    await helper.read({ key: 'channel/zz-second.mp3' }),
    await client.getSong(secondId),
    { filename: 'zz-second.mp3', coverMatches: true },
  );
  check(secondProjection.status === 'reflection_mismatch', 'mixed-album-mismatch');
  const restored = await store.execute(
    {
      itemId: 'probe-restore',
      fileIdentity: 'a'.repeat(64),
      key: 'channel/source.mp3',
      generation: 1,
      expectedDigest: saved.digest,
      preserveOwnership: true,
      patch: {},
      restore: { relativeKey: saved.backup.relativeKey, digest: before.fullDigest },
    },
    { onEvent: async () => {} },
  );
  check(restored.digest === before.fullDigest, 'restore-bytes');
  await scan();
  check((await idFor('channel/source.mp3')) === songId, 'restore-id');
  check(
    compareMetadataReferences(references, await captureMetadataReferences(client, songId)),
    'restore-references',
  );
  const restoreSong = await client.getSong(songId);
  check(
    await coverEquals(restoreSong.coverArt!, readFileSync(join(c.privateRoot, 'old.png'))),
    'restore-cover',
  );
  const restoreStream = await fetch(client.mediaRequest('stream', songId, { signal }));
  check(
    hash(Buffer.from(await restoreStream.arrayBuffer())) === before.fullDigest,
    'restore-stream',
  );
  evidence = {
    result: 'passed',
    subsonicProtocol: (await client.ping()).version,
    checks: [
      'pending-excluded',
      'ordinary-index-projection',
      'warmed-cover-mismatch-only',
      'uncached-cover-source',
      'stable-id',
      'ordered-duplicate-playlist',
      'star',
      'mixed-album-mismatch',
      'held-stream',
      'new-stream',
      'range',
      'if-range',
      'exact-restore',
      'restored-cover',
      'restored-references',
    ],
  };
} finally {
  if (playlistId) await client.deletePlaylist(playlistId);
  if (songId) await client.unstarSong(songId);
  for (const root of [c.musicRoot, c.privateRoot])
    for (const name of readdirSync(root)) rmSync(join(root, name), { recursive: true });
}
console.log(JSON.stringify(evidence));

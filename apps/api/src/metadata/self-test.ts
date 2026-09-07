import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runProcess } from '../imports/process-runner.js';
import { createMetadataHelper } from './helper-client.js';
import { compareCoverProjection } from './cover-verifier.js';

export async function metadataSelfTest(
  options: {
    privateRoot: string;
    python: string;
    helperPath: string;
    ffmpeg: string;
    ffprobe: string;
    projector: string;
  },
  signal: AbortSignal,
) {
  const root = mkdtempSync(join(options.privateRoot, '.self-test-'));
  const run = (executable: string, args: string[]) =>
    runProcess({
      executable,
      args,
      cwd: root,
      allowedCwds: [root],
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      limits: { stdoutBytes: 4096, stderrBytes: 4096, graceMs: 100 },
    });
  try {
    const python = await run(options.python, ['--version']);
    const ffmpeg = await run(options.ffmpeg, ['-version']);
    const ffprobe = await run(options.ffprobe, ['-version']);
    if (
      !/^Python 3\.11\./.test(python.stdout) ||
      !/^ffmpeg version 5\.1\.9(?:-|\s)/.test(ffmpeg.stdout) ||
      !/^ffprobe version 5\.1\.9(?:-|\s)/.test(ffprobe.stdout)
    )
      throw new Error('unsupported_metadata_profile');
    const created = await run(options.ffmpeg, [
      '-v',
      'error',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-t',
      '0.12',
      '-c:a',
      'libmp3lame',
      '-map_metadata',
      '-1',
      '-id3v2_version',
      '0',
      join(root, 'source.mp3'),
    ]);
    const image = await run(options.ffmpeg, [
      '-v',
      'error',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=16x16:d=0.1',
      '-frames:v',
      '1',
      '-threads',
      '1',
      join(root, 'cover.png'),
    ]);
    if (created.exitCode !== 0 || image.exitCode !== 0) throw new Error('helper_unavailable');
    const helper = createMetadataHelper({
      ...options,
      musicRoot: root,
      helperPath: join(dirname(options.helperPath), 'metadata.py'),
      maxFileBytes: 1024 * 1024,
      timeoutMs: 60000,
    });
    const before = await helper.read({ key: 'source.mp3', signal });
    copyFileSync(join(root, 'source.mp3'), join(root, 'candidate.metadata-pending'));
    const after = await helper.prepare({
      candidateKey: 'candidate.metadata-pending',
      expectedDigest: before.fullDigest,
      patch: {
        title: { op: 'set', value: 'Musiclatte runtime self-test' },
        lyrics: {
          op: 'set',
          selector: { language: 'eng', description: '' },
          text: 'An original synthetic runtime tone.',
        },
        cover: { op: 'set', selector: { kind: 'new' }, uploadId: 'self-test' },
      },
      cover: { key: 'cover.png' },
      signal,
    });
    const readback = await helper.read({ key: 'candidate.metadata-pending', signal });
    const png = readFileSync(join(root, 'cover.png'));
    if (
      !after.audioPreserved ||
      readback.fullDigest !== after.snapshot.fullDigest ||
      readback.values.title !== 'Musiclatte runtime self-test' ||
      readback.lyricsFrames.length !== 1 ||
      readback.coverFrames.length !== 1 ||
      JSON.stringify(before.audio) !== JSON.stringify(readback.audio) ||
      !(await compareCoverProjection({
        privateRoot: root,
        projector: options.projector,
        expected: png,
        actual: png,
        signal,
      }))
    )
      throw new Error('helper_unavailable');
    return {
      profile: 'posix-exclusive-mp3-id3v23-v24-v1' as const,
      python: python.stdout.trim(),
      ffmpeg: ffmpeg.stdout.split('\n')[0]!,
      ffprobe: ffprobe.stdout.split('\n')[0]!,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

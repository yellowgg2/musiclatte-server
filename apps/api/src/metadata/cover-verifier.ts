import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MusicEntry } from '@musiclatte/contracts';
import type { SubsonicClient } from '../subsonic/client.js';
import { runProcess } from '../imports/process-runner.js';
import type { createMetadataHelper, MetadataTagSnapshot } from './helper-client.js';
import type { MetadataWork } from './worker.js';
import type { ManagementDatabase } from '../storage/database.js';

export async function compareCoverProjection(options: {
  privateRoot: string;
  projector: string;
  expected: Buffer;
  actual: Buffer;
  signal?: AbortSignal;
}): Promise<boolean> {
  const root = mkdtempSync(join(options.privateRoot, '.cover-check-'));
  try {
    for (const key of ['expected', 'actual'] as const) {
      if (!options[key].length || options[key].length > 8 * 1024 * 1024)
        throw new Error('invalid_cover');
      writeFileSync(join(root, key), options[key], { mode: 0o600, flag: 'wx' });
    }
    const result = await runProcess({
      executable: options.projector,
      args: [],
      cwd: root,
      allowedCwds: [root],
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
      limits: { stdoutBytes: 1024, stderrBytes: 1024, graceMs: 100 },
    });
    const response = JSON.parse(result.stdout) as Record<string, unknown>;
    if (
      result.exitCode !== 0 ||
      response.profile !== 'gonic-0.22.0-imaging-1.6.2' ||
      typeof response.matches !== 'boolean'
    )
      throw new Error('invalid_cover');
    return response.matches;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
export function createMetadataCoverVerifier(options: {
  database: ManagementDatabase;
  privateRoot: string;
  projector: string;
  helper: ReturnType<typeof createMetadataHelper>;
  signal: AbortSignal;
}) {
  return async (
    work: MetadataWork,
    snapshot: MetadataTagSnapshot,
    song: MusicEntry,
    client: SubsonicClient,
  ): Promise<boolean> => {
    if (!snapshot.coverFrames.length) return !song.coverArt;
    if (!song.coverArt) return false;
    let frames = snapshot.coverFrames;
    if (work.patch.cover?.op === 'set') {
      const row = options.database.connection
        .prepare(
          'SELECT digest FROM metadata_cover_uploads WHERE id=? AND identity_key=? AND library_id=?',
        )
        .get(work.patch.cover.uploadId, work.identityKey, work.libraryId);
      if (!row) throw new Error('reflection_unavailable');
      frames = frames.filter((frame) => frame.pictureType === 3 && frame.digest === row.digest);
    }
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(10000)]);
    const response = await fetch(client.mediaRequest('getCoverArt', song.coverArt, { signal }), {
      redirect: 'manual',
    });
    if (
      !response.ok ||
      !['image/png', 'image/jpeg'].includes(
        response.headers.get('content-type')?.split(';')[0] ?? '',
      ) ||
      !response.body
    ) {
      await response.body?.cancel();
      throw new Error('reflection_unavailable');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 8 * 1024 * 1024) throw new Error('reflection_unavailable');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const actual = Buffer.concat(chunks);
    // Ambiguous multi-cover files can remain reflecting; never guess after an unbounded search.
    for (const frame of frames.slice(0, 8)) {
      if (!['image/png', 'image/jpeg'].includes(frame.mimeType)) continue;
      const expected = await options.helper.cover({
        key: work.key,
        expectedDigest: snapshot.fullDigest,
        frameId: frame.frameId,
      });
      if (
        await compareCoverProjection({
          privateRoot: options.privateRoot,
          projector: options.projector,
          expected: expected.data,
          actual,
          signal: options.signal,
        })
      )
        return true;
    }
    return false;
  };
}

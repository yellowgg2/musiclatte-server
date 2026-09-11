import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  migrateReferenceSequence,
  withoutReference,
} from '../../apps/api/src/metadata/reference-migration.js';

describe('organization reference migration contract', () => {
  it('preserves ordered duplicate playlist occurrences across scan outcomes', () => {
    const baseline = ['old', 'first', 'old', 'last', 'old'];
    expect(migrateReferenceSequence(baseline, 'old', 'new')).toEqual([
      'new',
      'first',
      'new',
      'last',
      'new',
    ]);
    expect(withoutReference(baseline, 'old')).toEqual(['first', 'last']);
  });

  it('limits account access to playlist and star APIs and schedules it before new file work', async () => {
    const migration = await readFile(
      resolve('apps/api/src/metadata/reference-migration.ts'),
      'utf8',
    );
    const runtime = await readFile(resolve('apps/api/src/metadata-worker-runtime.ts'), 'utf8');
    expect(migration).toContain(
      "'getPlaylist' | 'createPlaylist' | 'getPlaylists' | 'getStarred2' | 'starSong'",
    );
    for (const forbidden of ['scrobble', 'recentSong', 'bookmark', 'listening_events'])
      expect(migration).not.toContain(forbidden);
    expect(runtime.indexOf('referenceOnly: true')).toBeGreaterThan(-1);
    expect(runtime.indexOf('referenceOnly: true')).toBeLessThan(runtime.indexOf('fileOnly: true'));
  });
});

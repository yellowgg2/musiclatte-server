import { describe, expect, it } from 'vitest';
import { clientFeatures } from '../../apps/web/src/capabilities/client-features';
import { safeReturnPath } from '../../apps/web/src/auth/guards';
import { existsSync } from 'node:fs';

describe('single metadata UI contract', () => {
  /** Only implemented single-field consumers open; implemented automation consumers open in Phase 6. */
  it('should enable metadata and lyrics consumers with source-only UI verification tools', () => {
    expect(clientFeatures['metadata.write']).toBe(true);
    expect(clientFeatures['metadata.lyrics.write']).toBe(true);
    expect(clientFeatures['metadata.curation']).toBe(true);
    expect(existsSync('tools/verification/metadata-ui-harness.ts')).toBe(true);
  });
  /** Safe post-login history re-entry preserves the SPA base and rejects ambiguous paths. */
  it('should restore canonical job routes only within the SPA base', () => {
    expect(safeReturnPath('/app/metadata-jobs/job-1', '/app/')).toBe('/app/metadata-jobs/job-1');
    expect(safeReturnPath('/app/metadata-jobs', '/app/')).toBe('/app/metadata-jobs');
    expect(safeReturnPath('/app/metadata-jobs/%2E%2E', '/app/')).toBe('/app/music');
    expect(safeReturnPath('/app/metadata-jobs/job-1?token=secret', '/app/')).toBe('/app/music');
  });
});

/** The loopback harness serves producer-shaped browse and snapshot DTOs to the actual strict clients. */
it('should serve deterministic normal-entry fixtures with strict DTOs', async () => {
  const { startMetadataUIHarness } = await import('../../tools/verification/metadata-ui-harness');
  const { createMusicClient } = await import('../../apps/web/src/music/client');
  const { createMetadataClient } = await import('../../apps/web/src/metadata/client');
  const server = await startMetadataUIHarness({ port: 0 });
  try {
    const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
    const login = await fetch(`${origin}/api/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'fixture', password: 'fixture' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const fetcher: typeof fetch = (input, init) =>
      fetch(input, {
        ...init,
        headers: { ...Object.fromEntries(new Headers(init?.headers)), cookie },
      });
    const music = createMusicClient({ fetcher, apiOrigin: origin });
    const signal = new AbortController().signal;
    expect(
      (
        await music.read(
          { kind: 'folders', query: new URLSearchParams('musicFolderId=music') },
          signal,
        )
      ).kind,
    ).toBe('indexes');
    expect(
      (await music.read({ kind: 'folder', id: 'folder', query: new URLSearchParams() }, signal))
        .kind,
    ).toBe('folder');
    const metadata = createMetadataClient({ fetcher, apiOrigin: origin });
    expect((await metadata.read('synthetic-song')).coverFrames).toHaveLength(1);
  } finally {
    await server.close();
  }
});

/** Persisted retry intent is closed and validated before displaying or reusing its patch. */
it('should decode original intent and reject unknown or malformed changes', async () => {
  const contracts = await import('@musiclatte/contracts');
  const decode = (contracts as unknown as { decodeMetadataIntent?: (v: unknown) => unknown })
    .decodeMetadataIntent;
  expect(decode).toBeTypeOf('function');
  const intent = {
    targets: [{ trackId: 'A', expectedRevision: 'rev' }],
    patch: { album: { op: 'clear' }, artist: { op: 'set', value: ['One', 'Two'] } },
  };
  expect(decode!(intent)).toEqual(intent);
  for (const patch of [
    { secret: { op: 'clear' } },
    { artist: { op: 'set', value: 'One' } },
    { title: { op: 'set', value: '' } },
    { year: { op: 'set', value: 'nope' } },
    { album: { op: 'clear', value: 'ignored' } },
  ])
    expect(() => decode!({ ...intent, patch })).toThrow();
});

/** Bulk review fixtures expose independent targets and preserve succeeded files during retry. */
it('should serve three independent bulk songs through normal authenticated routes', async () => {
  const { startMetadataUIHarness } = await import('../../tools/verification/metadata-ui-harness');
  const server = await startMetadataUIHarness({ port: 0, scenario: 'bulk' } as never);
  try {
    const address = server.httpServer!.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${origin}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fixture', password: 'fixture' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const response = await fetch(`${origin}/api/v1/music/folders/folder`, { headers: { cookie } });
    expect((await response.json()).directory.child).toHaveLength(3);
  } finally {
    await server.close();
  }
});

/** Restore comparisons remain tag-only and reject private locations or mismatched identities. */
it('should strictly decode tag-only restore comparisons', async () => {
  const { decodeMetadataRestorePreview } = await import('@musiclatte/contracts');
  const values = {
    title: 'Original',
    artist: [],
    album: null,
    albumArtist: [],
    trackNumber: null,
    year: null,
    genre: [],
  };
  const value = {
    schemaVersion: 1,
    jobId: 'job',
    itemId: 'item',
    backupCreatedAt: 1,
    current: {
      schemaVersion: 1,
      trackId: 'A',
      editable: false,
      reason: 'read_only',
      format: 'mp3',
      supportedFields: [],
      fileRevision: 'rev',
      values,
      coverFrames: [],
      lyricsFrames: [],
      lastVerifiedAt: 1,
    },
    currentCovers: [],
    original: { values, lyricsFrames: [], covers: [] },
  };
  expect(decodeMetadataRestorePreview(value)).toEqual(value);
  expect(() => decodeMetadataRestorePreview({ ...value, backupPath: '/private/file' })).toThrow();
  expect(() =>
    decodeMetadataRestorePreview({ ...value, original: { ...value.original, bytes: 'private' } }),
  ).toThrow();
  expect(() =>
    decodeMetadataRestorePreview({
      ...value,
      original: {
        ...value.original,
        covers: [{ description: '', pictureType: 3, mimeType: 'image/png', digest: 'invalid' }],
      },
    }),
  ).toThrow();
});

/** Every recovery fixture enters through authenticated history and matches the production decoder. */
it('should expose all recovery states through strict normal history routes', async () => {
  const { startMetadataUIHarness } = await import('../../tools/verification/metadata-ui-harness');
  const { createMetadataClient } = await import('../../apps/web/src/metadata/client');
  for (const mode of [
    'staleRevision',
    'diskFull',
    'partial',
    'long',
    'workerRestart',
    'reflectingDelay',
    'coverStale',
    'idConflict',
    'restoreConflict',
    'restoreSucceeded',
    'denied',
  ]) {
    const server = await startMetadataUIHarness({ port: 0, scenario: `recovery:${mode}` });
    try {
      const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
      const login = await fetch(`${origin}/api/v1/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'fixture', password: 'fixture' }),
      });
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      const client = createMetadataClient({
        apiOrigin: origin,
        fetcher: (url, init) =>
          fetch(url, {
            ...init,
            headers: { ...Object.fromEntries(new Headers(init?.headers)), cookie },
          }),
      });
      const history = await client.list();
      expect(history.jobs).toHaveLength(1);
      expect(history.jobs[0]!.id).toBe(`recovery-${mode}`);
      const job = await client.detail(history.jobs[0]!.id);
      if (job.items[0]!.restoreAvailable)
        expect(
          (await client.restorePreview(job.id, job.items[0]!.itemId)).original.values.title,
        ).toBe('Original evening in the studio');
    } finally {
      await server.close();
    }
  }
});

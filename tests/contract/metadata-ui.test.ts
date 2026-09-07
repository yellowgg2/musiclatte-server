import { describe, expect, it } from 'vitest';
import { clientFeatures } from '../../apps/web/src/capabilities/client-features';
import { safeReturnPath } from '../../apps/web/src/auth/guards';
import { existsSync } from 'node:fs';

describe('single metadata UI contract', () => {
  /** Only implemented single-field consumers open; unrelated future product consumers stay closed. */
  it('should enable metadata and lyrics consumers with source-only UI verification tools', () => {
    expect(clientFeatures['metadata.write']).toBe(true);
    expect(clientFeatures['metadata.lyrics.write']).toBe(true);
    expect(clientFeatures['metadata.curation']).toBe(false);
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

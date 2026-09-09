import { join, resolve } from 'node:path';
import { mkdirSync, realpathSync } from 'node:fs';
import { createMetadataPrincipalContext } from './metadata-principal-harness.js';
import { createApp } from '../../apps/api/src/app.js';
import { createMediaFence } from '../../apps/api/src/metadata/media-fence.js';
import { createCurationRepository } from '../../apps/api/src/storage/curation-repository.js';
import { createCurationReconciler } from '../../apps/api/src/curation/reconciliation.js';
import { createMetadataFileAccess } from '../../apps/api/src/metadata/file-access.js';
import { createMetadataHelper } from '../../apps/api/src/metadata/helper-client.js';
import { recentNow } from './recent-harness.js';
import type { AccessTokenScope } from '@musiclatte/contracts';
export async function createCurationMutationContext() {
  const c = await createMetadataPrincipalContext();
  let now = recentNow;
  const clock = () => now;
  const lockRoot = join(realpathSync(c.storage.root), 'media-locks');
  mkdirSync(lockRoot, { mode: 0o700 });
  const fence = createMediaFence({
    root: lockRoot,
    python: c.metadata.runtime.python,
    helperPath: resolve('apps/api/helpers/media_fence.py'),
    timeoutMs: 60000,
  });
  const limits = {
    claimLeaseMs: 1000,
    maxTargets: 10,
    snapshotMaxAgeMs: 1000,
    snapshotMaxItems: 100,
    snapshotMaxCount: 20,
  };
  const automation = { ...c.automation, clock, curation: { limits, fence } };
  const options = { ...c.options, metadata: { ...c.metadata, clock }, automation };
  const app = createApp(options);
  const repository = createCurationRepository({
    database: c.storage.db,
    clock,
    cursorKey: c.options.signingKey,
    limits,
  });
  const trackRef = repository.discover({ libraryId: 'music', trackId: 'track-1', format: 'mp3' });
  const helper = createMetadataHelper(c.metadata.runtime);
  const fileAccess = createMetadataFileAccess({
    ...c.metadata.runtime,
    helperPath: resolve('apps/api/helpers/file_access.py'),
  });
  const reconciler = createCurationReconciler({
    database: c.storage.db,
    repository,
    clock,
    signingKey: c.options.signingKey,
    libraries: c.metadata.policy.libraries,
    source: {
      recentSong: async (id: string) => ({
        song: { id, isDir: false, title: 'Indexed' },
        path: 'imports/source.mp3',
      }),
    },
    helper,
    fileAccess,
    fence,
  });
  await reconciler.reconcile(trackRef);
  async function token(
    scopes: AccessTokenScope[] = [
      'metadata:read',
      'metadata:write',
      'lyrics:write',
      'curation:write',
    ],
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/access-tokens',
      headers: c.headers,
      payload: {
        name: 'Synthetic worker',
        scopes,
        libraryIds: ['music'],
        expiresAt: recentNow + 100000,
      },
    });
    if (response.statusCode !== 201) throw new Error('fixture_token_failed');
    return { authorization: `Bearer ${response.json().token}`, 'content-type': 'application/json' };
  }
  const post = (url: string, payload: object, headers: Record<string, string> = c.headers) =>
    app.inject({ method: 'POST', url: '/api/v1/' + url, headers, payload });
  return {
    ...c,
    app,
    options,
    automation,
    clock,
    fence,
    lockRoot,
    repository,
    reconciler,
    trackRef,
    helper,
    fileAccess,
    token,
    post,
    setNow: (value: number) => {
      now = value;
    },
    cleanup: async () => {
      await app.close();
      await c.cleanup();
    },
  };
}

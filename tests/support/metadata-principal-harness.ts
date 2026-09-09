import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRecentContext, recentNow } from './recent-harness.js';
import { browserHeaders, cookieOf, password } from './auth-harness.js';
import { createMetadataFixture } from '../../packages/test-support/src/metadata-fixtures.js';
import { createApp } from '../../apps/api/src/app.js';
const toolchain = join(homedir(), '.cache/musiclatte-toolchain');
const runtime = {
  python: process.env.METADATA_TEST_PYTHON ?? join(toolchain, 'metadata-python/bin/python'),
  ffmpeg: process.env.METADATA_TEST_FFMPEG ?? join(toolchain, 'ffmpeg-9.0.1/ffmpeg'),
  ffprobe: process.env.METADATA_TEST_FFPROBE ?? join(toolchain, 'ffmpeg-9.0.1/ffprobe'),
  helperPath: resolve('apps/api/helpers/metadata.py'),
  timeoutMs: 60000,
  maxFileBytes: 10 * 1024 * 1024,
};
export async function createMetadataPrincipalContext() {
  const c = await createRecentContext();
  const root = join(c.musicRoot, 'imports');
  mkdirSync(root);
  await createMetadataFixture({ root, ...runtime, version: 4 });
  c.songs.push({ id: 'track-1', title: 'Indexed title', isDir: false, path: 'imports/source.mp3' });
  const uploadRoot = join(realpathSync(c.storage.root), 'metadata-uploads');
  mkdirSync(uploadRoot, { mode: 0o700 });
  let ready = true;
  const metadata = {
    database: c.storage.db,
    clock: () => recentNow,
    runtime: { ...runtime, musicRoot: c.musicRoot },
    uploadRoot,
    workerReady: () => ready,
    verifiedProfile: true,
    policy: {
      schemaVersion: 1 as const,
      enabled: true,
      libraries: [
        {
          id: 'music',
          musicFolderId: '0',
          relativeRoot: 'imports',
          editors: [password.username],
          writeProfile: 'exclusive' as const,
          preserveOwnership: true,
        },
      ],
      restoreManagers: [password.username],
      limits: { maxTargets: 64, maxFileBytes: runtime.maxFileBytes, timeoutMs: 60000 },
    },
  };
  const automation = {
    database: c.storage.db,
    vault: c.storage.vault,
    clock: () => recentNow,
    policy: metadata.policy,
    maxTokenAgeMs: 100000,
  };
  const options = { ...c.options, metadata, automation };
  const app = createApp(options);
  const cleanup = async () => {
    await app.close();
    await c.cleanup();
  };
  const login = await c.login();
  const headers = {
    ...browserHeaders,
    cookie: cookieOf(login),
    'x-csrf-token': login.json().csrfToken as string,
  };
  const get = (url = '/api/v1/tracks/track-1/metadata', supplied = headers) =>
    app.inject({ url, headers: supplied });
  const post = (url: string, payload: object, supplied = headers) =>
    app.inject({ method: 'POST', url: `/api/v1/${url}`, headers: supplied, payload });
  return {
    ...c,
    options,
    automation,
    cleanup,
    app,
    metadata,
    headers,
    root,
    get,
    post,
    unavailable: () => {
      ready = false;
    },
  };
}

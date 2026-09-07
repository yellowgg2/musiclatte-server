import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createApp } from '../../apps/api/src/app.js';
import { createSessionService } from '../../apps/api/src/auth/session-service.js';
import { cookieOf, createTestContext as authContext, password } from './auth-harness.js';

export const recentNow = Date.parse('2026-09-07T12:00:00.000Z');
export async function createRecentContext() {
  const ctx = await authContext();
  let now = recentNow;
  const musicRoot = join(realpathSync(ctx.storage.root), 'music');
  mkdirSync(musicRoot);
  const imports = {
    database: ctx.storage.db,
    clock: () => now,
    policy: {
      enabled: true,
      engineManagers: [],
      libraries: [
        {
          id: 'music',
          musicFolderId: '1',
          relativeRoot: 'imports',
          allowedUsers: [password.username, 'other-user'],
        },
        {
          id: 'second',
          musicFolderId: '2',
          relativeRoot: 'second',
          allowedUsers: [password.username],
        },
      ],
    },
  };
  const options = { ...ctx.options, imports, recent: { musicRoot } };
  const app = createApp(options);
  const service = createSessionService(options);
  const login = await ctx.login();
  const headers = { cookie: cookieOf(login) };
  ctx.state.accountIdentityFromProof = true;
  const songs: Record<string, unknown>[] = [];
  ctx.state.registration = { statuses: [], roots: [], directories: { fixture: songs } };
  let counter = 0;
  const seed = (
    input: {
      at?: number;
      id?: string;
      state?: 'ready' | 'registering';
      libraryId?: string;
      username?: string;
    } = {},
  ) => {
    const n = ++counter;
    const id = input.id ?? `event-${String(n).padStart(4, '0')}`;
    const libraryId = input.libraryId ?? 'music';
    const at = input.at ?? recentNow - 1000;
    const ready = input.state !== 'registering';
    const fileKey = `${libraryId === 'music' ? 'imports' : 'second'}/song-${n}.mp3`;
    const file = join(musicRoot, fileKey);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'synthetic audio fixture');
    const identityKey = Buffer.from(
      service.sign(
        'import-identity',
        JSON.stringify([ctx.storage.instances.get().id, input.username ?? password.username]),
      ),
      'base64url',
    ).toString('hex');
    const db = ctx.storage.db.connection;
    db.prepare(
      'INSERT INTO import_jobs(id,identity_key,library_id,operation_id_hash,request_hash,created_at) VALUES(?,?,?,?,?,?)',
    ).run(`job-${n}`, identityKey, libraryId, String(n).padStart(64, '0'), 'c'.repeat(64), at);
    db.prepare(
      'INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at) VALUES(?,?,?,?,1,?,?)',
    ).run(
      `media-${n}`,
      libraryId,
      fileKey,
      ready ? `song-${n}` : null,
      ready ? 'available' : 'unavailable',
      at,
    );
    db.prepare(
      'INSERT INTO import_items(id,job_id,item_order,source_id,stage,media_link_id,stage_changed_at,ready_at) VALUES(?,?,0,?,?,?,?,?)',
    ).run(
      `item-${n}`,
      `job-${n}`,
      `source-${n}`,
      ready ? 'ready' : 'registering',
      `media-${n}`,
      at,
      ready ? at : null,
    );
    db.prepare(
      'INSERT INTO download_events(id,import_item_id,identity_key,library_id,download_completed_at,registered_at) VALUES(?,?,?,?,?,?)',
    ).run(id, `item-${n}`, identityKey, libraryId, at, ready ? at : null);
    const song = { id: `song-${n}`, title: `Synthetic song ${n}`, isDir: false, path: fileKey };
    songs.push(song);
    return { id, fileKey, file, song, identityKey };
  };
  return {
    ...ctx,
    app,
    options,
    imports,
    headers,
    musicRoot,
    seed,
    songs,
    setNow(value: number) {
      now = value;
    },
    get(query: Record<string, string> = {}, requestHeaders = headers) {
      return app.inject({
        method: 'GET',
        url: `/api/v1/recent-downloads?${new URLSearchParams(query)}`,
        headers: requestHeaders,
      });
    },
    async cleanup() {
      await app.close();
      await ctx.cleanup();
    },
  };
}

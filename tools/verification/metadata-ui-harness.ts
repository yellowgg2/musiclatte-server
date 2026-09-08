import { createBulkMetadataFixture } from './metadata-bulk-fixture.js';
/** Source-only normal-entry UI harness; never imported by the product application. */
import { createServer, type ViteDevServer } from 'vite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  MetadataJob,
  MetadataJobRequest,
  MetadataSnapshot,
  MusicEntry,
} from '../../packages/contracts/src/index.js';

export async function startMetadataUIHarness({
  port,
  apiOrigin,
  controlFile,
  scenario: initialScenario = 'single',
}: {
  port: number;
  apiOrigin?: string;
  controlFile?: string;
  scenario?: string;
}): Promise<ViteDevServer> {
  if (apiOrigin && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiOrigin).hostname))
    throw new Error('Real BFF must use an owned loopback tunnel');
  let revision = 1;
  const jobs: MetadataJob[] = [];
  const operations = new Map<string, MetadataJob>();
  let values: MetadataSnapshot['values'] = {
    title: 'Evening in the studio',
    artist: ['Studio ensemble', 'Guest artist'],
    album: 'Small moments',
    albumArtist: ['Studio ensemble'],
    trackNumber: '1/8',
    year: '2026',
    genre: ['Instrumental'],
  };
  const song = (): MusicEntry => ({
    id: 'synthetic-song',
    title: values.title ?? '',
    artist: values.artist.join(' / '),
    album: values.album ?? '',
    coverArt: 'synthetic-cover',
    duration: 180,
    isDir: false,
  });
  const scenario = () => (controlFile ? readFileSync(controlFile, 'utf8').trim() : initialScenario);
  const json = (res: ServerResponse, value: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value));
  };
  const fail = (res: ServerResponse, code = 'unauthenticated', status = 401) =>
    json(res, { schemaVersion: 1, error: { code } }, status);
  const body = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 9 * 1024 * 1024) throw new Error('Body too large');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  };
  const bulkFixture = createBulkMetadataFixture();
  const middleware = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const mode = scenario();
    const session = {
      schemaVersion: 1,
      authScheme: 'cookie',
      username: 'fixture-listener',
      csrfToken: 'fixture-csrf',
      expiresAt: Date.now() + 3600000,
    };
    if (path === '/api/v1/session' && method === 'POST') {
      const input = JSON.parse((await body(req)).toString());
      if (input.username !== 'fixture' || input.password !== 'fixture') return fail(res);
      res.setHeader('Set-Cookie', 'metadata-fixture=active; HttpOnly; SameSite=Strict; Path=/');
      return json(res, session);
    }
    if (!req.headers.cookie?.includes('metadata-fixture=active') || mode === 'session-expired')
      return fail(res);
    if (path === '/api/v1/session') {
      if (method === 'DELETE') {
        res.setHeader('Set-Cookie', 'metadata-fixture=; Max-Age=0; Path=/');
        res.statusCode = 204;
        res.end();
        return;
      }
      return json(res, session);
    }
    if (method !== 'GET' && req.headers['x-csrf-token'] !== 'fixture-csrf')
      return fail(res, 'forbidden', 403);
    if (path === '/api/v1/capabilities')
      return json(res, {
        schemaVersion: 1,
        instanceId: 'metadata-fixture',
        revision: `single-${mode}`,
        features: Object.fromEntries(
          [
            'music.browse',
            'music.stream',
            'metadata.write',
            'metadata.lyrics.write',
            ...(mode.startsWith('bulk') || mode.startsWith('recovery') ? ['playlists.read'] : []),
          ].map((key) => [
            key,
            {
              ...(key === 'metadata.write' &&
              (mode.startsWith('bulk') || mode.startsWith('recovery'))
                ? {
                    bulkFields: [
                      'title',
                      'artist',
                      'album',
                      'albumArtist',
                      'trackNumber',
                      'year',
                      'genre',
                    ],
                  }
                : {}),
              supported: mode !== 'capability-unsupported',
              permission: mode === 'denied' ? 'denied' : 'allowed',
              availability: mode === 'worker-down' ? 'temporarily_unavailable' : 'available',
            },
          ]),
        ),
      });
    if (
      (mode.startsWith('bulk') || mode.startsWith('recovery')) &&
      (await bulkFixture(req, res, mode))
    )
      return;
    if (path === '/api/v1/music/folders' && !url.searchParams.has('musicFolderId'))
      return json(res, { schemaVersion: 1, folders: [{ id: 'music', name: 'Studio collection' }] });
    if (path === '/api/v1/music/folders')
      return json(res, {
        schemaVersion: 1,
        indexes: {
          index: [{ name: 'S', artist: [{ id: 'folder', name: 'Studio collection', album: [] }] }],
        },
      });
    if (path === '/api/v1/music/folders/folder')
      return json(res, {
        schemaVersion: 1,
        directory: { id: 'folder', name: 'Studio collection', child: [song()] },
      });
    if (path === '/api/v1/music/search')
      return json(res, { schemaVersion: 1, result: { song: [song()], artist: [], album: [] } });
    if (path === '/api/v1/music/songs/synthetic-song')
      return json(res, { schemaVersion: 1, song: song() });
    if (path === '/api/v1/tracks/synthetic-song/metadata') {
      if (mode === 'loading') await new Promise((resolve) => setTimeout(resolve, 2000));
      if (mode === 'error') return fail(res, 'upstream_unavailable', 503);
      return json(res, {
        schemaVersion: 1,
        trackId: 'synthetic-song',
        editable: !['read-only', 'unsupported'].includes(mode),
        reason:
          mode === 'read-only' ? 'read_only' : mode === 'unsupported' ? 'unsupported_format' : null,
        format: mode === 'unsupported' ? 'unsupported' : 'mp3',
        supportedFields: [
          'title',
          'artist',
          'album',
          'albumArtist',
          'trackNumber',
          'year',
          'genre',
          'cover',
          'lyrics',
        ],
        fileRevision: `revision-${revision}`,
        values,
        coverFrames: [
          {
            frameId: 'front-1',
            pictureType: 3,
            description: 'Album front',
            mimeType: 'image/png',
            previewUrl: '/api/v1/tracks/synthetic-song/metadata/cover/front-1',
          },
          ...(mode === 'variants'
            ? [
                {
                  frameId: 'front-2',
                  pictureType: 3,
                  description: 'Alternate front',
                  mimeType: 'image/png',
                  previewUrl: '/api/v1/tracks/synthetic-song/metadata/cover/front-2',
                },
              ]
            : []),
        ],
        lyricsFrames: [
          {
            selector: { language: 'eng', description: 'Original' },
            text: 'A quiet evening\nA little time for music',
          },
          {
            selector: { language: 'kor', description: 'Korean version' },
            text: '고요한 저녁\n음악을 듣는 시간',
          },
        ],
        lastVerifiedAt: Date.now(),
      });
    }
    if (path === '/api/v1/metadata-previews') {
      const input = JSON.parse((await body(req)).toString());
      return json(res, {
        schemaVersion: 1,
        libraryId: 'music',
        targetCount: input.targets.length,
        changedFields: Object.keys(input.patch),
        targets: input.targets.map((target: { trackId: string; expectedRevision: string }) => ({
          trackId: target.trackId,
          fileRevision: target.expectedRevision,
        })),
        writeGuaranteed: false,
      });
    }
    if (path === '/api/v1/metadata-covers' && method === 'POST') {
      await body(req);
      if (mode === 'cover-error') return fail(res, 'invalid_request', 400);
      return json(res, {
        schemaVersion: 1,
        uploadId: 'upload-1',
        libraryId: 'music',
        mimeType: 'image/png',
        size: 100,
        expiresAt: Date.now() + 3600000,
        previewUrl: '/api/v1/metadata-covers/upload-1',
      });
    }
    if (path === '/api/v1/metadata-jobs' && method === 'POST') {
      if (mode === 'busy') await new Promise((resolve) => setTimeout(resolve, 4000));
      const input = JSON.parse((await body(req)).toString()) as MetadataJobRequest;
      const previous = operations.get(input.operationId);
      if (previous) return json(res, { schemaVersion: 1, job: previous });
      const createdAt = Date.now();
      const job: MetadataJob = {
        id: `job-${jobs.length + 1}`,
        libraryId: 'music',
        createdAt,
        status: 'queued',
        kind: 'edit',
        parentJobId: null,
        items: input.targets.map((target, index) => ({
          itemId: `item-${jobs.length + 1}-${index}`,
          originalTrackId: target.trackId,
          currentTrackId: target.trackId,
          stage: 'queued',
          fileSavedAt: null,
          reflectedAt: null,
          previousRevision: target.expectedRevision,
          resultRevision: null,
          changedFields: Object.keys(input.patch) as MetadataJob['items'][number]['changedFields'],
          errorCode: null,
          recoveryActions: [],
          restoreAvailable: false,
        })),
      };
      operations.set(input.operationId, job);
      jobs.unshift(job);
      setTimeout(() => {
        job.status =
          mode === 'failed' || mode === 'conflict'
            ? 'failed'
            : mode === 'pending'
              ? 'reflecting'
              : 'succeeded';
        for (const item of job.items) {
          item.stage =
            mode === 'failed'
              ? 'failed'
              : mode === 'conflict'
                ? 'conflict'
                : mode === 'pending'
                  ? 'reflecting'
                  : 'succeeded';
          item.fileSavedAt = mode === 'failed' || mode === 'conflict' ? null : Date.now();
          item.reflectedAt = job.status === 'succeeded' ? Date.now() : null;
          item.errorCode =
            mode === 'pending'
              ? 'reflection_mismatch'
              : mode === 'failed'
                ? 'write_failed'
                : mode === 'conflict'
                  ? 'revision_conflict'
                  : null;
          item.resultRevision = `revision-${revision + 1}`;
        }
        if (job.status === 'succeeded') {
          for (const [field, change] of Object.entries(input.patch)) {
            if (field in values) {
              const key = field as keyof typeof values;
              Object.assign(values, {
                [key]:
                  change.op === 'clear'
                    ? Array.isArray(values[key])
                      ? []
                      : null
                    : 'value' in change
                      ? change.value
                      : values[key],
              });
            }
          }
          revision++;
        }
      }, 1500).unref();
      return json(res, { schemaVersion: 1, job }, 202);
    }
    if (path === '/api/v1/metadata-jobs')
      return json(res, { schemaVersion: 1, jobs, nextCursor: null });
    if (path.startsWith('/api/v1/metadata-jobs/')) {
      const job = jobs.find((job) => job.id === path.split('/').at(-1));
      return job ? json(res, { schemaVersion: 1, job }) : fail(res, 'not_found', 404);
    }
    if (path === '/api/v1/metadata-changes')
      return json(res, {
        schemaVersion: 1,
        changes:
          revision === 1
            ? []
            : [
                {
                  sequence: revision,
                  libraryId: 'music',
                  oldTrackId: 'synthetic-song',
                  newTrackId: 'synthetic-song',
                  oldRevision: `revision-${revision - 1}`,
                  newRevision: `revision-${revision}`,
                  coverGeneration: `revision-${revision}`,
                  relatedIds: {
                    trackIds: ['synthetic-song'],
                    albumIds: [],
                    artistIds: [],
                    coverIds: ['synthetic-cover'],
                  },
                  changedFields: ['title', 'cover'],
                  fileSavedAt: Date.now(),
                  reflectedAt: Date.now(),
                  reflection: 'verified',
                },
              ],
        hasMore: false,
        nextCursor: `cursor-${revision}`,
      });
    if (path.includes('/cover') || path.includes('/metadata-covers/')) {
      res.setHeader('Content-Type', 'image/png');
      res.end(readFileSync(resolve('apps/web/public/icons/musiclatte-192.png')));
      return;
    }
    if (path.endsWith('/stream')) {
      const samples = 8000 * 180;
      const wav = Buffer.alloc(44 + samples * 2);
      wav.write('RIFF');
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24);
      wav.writeUInt32LE(16000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write('data', 36);
      wav.writeUInt32LE(samples * 2, 40);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Accept-Ranges', 'bytes');
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
      if (start >= wav.length) {
        res.statusCode = 416;
        res.end();
        return;
      }
      if (range) {
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${wav.length}`);
      }
      res.setHeader('Content-Length', end - start + 1);
      res.end(wav.subarray(start, end + 1));
      return;
    }
    return fail(res, 'not_found', 404);
  };
  const cacheDir = mkdtempSync(join(tmpdir(), 'musiclatte-metadata-ui-'));
  const server = await createServer({
    cacheDir,
    root: resolve('apps/web'),
    configFile: false,
    server: {
      host: '127.0.0.1',
      port,
      strictPort: port !== 0,
      ...(apiOrigin ? { proxy: { '/api': { target: apiOrigin, changeOrigin: false } } } : {}),
    },
    plugins: apiOrigin
      ? []
      : [
          {
            name: 'metadata-source-only-harness',
            configureServer(server) {
              server.middlewares.use((req, res, next) => {
                if (!req.url?.startsWith('/api/')) {
                  next();
                  return;
                }
                void middleware(req, res).catch(() => fail(res, 'internal_error', 500));
              });
            },
          },
        ],
  });
  const close = server.close.bind(server);
  server.close = async () => {
    try {
      await close();
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  };
  await server.listen();
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name: string) => args[args.indexOf(name) + 1];
  const port = Number(option('--port'));
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Provide an unused --port');
  const apiOrigin = args.includes('--api-origin') ? option('--api-origin') : undefined;
  const controlFile = args.includes('--control-file') ? option('--control-file') : undefined;
  const server = await startMetadataUIHarness({
    port,
    scenario: args.includes('--scenario') ? (option('--scenario') ?? 'single') : 'single',
    ...(apiOrigin ? { apiOrigin } : {}),
    ...(controlFile ? { controlFile } : {}),
  });
  console.log(
    `Metadata UI harness ready on http://127.0.0.1:${port} (${apiOrigin ? 'real BFF' : 'synthetic fixture'})`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => void server.close().then(() => process.exit(0)));
}

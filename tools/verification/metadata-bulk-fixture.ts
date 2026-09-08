/** Private in-memory transport fixture for the normal production bulk editor routes. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  MetadataJob,
  MetadataJobRequest,
  MetadataPatch,
  MetadataSnapshot,
  MetadataChange,
} from '../../packages/contracts/src/index.js';
export function createBulkMetadataFixture() {
  const snapshots = new Map(
    ['A', 'B', 'C'].map((id, index) => [
      id,
      {
        schemaVersion: 1,
        trackId: id,
        editable: true,
        reason: null,
        format: 'mp3',
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
        fileRevision: `revision-${id}-1`,
        values: {
          title: ['Evening in the studio', 'Morning over the river', 'A quiet afternoon'][index]!,
          artist: ['Studio ensemble'],
          album: 'Small moments',
          albumArtist: ['Studio ensemble'],
          trackNumber: String(index + 1),
          year: '2026',
          genre: ['Instrumental'],
        },
        coverFrames: [],
        lyricsFrames: [{ selector: { language: 'eng', description: id }, text: `Original ${id}` }],
        lastVerifiedAt: 1,
      } as MetadataSnapshot,
    ]),
  );
  const jobs: MetadataJob[] = [];
  const operations = new Map<string, MetadataJob>();
  const intents = new Map<string, MetadataPatch>();
  const changes: MetadataChange[] = [];
  const songs = () =>
    [...snapshots.values()].map((item) => ({
      id: item.trackId,
      title: item.values.title ?? '',
      artist: item.values.artist.join(' / '),
      album: item.values.album ?? '',
      duration: 180,
      isDir: false,
    }));
  const json = (res: ServerResponse, value: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value));
    return true;
  };
  const fail = (res: ServerResponse, code = 'conflict') =>
    json(res, { schemaVersion: 1, error: { code } }, 409);
  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  const create = (input: MetadataJobRequest, parent: MetadataJob | undefined, mode: string) => {
    const previous = operations.get(input.operationId);
    if (previous) return previous;
    const job: MetadataJob = {
      id: `bulk-job-${jobs.length + 1}`,
      libraryId: 'music',
      createdAt: Date.now(),
      status: 'queued',
      kind: parent ? 'retry' : 'edit',
      parentJobId: parent?.id ?? null,
      items: input.targets.map((target, index) => ({
        itemId: `bulk-item-${jobs.length + 1}-${index}`,
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
    job.items.forEach((item) => intents.set(item.itemId, structuredClone(input.patch)));
    jobs.unshift(job);
    operations.set(input.operationId, job);
    setTimeout(() => {
      for (const item of job.items) {
        if (
          !parent &&
          ['bulk-partial', 'bulk-conflict'].includes(mode) &&
          item.currentTrackId === 'C'
        ) {
          item.stage = mode === 'bulk-conflict' ? 'conflict' : 'failed';
          item.errorCode = mode === 'bulk-conflict' ? 'revision_conflict' : 'write_failed';
          item.recoveryActions = ['retry'];
          continue;
        }
        const snapshot = snapshots.get(item.currentTrackId)!;
        const old = snapshot.fileRevision;
        for (const [field, change] of Object.entries(input.patch)) {
          if (field in snapshot.values) {
            const key = field as keyof typeof snapshot.values;
            Object.assign(snapshot.values, {
              [key]:
                change.op === 'clear'
                  ? Array.isArray(snapshot.values[key])
                    ? []
                    : null
                  : 'value' in change
                    ? change.value
                    : snapshot.values[key],
            });
          }
        }
        snapshot.fileRevision = `revision-${item.currentTrackId}-${changes.length + 2}`;
        item.stage = 'succeeded';
        item.fileSavedAt = Date.now();
        item.reflectedAt = Date.now();
        item.resultRevision = snapshot.fileRevision;
        changes.push({
          sequence: changes.length + 1,
          libraryId: 'music',
          oldTrackId: snapshot.trackId,
          newTrackId: snapshot.trackId,
          oldRevision: old,
          newRevision: snapshot.fileRevision,
          coverGeneration: snapshot.fileRevision,
          relatedIds: { trackIds: [snapshot.trackId], albumIds: [], artistIds: [], coverIds: [] },
          changedFields: item.changedFields,
          fileSavedAt: item.fileSavedAt,
          reflectedAt: item.reflectedAt,
          reflection: 'verified',
        });
      }
      job.status = job.items.some((item) => item.stage === 'failed' || item.stage === 'conflict')
        ? 'partial'
        : 'succeeded';
    }, 1200).unref();
    return job;
  };
  return async (req: IncomingMessage, res: ServerResponse, mode: string) => {
    const url = new URL(req.url!, 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    if (path === '/api/v1/music/folders/folder')
      return json(res, {
        schemaVersion: 1,
        directory: { id: 'folder', name: 'Studio collection', child: songs() },
      });
    if (path === '/api/v1/music/search')
      return json(res, { schemaVersion: 1, result: { song: songs(), artist: [], album: [] } });
    if (path.startsWith('/api/v1/music/songs/'))
      return json(res, {
        schemaVersion: 1,
        song: songs().find((item) => item.id === path.split('/').at(-1)),
      });
    if (/^\/api\/v1\/tracks\/[^/]+\/metadata$/.test(path)) {
      const item = snapshots.get(path.split('/')[4]!);
      if (!item) return fail(res, 'not_found');
      return json(res, {
        ...item,
        ...(mode === 'bulk-unsupported' && item.trackId === 'C'
          ? { editable: false, reason: 'read_only' }
          : {}),
      });
    }
    if (path === '/api/v1/metadata-previews') {
      const input = await read(req);
      if (
        input.targets.some(
          (target: { trackId: string; expectedRevision: string }) =>
            snapshots.get(target.trackId)?.fileRevision !== target.expectedRevision,
        )
      )
        return fail(res);
      const libraries = new Set(
        input.targets.map((target: { trackId: string }) =>
          mode === 'bulk-libraries' && target.trackId === 'C' ? 'second' : 'music',
        ),
      );
      if (libraries.size !== 1) return fail(res);
      return json(res, {
        schemaVersion: 1,
        libraryId: [...libraries][0],
        targetCount: input.targets.length,
        changedFields: Object.keys(input.patch),
        targets: input.targets.map((target: { trackId: string; expectedRevision: string }) => ({
          trackId: target.trackId,
          fileRevision: target.expectedRevision,
        })),
        writeGuaranteed: false,
      });
    }
    if (path === '/api/v1/metadata-jobs' && method === 'POST')
      return json(res, { schemaVersion: 1, job: create(await read(req), undefined, mode) }, 202);
    if (path === '/api/v1/metadata-jobs')
      return json(res, { schemaVersion: 1, jobs, nextCursor: null });
    if (path.startsWith('/api/v1/metadata-jobs/')) {
      const parts = path.split('/');
      const job = jobs.find((job) => job.id === parts[4]);
      if (!job) return fail(res, 'not_found');
      if (parts[5] === 'items' && parts[7] === 'intent') {
        const item = job.items.find((item) => item.itemId === parts[6]);
        return item
          ? json(res, {
              targets: [{ trackId: item.currentTrackId, expectedRevision: item.previousRevision }],
              patch: intents.get(item.itemId),
            })
          : fail(res, 'not_found');
      }
      if (parts[5] === 'retries' && method === 'POST') {
        const input = await read(req);
        const old = operations.get(input.operationId);
        if (old) return json(res, { schemaVersion: 1, job: old }, 202);
        const selected = input.items.map((entry: { itemId: string; expectedRevision: string }) => ({
          entry,
          item: job.items.find((item) => item.itemId === entry.itemId),
        }));
        if (
          !selected.length ||
          selected.some(
            ({
              entry,
              item,
            }: {
              entry: { expectedRevision: string };
              item: MetadataJob['items'][number];
            }) =>
              !item ||
              !['failed', 'conflict'].includes(item.stage) ||
              item.fileSavedAt !== null ||
              snapshots.get(item.currentTrackId)?.fileRevision !== entry.expectedRevision,
          )
        )
          return fail(res);
        return json(
          res,
          {
            schemaVersion: 1,
            job: create(
              {
                operationId: input.operationId,
                targets: selected.map(
                  ({
                    entry,
                    item,
                  }: {
                    entry: { expectedRevision: string };
                    item: MetadataJob['items'][number];
                  }) => ({
                    trackId: item.currentTrackId,
                    expectedRevision: entry.expectedRevision,
                  }),
                ),
                patch: intents.get(selected[0].item.itemId)!,
              },
              job,
              mode,
            ),
          },
          202,
        );
      }
      return json(res, { schemaVersion: 1, job });
    }
    if (path === '/api/v1/metadata-changes')
      return json(res, {
        schemaVersion: 1,
        changes,
        hasMore: false,
        nextCursor: `cursor-${changes.length}`,
      });
    if (path.startsWith('/api/v1/playlists')) {
      const summary = {
        id: 'duplicates',
        name: 'Studio repeats',
        owner: 'fixture-listener',
        public: false,
        editable: false,
        created: '2026-09-08T00:00:00Z',
        changed: '2026-09-08T00:00:00Z',
        revision: 'playlist-1',
        songCount: 3,
        duration: 540,
        coverState: 'fallback',
      };
      return path === '/api/v1/playlists'
        ? json(res, { schemaVersion: 1, playlists: [summary] })
        : json(res, {
            schemaVersion: 1,
            playlist: {
              ...summary,
              coverState: 'fallback',
              entries: [songs()[0], songs()[1], songs()[0]].map((song, position) => ({
                position,
                song,
              })),
              coverSongs: songs().slice(0, 2),
            },
          });
    }
    return false;
  };
}

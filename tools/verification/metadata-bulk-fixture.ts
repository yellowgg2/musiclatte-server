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
  const originals = new Map<string, MetadataSnapshot>();
  const seeded = new Set<string>();
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
  const create = (
    input: MetadataJobRequest,
    parent: MetadataJob | undefined,
    mode: string,
    original?: MetadataSnapshot,
  ) => {
    const previous = operations.get(input.operationId);
    if (previous) return previous;
    const job: MetadataJob = {
      id: `bulk-job-${jobs.length + 1}`,
      libraryId: 'music',
      createdAt: Date.now(),
      status: 'queued',
      kind: original ? 'restore' : parent ? 'retry' : 'edit',
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
    job.items.forEach((item) => {
      intents.set(item.itemId, structuredClone(input.patch));
      originals.set(item.itemId, structuredClone(snapshots.get(item.currentTrackId)!));
    });
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
        if (original) {
          snapshot.values = structuredClone(original.values);
          snapshot.lyricsFrames = structuredClone(original.lyricsFrames);
          snapshot.coverFrames = structuredClone(original.coverFrames);
        }
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
        item.restoreAvailable = true;
        item.recoveryActions = ['restore'];
        item.fileSavedAt = Date.now();
        item.reflectedAt = Date.now();
        item.resultRevision = snapshot.fileRevision;
        changes.push({
          sequence: changes.length + 1,
          libraryId: 'music',
          oldTrackId: snapshot.trackId,
          newTrackId: snapshot.trackId,
          identityResolution: 'unchanged',
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
    if (mode.startsWith('recovery') && !seeded.has(mode)) {
      seeded.add(mode);
      const scenario = mode.split(':')[1] ?? 'reflectingDelay';
      const old = structuredClone(snapshots.get('A')!);
      old.values.title = 'Original evening in the studio';
      old.values.year = '2024';
      snapshots.get('A')!.values.title = 'Current evening in the studio';
      if (scenario === 'long') {
        snapshots.get('A')!.values.title =
          'A long studio recording with detailed archival notes '.repeat(12);
        snapshots.get('A')!.lyricsFrames = [
          {
            selector: { language: 'eng', description: 'Studio lyric notes' },
            text: 'A synthetic lyric line for scroll and focus review.\n'.repeat(60),
          },
        ];
      }
      const unsaved = ['staleRevision', 'diskFull', 'workerRestart'].includes(scenario);
      const stage =
        scenario === 'staleRevision'
          ? 'conflict'
          : scenario === 'diskFull'
            ? 'failed'
            : scenario === 'workerRestart'
              ? 'recovery_required'
              : ['restoreConflict', 'restoreSucceeded', 'denied'].includes(scenario)
                ? 'succeeded'
                : 'reflecting';
      const id = `recovery-${scenario}`;
      const item: MetadataJob['items'][number] = {
        itemId: `${id}-item`,
        originalTrackId: 'A',
        currentTrackId: 'A',
        stage,
        fileSavedAt: unsaved ? null : Date.now() - 5000,
        reflectedAt: stage === 'succeeded' ? Date.now() : null,
        previousRevision: 'original-revision',
        resultRevision: unsaved ? null : snapshots.get('A')!.fileRevision,
        changedFields: ['title', 'year'],
        errorCode:
          scenario === 'staleRevision'
            ? 'revision_conflict'
            : scenario === 'diskFull'
              ? 'write_failed'
              : scenario === 'workerRestart'
                ? 'write_uncertain'
                : scenario === 'coverStale'
                  ? 'reflection_mismatch'
                  : scenario === 'idConflict'
                    ? 'reference_conflict'
                    : null,
        recoveryActions:
          scenario === 'denied'
            ? []
            : unsaved
              ? scenario === 'workerRestart'
                ? ['refresh']
                : ['retry', 'refresh']
              : ['recheck', 'restore'],
        restoreAvailable: !unsaved && scenario !== 'denied',
      };
      const job: MetadataJob = {
        id,
        libraryId: 'music',
        createdAt: Date.now() - 10000,
        status:
          stage === 'succeeded' ? 'succeeded' : stage === 'reflecting' ? 'reflecting' : 'failed',
        kind: 'edit',
        parentJobId: null,
        items: [item],
      };
      if (scenario === 'partial') {
        job.status = 'partial';
        item.stage = 'succeeded';
        item.reflectedAt = Date.now();
        const failed = {
          ...item,
          itemId: `${id}-failed`,
          originalTrackId: 'B',
          currentTrackId: 'B',
          stage: 'failed' as const,
          fileSavedAt: null,
          reflectedAt: null,
          resultRevision: null,
          errorCode: 'write_failed' as const,
          recoveryActions: ['retry', 'refresh'] as MetadataJob['items'][number]['recoveryActions'],
          restoreAvailable: false,
        };
        job.items.push(failed);
        originals.set(failed.itemId, structuredClone(snapshots.get('B')!));
        intents.set(failed.itemId, { year: { op: 'set', value: '2028' } });
      }
      jobs.unshift(job);
      originals.set(item.itemId, old);
      intents.set(item.itemId, {
        title: { op: 'set', value: 'Previously submitted evening title' },
      });
    }
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
      if (parts[5] === 'items' && parts[7] === 'restore-preview') {
        const item = job.items.find((item) => item.itemId === parts[6]);
        const original = item && originals.get(item.itemId);
        if (!item?.restoreAvailable || !original) return fail(res, 'forbidden');
        const current = snapshots.get(item.currentTrackId)!;
        return json(res, {
          schemaVersion: 1,
          jobId: job.id,
          itemId: item.itemId,
          backupCreatedAt: job.createdAt,
          current,
          currentCovers: [],
          original: { values: original.values, lyricsFrames: original.lyricsFrames, covers: [] },
        });
      }
      if (parts[5] === 'restores' && method === 'POST') {
        const input = await read(req);
        const previous = operations.get(input.operationId);
        if (previous) return json(res, { schemaVersion: 1, job: previous }, 202);
        const item = job.items.find((item) => item.itemId === input.itemId);
        const original = item && originals.get(item.itemId);
        if (!item?.restoreAvailable || !original) return fail(res, 'forbidden');
        if (
          mode === 'recovery:restoreConflict' ||
          snapshots.get(item.currentTrackId)!.fileRevision !== input.currentExpectedRevision
        )
          return fail(res);
        const restored = create(
          {
            operationId: input.operationId,
            targets: [
              { trackId: item.currentTrackId, expectedRevision: input.currentExpectedRevision },
            ],
            patch: {},
          },
          job,
          mode,
          original,
        );
        restored.items[0]!.changedFields = ['title', 'year'];
        return json(res, { schemaVersion: 1, job: restored }, 202);
      }
      if (parts[5] === 'rechecks' && method === 'POST') {
        const input = await read(req);
        const selected = job.items.filter((item) => input.itemIds.includes(item.itemId));
        if (
          !selected.length ||
          selected.some(
            (item) => item.fileSavedAt === null || !item.recoveryActions.includes('recheck'),
          )
        )
          return fail(res);
        for (const item of selected) {
          item.stage = 'reflecting';
          item.errorCode = null;
        }
        job.status = 'reflecting';
        if (!['recovery:coverStale', 'recovery:idConflict'].includes(mode))
          setTimeout(() => {
            for (const item of selected) {
              item.stage = 'succeeded';
              item.reflectedAt = Date.now();
              item.recoveryActions = ['restore'];
            }
            job.status = 'succeeded';
          }, 1200).unref();
        else
          for (const item of selected)
            item.errorCode =
              mode === 'recovery:idConflict' ? 'reference_conflict' : 'reflection_mismatch';
        return json(res, { schemaVersion: 1, job }, 202);
      }
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

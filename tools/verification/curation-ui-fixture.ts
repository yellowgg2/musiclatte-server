/** Source-only synthetic HTTP fixture. No production imports, identities or media. */
import {
  curationFields,
  type CurationTrack,
  type CurationList,
  type CurationDetail,
  type MetadataJob,
  type MetadataJobRequest,
  type MetadataValues,
} from '../../packages/contracts/src/index.js';
export function createCurationUIFixture(mode: () => string = () => 'normal', audio?: Buffer) {
  let signedIn = true;
  let revision = 1;
  let serial = 0;
  let lyrics = false;
  let album = 'Small moments';
  const jobs: MetadataJob[] = [];
  const requests: { path: string; method: string }[] = [];
  const json = (v: unknown, status = 200) =>
    Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
  const fail = (code: string, status: number) =>
    json({ schemaVersion: 1, error: { code, retryable: false } }, status);
  const tracks = (): CurationTrack[] =>
    Array.from({ length: 27 }, (_, i) => {
      const id = 'synthetic-' + String(i + 1).padStart(2, '0');
      const r = 'revision-' + revision;
      const completed = i !== 1;
      return {
        trackId: id,
        libraryId: 'music',
        format: 'mp3',
        title:
          mode() === 'long' && i === 2
            ? '긴 곡명 · A very long synthetic studio recording title with several movements '.repeat(
                4,
              )
            : i === 0
              ? 'Evening in the studio'
              : 'Studio track ' + (i + 1),
        artist: ['Studio ensemble'],
        fileRevision: r,
        curationStatus: completed ? 'completed' : 'needs_review',
        fieldStates: Object.fromEntries(
          curationFields.map((field) => [
            field,
            {
              status:
                field === 'lyrics'
                  ? lyrics && i === 0
                    ? 'present'
                    : i === 2
                      ? 'unavailable'
                      : 'missing'
                  : 'present',
              evidenceRevision: r,
              lastAttemptAt: field === 'lyrics' && i === 2 ? 1000 : null,
              lastUpdatedAt: 1000,
              reason:
                field === 'lyrics' && i === 2
                  ? mode() === 'long'
                    ? '승인된 자료를 찾지 못했습니다. No authorized source was found. '.repeat(8)
                    : 'No authorized source was found.'
                  : null,
              sourceNotes: null,
              actorRef: field === 'lyrics' && i === 2 ? 'Synthetic reviewer' : null,
            },
          ]),
        ) as CurationTrack['fieldStates'],
        lyricsState: lyrics && i === 0 ? 'present' : i === 2 ? 'unavailable' : 'missing',
        validation: mode() === 'inventory-pending' ? 'pending' : 'verified',
        lastVerifiedAt: 1000,
        receipt: completed
          ? {
              id: 'receipt-' + id,
              trackId: id,
              completedBy: {
                username: 'Synthetic reviewer',
                credentialKind: 'session',
                tokenId: null,
                clientLabel: null,
              },
              completedAt: 1000,
              verifiedRevision: 'revision-1',
              policyVersion: 'required-v1',
              sourceNotes: 'Required title and artist checked.',
            }
          : null,
      };
    });
  const coverage = () => [
    {
      libraryId: 'music',
      status: mode() === 'inventory-pending' ? ('partial' as const) : ('ready' as const),
      discoveredCount: 27,
      verifiedCount: mode() === 'inventory-pending' ? 1 : 27,
      unknownCount: mode() === 'inventory-pending' ? 26 : 0,
      lastDiscoveryAt: 1000,
      lastReconciledAt: 1000,
      lastErrorCode: null,
    },
  ];
  const snapshots = new Map<string, CurationList>();
  const values = (track: CurationTrack): MetadataValues => ({
    title: track.title,
    artist: track.artist,
    album,
    albumArtist: [],
    trackNumber: null,
    year: null,
    genre: [],
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://fixture');
    const path = url.pathname;
    const method = init?.method ?? 'GET';
    const state = mode();
    requests.push({ path, method });
    const body = () => JSON.parse(String(init?.body ?? '{}'));
    if (path === '/api/v1/session') {
      if (method === 'DELETE') {
        signedIn = false;
        return new Response(null, { status: 204 });
      }
      if (method === 'POST') signedIn = true;
      return !signedIn
        ? fail('unauthenticated', 401)
        : json({
            schemaVersion: 1,
            authScheme: 'cookie',
            username: 'Synthetic listener',
            csrfToken: 'fixture-csrf',
            expiresAt: Date.now() + 3600000,
          });
    }
    if (!signedIn) return fail('unauthenticated', 401);
    if (path === '/api/v1/capabilities')
      return json({
        schemaVersion: 1,
        instanceId: 'curation-source-only-fixture',
        revision: state,
        features: Object.fromEntries(
          [
            'music.browse',
            'music.stream',
            'metadata.write',
            'metadata.lyrics.write',
            'metadata.curation',
          ].map((key) => [
            key,
            {
              supported: true,
              permission: key === 'metadata.curation' && state === 'denied' ? 'denied' : 'allowed',
              availability:
                key === 'metadata.curation' && state === 'unavailable'
                  ? 'temporarily_unavailable'
                  : 'available',
            },
          ]),
        ),
      });
    if (method !== 'GET' && new Headers(init?.headers).get('x-csrf-token') !== 'fixture-csrf')
      return fail('csrf_rejected', 403);
    if (path === '/api/v1/tracks') {
      if (state === 'scope-denied') return fail('forbidden', 403);
      if (state === 'list-error') return fail('upstream_unavailable', 503);
      const q = url.searchParams;
      const cursor = q.get('cursor');
      if (cursor) {
        if (state === 'snapshot-expired') return fail('snapshot_expired', 409);
        const snapshot = snapshots.get(cursor);
        if (!snapshot) return fail('snapshot_scope_changed', 409);
        return json({ ...snapshot, tracks: snapshot.tracks.slice(25), nextCursor: null });
      }
      let selected = tracks().filter(
        (t) =>
          (!q.get('curationStatus') || t.curationStatus === q.get('curationStatus')) &&
          (!q.get('format') || t.format === q.get('format')) &&
          (!q.get('libraryId') || t.libraryId === q.get('libraryId')),
      );
      const field = q.get('field') as 'album' | 'cover' | 'lyrics' | null;
      if (field && q.get('fieldStatus'))
        selected = selected.filter((t) => t.fieldStates[field].status === q.get('fieldStatus'));
      const id = 'snapshot-' + ++serial;
      const page: CurationList = {
        schemaVersion: 1,
        snapshotId: id,
        asOf: Date.now(),
        expiresAt: Date.now() + 60000,
        total: selected.length,
        nextCursor: selected.length > 25 ? id : null,
        coverage: coverage(),
        tracks: selected,
      };
      snapshots.set(id, page);
      return json({ ...page, tracks: selected.slice(0, 25) });
    }
    const track = tracks().find(
      (t) => path.includes('/' + t.trackId + '/') || path.endsWith('/' + t.trackId),
    );
    if (track && path.endsWith('/curation')) {
      const detail: CurationDetail = {
        schemaVersion: 1,
        track,
        coverage: coverage(),
        activeClaim:
          state === 'claim-conflict'
            ? {
                id: 'other-claim',
                purpose: 'optional_enrichment',
                fields: ['lyrics'],
                generation: 1,
                leaseUntil: Date.now() + 60000,
              }
            : null,
        activeWork: [],
        history: [],
        nextCursor: null,
      };
      return json(detail);
    }
    if (track && path.endsWith('/metadata'))
      return json({
        schemaVersion: 1,
        trackId: track.trackId,
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
        fileRevision: 'revision-' + revision,
        values: values(track),
        coverFrames: [],
        lyricsFrames: lyrics
          ? [{ selector: { language: 'und', description: '' }, text: 'Original synthetic words' }]
          : [],
        lastVerifiedAt: Date.now(),
      });
    if (path === '/api/v1/metadata-previews')
      return json({
        schemaVersion: 1,
        libraryId: 'music',
        targetCount: body().targets.length,
        changedFields: Object.keys(body().patch),
        targets: body().targets.map((t: { trackId: string; expectedRevision: string }) => ({
          trackId: t.trackId,
          fileRevision: t.expectedRevision,
        })),
        writeGuaranteed: false,
      });
    if (path === '/api/v1/metadata-jobs' && method === 'POST') {
      const input = body() as MetadataJobRequest;
      const now = Date.now();
      const failed = state === 'claim-conflict';
      const partial = state === 'partial-failure';
      const job: MetadataJob = {
        id: 'job-' + ++serial,
        libraryId: 'music',
        createdAt: now,
        status: failed ? 'failed' : partial ? 'partial' : 'succeeded',
        kind: 'edit',
        parentJobId: null,
        items: input.targets.map((target, index) => ({
          itemId: 'item-' + index,
          originalTrackId: target.trackId,
          currentTrackId: target.trackId,
          stage: failed ? 'conflict' : 'succeeded',
          fileSavedAt: failed ? null : now,
          reflectedAt: failed ? null : now,
          previousRevision: target.expectedRevision,
          resultRevision: failed ? null : 'revision-' + (revision + 1),
          changedFields: Object.keys(input.patch) as MetadataJob['items'][number]['changedFields'],
          errorCode: failed ? 'claimed_by_other' : null,
          recoveryActions: [],
          restoreAvailable: false,
        })),
      };
      if (partial)
        job.items.push({
          ...job.items[0]!,
          itemId: 'item-failed',
          originalTrackId: 'synthetic-02',
          currentTrackId: 'synthetic-02',
          stage: 'failed',
          fileSavedAt: null,
          reflectedAt: null,
          resultRevision: null,
          errorCode: 'write_failed',
        });
      jobs.unshift(job);
      if (!failed) {
        if (input.patch.album)
          album = input.patch.album.op === 'set' ? input.patch.album.value : '';
        if (input.patch.lyrics) lyrics = input.patch.lyrics.op === 'set';
        revision++;
      }
      return json({ schemaVersion: 1, job }, 202);
    }
    if (path === '/api/v1/metadata-jobs') return json({ schemaVersion: 1, jobs, nextCursor: null });
    if (path.startsWith('/api/v1/metadata-jobs/')) {
      const job = jobs.find((j) => j.id === path.split('/').at(-1));
      return job ? json({ schemaVersion: 1, job }) : fail('not_found', 404);
    }
    if (path === '/api/v1/metadata-changes')
      return json({
        schemaVersion: 1,
        changes:
          revision === 1
            ? []
            : [
                {
                  sequence: revision,
                  libraryId: 'music',
                  oldTrackId: 'synthetic-01',
                  newTrackId: 'synthetic-01',
                  identityResolution: 'unchanged',
                  oldRevision: 'revision-' + (revision - 1),
                  newRevision: 'revision-' + revision,
                  coverGeneration: 'revision-' + revision,
                  relatedIds: {
                    trackIds: ['synthetic-01'],
                    albumIds: [],
                    artistIds: [],
                    coverIds: [],
                  },
                  changedFields: ['album', 'lyrics'],
                  fileSavedAt: Date.now(),
                  reflectedAt: Date.now(),
                  reflection: 'verified',
                },
              ],
        hasMore: false,
        nextCursor: 'cursor-' + revision,
      });
    const song = (t: CurationTrack) => ({
      id: t.trackId,
      title: t.title!,
      artist: t.artist.join(' / '),
      album,
      duration: 180,
      isDir: false,
    });
    if (path.startsWith('/api/v1/music/songs/') && track)
      return json({ schemaVersion: 1, song: song(track) });
    if (path === '/api/v1/music/folders' && !url.searchParams.has('musicFolderId'))
      return json({ schemaVersion: 1, folders: [{ id: 'music', name: 'Studio collection' }] });
    if (path === '/api/v1/music/folders')
      return json({
        schemaVersion: 1,
        indexes: {
          index: [{ name: 'S', artist: [{ id: 'folder', name: 'Studio collection', album: [] }] }],
        },
      });
    if (path === '/api/v1/music/folders/folder')
      return json({
        schemaVersion: 1,
        directory: {
          id: 'folder',
          name: 'Studio collection',
          child: tracks().slice(0, 2).map(song),
        },
      });
    if (path.endsWith('/stream')) {
      if (audio) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(new Headers(init?.headers).get('range') ?? '');
        const start = range ? Number(range[1]) : 0;
        const end =
          range && range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
        if (start > end || start >= audio.length) return new Response(null, { status: 416 });
        return new Response(Uint8Array.from(audio.subarray(start, end + 1)), {
          status: range ? 206 : 200,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Accept-Ranges': 'bytes',
            'Content-Length': String(end - start + 1),
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}),
          },
        });
      }
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
      return new Response(wav, {
        headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(wav.length) },
      });
    }
    return fail('not_found', 404);
  };
  return { fetcher, requests, tracks };
}

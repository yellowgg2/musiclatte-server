import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  decodeId3OrganizationManifest,
  readPrivateToken,
  runId3OrganizeCommand,
} from '../../tools/id3-organize-client.js';
import {
  checkpointId3OrganizationBatch,
  createId3OrganizationBatchJournal,
  id3OrganizationBatchBinding,
  nextId3OrganizationBatchItem,
  readId3OrganizationBatchJournal,
} from '../../tools/id3-organize-batch-journal.js';

const privateFile = (name: string, value: string) => {
  const root = mkdtempSync(join(tmpdir(), 'musiclatte-id3-client-'));
  const path = join(root, name);
  writeFileSync(path, value, { mode: 0o600 });
  return path;
};

it('accepts only a private non-symlink token file and never returns the token', () => {
  const token = 'mlpat_' + 'a'.repeat(48);
  const path = privateFile('token', token + '\n');
  expect(readPrivateToken(path)).toBe(token);
  chmodSync(path, 0o644);
  expect(() => readPrivateToken(path)).toThrow('client_failed:private_token');
  const link = path + '-link';
  symlinkSync(path, link);
  expect(() => readPrivateToken(link)).toThrow('client_failed:private_token');
});

it('strictly decodes verified values, evidence, cover usage and rejects unknown fields', () => {
  const manifest = {
    schemaVersion: 1,
    metadata: {
      album: 'Verified album',
      albumArtist: ['Verified artist'],
      trackNumber: '2/10',
      year: '2024',
      genre: ['Pop'],
    },
    sourceEvidence: [
      {
        url: 'https://artist.example/releases/verified',
        kind: 'official_artist',
        fields: ['album', 'albumArtist', 'trackNumber', 'year', 'genre'],
      },
    ],
    cover: {
      path: '/private/verified-cover.jpg',
      usageBasis: 'Official promotional artwork supplied for this release.',
    },
  };
  expect(decodeId3OrganizationManifest(manifest)).toEqual(manifest);
  expect(() => decodeId3OrganizationManifest({ ...manifest, guessedComposer: 'unknown' })).toThrow(
    'client_failed:manifest',
  );
  expect(() =>
    decodeId3OrganizationManifest({
      ...manifest,
      sourceEvidence: [{ ...manifest.sourceEvidence[0], url: 'http://artist.example' }],
    }),
  ).toThrow('client_failed:manifest');
});

it('uploads the optional cover after a successful required metadata step', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'musiclatte-two-step-cover-'));
  const token = 'mlpat_' + 'z'.repeat(48);
  const tokenFile = join(directory, 'token');
  const stateFile = join(directory, 'batch.json');
  const coverPath = join(directory, 'cover.jpg');
  writeFileSync(tokenFile, token, { mode: 0o600 });
  writeFileSync(coverPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { mode: 0o600 });
  createId3OrganizationBatchJournal({
    path: stateFile,
    api: 'https://music.example/api/v1',
    token,
    selection: {
      schemaVersion: 1,
      capturedAt: 1,
      source: { kind: 'favorites' },
      selectionRevision: 'a'.repeat(64),
      occurrenceCount: 1,
      uniqueTrackCount: 1,
      items: [
        {
          trackId: 'old',
          title: 'Old title',
          artist: 'Artist',
          album: null,
          occurrenceIndexes: [0],
        },
      ],
    },
  });
  nextId3OrganizationBatchItem(stateFile);
  checkpointId3OrganizationBatch(stateFile, 'old', {
    kind: 'metadata',
    step: 'required',
    jobId: 'required-job',
    resultRevision: 'required-revision',
    serverStage: 'succeeded',
  });
  const result = await runId3OrganizeCommand({
    api: 'https://music.example/api/v1',
    tokenFile,
    stateFile,
    command: 'cover-upload',
    trackId: 'old',
    libraryId: 'music',
    manifest: {
      schemaVersion: 1,
      metadata: { album: 'Album' },
      sourceEvidence: [
        { url: 'https://artist.example/release', kind: 'official_artist', fields: ['album'] },
      ],
      cover: { path: coverPath, usageBasis: 'Private library' },
    },
    fetch: async () =>
      Response.json(
        {
          schemaVersion: 1,
          uploadId: 'optional-cover-upload',
          libraryId: 'music',
          mimeType: 'image/jpeg',
          size: 4,
          expiresAt: 2,
          previewUrl: '/api/v1/metadata-covers/optional-cover-upload',
        },
        { status: 201 },
      ),
  });
  expect(result.uploadId).toBe('optional-cover-upload');
});

/** A failed unsaved metadata checkpoint resumes through one stable child retry intent. */
it('retries a failed batch metadata job and checkpoints its child job', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'musiclatte-metadata-retry-'));
  const token = 'mlpat_' + 'r'.repeat(48);
  const tokenFile = join(directory, 'token');
  const stateFile = join(directory, 'batch.json');
  writeFileSync(tokenFile, token, { mode: 0o600 });
  createId3OrganizationBatchJournal({
    path: stateFile,
    api: 'https://music.example/api/v1',
    token,
    selection: {
      schemaVersion: 1,
      capturedAt: 1,
      source: { kind: 'favorites' },
      selectionRevision: 'a'.repeat(64),
      occurrenceCount: 1,
      uniqueTrackCount: 1,
      items: [
        {
          trackId: 'track-1',
          title: 'Title',
          artist: 'Artist',
          album: null,
          occurrenceIndexes: [0],
        },
      ],
    },
  });
  nextId3OrganizationBatchItem(stateFile);
  checkpointId3OrganizationBatch(stateFile, 'track-1', {
    kind: 'metadata',
    step: 'optional',
    jobId: 'failed-job',
    resultRevision: null,
    serverStage: 'failed',
  });
  const item = (jobId: string, stage: string, errorCode: string | null) => ({
    schemaVersion: 1,
    job: {
      id: jobId,
      libraryId: 'music',
      createdAt: 1,
      status: stage,
      kind: jobId === 'failed-job' ? 'edit' : 'retry',
      parentJobId: jobId === 'failed-job' ? null : 'failed-job',
      items: [
        {
          itemId: jobId + '-item',
          originalTrackId: 'track-1',
          currentTrackId: 'track-1',
          stage,
          fileSavedAt: null,
          reflectedAt: null,
          previousRevision: 'revision-1',
          resultRevision: null,
          changedFields: ['album'],
          errorCode,
          recoveryActions: stage === 'failed' ? ['retry'] : [],
          restoreAvailable: false,
        },
      ],
    },
  });
  const retryBodies: string[] = [];
  let retryAttempts = 0;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/metadata-jobs/failed-job') && init?.method === undefined)
      return Response.json(item('failed-job', 'failed', 'write_failed'));
    if (url.pathname.endsWith('/metadata-jobs/failed-job/retries')) {
      retryBodies.push(String(init?.body));
      retryAttempts++;
      if (retryAttempts === 1) throw new TypeError('lost response');
      return Response.json(item('retry-job', 'queued', null), { status: 202 });
    }
    throw new Error('unexpected request');
  });
  const result = await runId3OrganizeCommand({
    api: 'https://music.example/api/v1',
    tokenFile,
    stateFile,
    fetch: fetcher,
    command: 'metadata-retry',
    trackId: 'track-1',
  });
  expect(result.job.id).toBe('retry-job');
  expect(retryBodies).toHaveLength(2);
  expect(retryBodies[1]).toBe(retryBodies[0]);
  expect(id3OrganizationBatchBinding(stateFile, 'track-1').metadataSteps.optional).toMatchObject({
    jobId: 'retry-job',
    serverStage: 'queued',
    resultRevision: null,
  });
});

it('uses Authorization only as a header and supports candidate, inspect and previews', async () => {
  const token = 'mlpat_' + 'b'.repeat(48);
  const tokenFile = privateFile('token', token);
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    if (String(input).includes('/candidates'))
      return Response.json({
        schemaVersion: 1,
        candidates: [
          {
            trackId: 'track-1',
            libraryId: 'music',
            title: 'Exact title',
            artist: ['Artist'],
            album: 'Album',
            currentRevision: 'revision-1',
            importSourceId: 'source-1',
          },
        ],
        total: 1,
      });
    if (String(input).includes('/metadata-organization/previews'))
      return Response.json({
        schemaVersion: 1,
        trackId: 'track-1',
        libraryId: 'music',
        currentRevision: 'revision-1',
        currentKey: 'imports/source.mp3',
        targetKey: 'jojo-music/account/Artist/Album/01 - Exact title.mp3',
        writeGuaranteed: false,
        status: 'ready',
        code: null,
      });
    return Response.json({
      schemaVersion: 1,
      trackId: 'track-1',
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
      fileRevision: 'revision-1',
      values: {
        title: 'Exact title',
        artist: ['Artist'],
        album: 'Album',
        albumArtist: ['Artist'],
        trackNumber: '1',
        year: '2024',
        genre: ['Pop'],
      },
      coverFrames: [],
      lyricsFrames: [],
      lastVerifiedAt: 1,
    });
  });
  const common = { api: 'https://music.example/api/v1', tokenFile, fetch: fetcher };
  await runId3OrganizeCommand({ ...common, command: 'candidates', title: 'Exact title' });
  await runId3OrganizeCommand({ ...common, command: 'inspect', trackId: 'track-1' });
  await runId3OrganizeCommand({
    ...common,
    command: 'organization-preview',
    trackId: 'track-1',
    revision: 'revision-1',
  });
  expect(calls).toHaveLength(3);
  for (const call of calls) {
    expect(call.url).not.toContain(token);
    expect(call.init?.headers).toMatchObject({ authorization: `Bearer ${token}` });
    expect(JSON.stringify(call.init?.body ?? '')).not.toContain(token);
  }
});

it('replays lost submits and bounds server-owned recovery retries', async () => {
  const tokenFile = privateFile('token', 'mlpat_' + 'c'.repeat(48));
  let submits = 0;
  let status = 0;
  let retries = 0;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/metadata-organization-jobs') && init?.method === 'POST') {
      submits++;
      if (submits === 1) throw new TypeError('lost response');
      return Response.json(
        {
          schemaVersion: 1,
          job: {
            id: 'job-1',
            itemId: 'item-1',
            libraryId: 'music',
            trackId: 'track-1',
            newTrackId: null,
            stage: 'queued',
            errorCode: null,
            nextOwner: 'filesystem',
          },
        },
        { status: 202 },
      );
    }
    if (url.endsWith('/metadata-organization-jobs/job-1/retries')) {
      retries++;
      return Response.json(
        {
          schemaVersion: 1,
          job: {
            id: 'job-1',
            itemId: 'item-1',
            libraryId: 'music',
            trackId: 'track-1',
            newTrackId: null,
            stage: 'queued',
            errorCode: null,
            nextOwner: 'filesystem',
          },
        },
        { status: 202 },
      );
    }
    status++;
    return Response.json({
      schemaVersion: 1,
      job: {
        id: 'job-1',
        itemId: 'item-1',
        libraryId: 'music',
        trackId: 'track-1',
        newTrackId: status > 2 ? 'track-2' : null,
        stage: status <= 2 ? 'recovery_required' : 'succeeded',
        errorCode: status <= 2 ? 'scan_unavailable' : null,
        nextOwner: status <= 2 ? 'gonic' : null,
      },
    });
  });
  const result = await runId3OrganizeCommand({
    api: 'https://music.example/api/v1',
    tokenFile,
    fetch: fetcher,
    sleep: async () => {},
    command: 'organization-submit',
    trackId: 'track-1',
    revision: 'revision-1',
    metadataJobId: 'metadata-job-1',
    sourceEvidence: [
      { url: 'https://artist.example/release', kind: 'official_artist', fields: ['title'] },
    ],
    operationId: 'operation_submit_000001',
    poll: { attempts: 4, intervalMs: 1, recoveryRetries: 1 },
  });
  expect(result.job.stage).toBe('succeeded');
  expect(submits).toBe(2);
  expect(retries).toBe(1);
  expect(status).toBe(3);
});

/** A replay may already be terminal before the client receives its accepted response. */
it('checkpoints an already-succeeded organization replay exactly once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'musiclatte-organization-replay-'));
  const token = 'mlpat_' + 's'.repeat(48);
  const tokenFile = join(directory, 'token');
  const stateFile = join(directory, 'batch.json');
  writeFileSync(tokenFile, token, { mode: 0o600 });
  createId3OrganizationBatchJournal({
    path: stateFile,
    api: 'https://music.example/api/v1',
    token,
    selection: {
      schemaVersion: 1,
      capturedAt: 1,
      source: { kind: 'favorites' },
      selectionRevision: 'a'.repeat(64),
      occurrenceCount: 1,
      uniqueTrackCount: 1,
      items: [
        {
          trackId: 'old',
          title: 'Title',
          artist: 'Artist',
          album: null,
          occurrenceIndexes: [0],
        },
      ],
    },
  });
  nextId3OrganizationBatchItem(stateFile);
  checkpointId3OrganizationBatch(stateFile, 'old', {
    kind: 'metadata',
    step: 'optional',
    jobId: 'metadata-job',
    resultRevision: 'metadata-revision',
    serverStage: 'succeeded',
  });
  const fetcher = vi.fn(async () =>
    Response.json(
      {
        schemaVersion: 1,
        job: {
          id: 'organization-job',
          itemId: 'organization-item',
          libraryId: 'music',
          trackId: 'old',
          newTrackId: 'new',
          stage: 'succeeded',
          errorCode: null,
          nextOwner: null,
        },
      },
      { status: 202 },
    ),
  );
  const result = await runId3OrganizeCommand({
    api: 'https://music.example/api/v1',
    tokenFile,
    stateFile,
    fetch: fetcher,
    sleep: async () => {},
    command: 'organization-submit',
    trackId: 'old',
    revision: 'metadata-revision',
    metadataJobId: 'metadata-job',
    sourceEvidence: [
      { url: 'https://artist.example/release', kind: 'official_artist', fields: ['title'] },
    ],
    poll: { attempts: 1, intervalMs: 0, recoveryRetries: 0 },
  });
  expect(result.job).toMatchObject({ stage: 'succeeded', newTrackId: 'new' });
  expect(readId3OrganizationBatchJournal(stateFile).items[0]).toMatchObject({
    state: 'succeeded',
    organizationJobId: 'organization-job',
    newTrackId: 'new',
    serverStage: 'succeeded',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('snapshots and restores current-account favorite and duplicate playlist references', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'musiclatte-reference-client-'));
  const tokenFile = join(directory, 'token');
  const referenceFile = join(directory, 'references.json');
  writeFileSync(tokenFile, 'mlpat_' + 'g'.repeat(48), { mode: 0o600 });
  let favoriteIds = ['old'];
  let playlistIds = ['old', 'B', 'old'];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/metadata-organization/reference-snapshots'))
      return Response.json({
        schemaVersion: 1,
        trackId: 'old',
        starred: true,
        playlists: [{ id: 'owned', name: 'Owned', owner: 'listener', songIds: [...playlistIds] }],
      });
    if (url.pathname.endsWith('/metadata-organization/reference-restores')) {
      const body = JSON.parse(String(init?.body));
      favoriteIds = ['new'];
      playlistIds = body.playlists[0].songIds.map((id: string) => (id === 'old' ? 'new' : id));
      return Response.json({
        schemaVersion: 1,
        trackId: 'old',
        newTrackId: 'new',
        starred: true,
        playlistsRestored: 1,
      });
    }
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${url.pathname}`);
  });
  const common = {
    api: 'https://music.example/api/v1',
    tokenFile,
    referenceFile,
    trackId: 'old',
    fetch: fetcher,
  };
  await runId3OrganizeCommand({ ...common, command: 'references-snapshot' });
  playlistIds = ['B'];
  favoriteIds = [];
  const restored = await runId3OrganizeCommand({
    ...common,
    command: 'references-restore',
    newTrackId: 'new',
  });
  expect(restored).toEqual({ schemaVersion: 1, favoriteRestored: true, playlistsRestored: 1 });
  expect(favoriteIds).toEqual(['new']);
  expect(playlistIds).toEqual(['new', 'B', 'new']);
  for (const [input, init] of fetcher.mock.calls) {
    expect(String(input)).not.toContain('mlpat_');
    expect(String(init?.body ?? '')).not.toContain('mlpat_');
  }
});

it('restores and adopts a verified successor for an untouched frozen favorite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'musiclatte-shared-successor-'));
  const token = 'mlpat_' + 'h'.repeat(48);
  const tokenFile = join(directory, 'token');
  const stateFile = join(directory, 'batch.json');
  writeFileSync(tokenFile, token, { mode: 0o600 });
  createId3OrganizationBatchJournal({
    path: stateFile,
    api: 'https://music.example/api/v1',
    token,
    selection: {
      schemaVersion: 1,
      capturedAt: 1,
      source: { kind: 'favorites' },
      selectionRevision: 'a'.repeat(64),
      occurrenceCount: 1,
      uniqueTrackCount: 1,
      items: [
        {
          trackId: 'old',
          title: 'Exact title',
          artist: 'Artist',
          album: 'Unknown Album',
          occurrenceIndexes: [0],
        },
      ],
    },
  });
  nextId3OrganizationBatchItem(stateFile);
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/metadata-organization/candidates'))
      return Response.json({
        schemaVersion: 1,
        candidates: [
          {
            trackId: 'new',
            libraryId: 'music',
            title: 'Exact title',
            artist: ['Artist'],
            album: 'Album',
            currentRevision: 'revision-new',
            importSourceId: null,
          },
        ],
        total: 1,
      });
    if (url.pathname.endsWith('/tracks/new/metadata'))
      return Response.json({
        schemaVersion: 1,
        trackId: 'new',
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
        fileRevision: 'revision-new',
        values: {
          title: 'Exact title',
          artist: ['Artist'],
          album: 'Album',
          albumArtist: ['Artist'],
          trackNumber: '1/1',
          year: '2024',
          genre: ['Pop'],
        },
        coverFrames: [
          {
            frameId: 'cover',
            pictureType: 3,
            description: '',
            mimeType: 'image/jpeg',
            previewUrl: '/api/v1/cover',
          },
        ],
        lyricsFrames: [],
        lastVerifiedAt: 1,
      });
    if (url.pathname.endsWith('/metadata-organization/reference-restores')) {
      return Response.json({
        schemaVersion: 1,
        trackId: 'old',
        newTrackId: 'new',
        starred: true,
        playlistsRestored: 0,
      });
    }
    throw new Error('unexpected request');
  });
  const result = await runId3OrganizeCommand({
    api: 'https://music.example/api/v1',
    tokenFile,
    stateFile,
    fetch: fetcher,
    command: 'batch-adopt-successor',
    trackId: 'old',
    newTrackId: 'new',
    manifest: {
      schemaVersion: 1,
      metadata: {
        title: 'Exact title',
        artist: ['Artist'],
        album: 'Album',
        albumArtist: ['Artist'],
        trackNumber: '1/1',
        year: '2024',
        genre: ['Pop'],
      },
      sourceEvidence: [
        { url: 'https://artist.example/release', kind: 'official_artist', fields: ['title'] },
      ],
      cover: { path: '/private/cover.jpg', usageBasis: 'Private library' },
    },
  });
  expect(result).toEqual({ schemaVersion: 1, status: 'succeeded', favoriteRestored: true });
});

/** Releases the short-lived curation reservation as soon as the metadata job is accepted. */
it('releases an accepted metadata claim before returning to the organizer', async () => {
  const tokenFile = privateFile('token', 'mlpat_' + 'd'.repeat(48));
  const calls: { method: string; url: string }[] = [];
  let releaseAttempts = 0;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    if (url.endsWith('/curation-claims'))
      return Response.json({
        schemaVersion: 1,
        claimId: 'claim-1',
        leaseUntil: Date.now() + 600_000,
        generation: 1,
        results: [{ trackId: 'track-1', status: 'granted' }],
      });
    if (url.endsWith('/metadata-jobs'))
      return Response.json(
        {
          schemaVersion: 1,
          job: {
            id: 'job-1',
            libraryId: 'music',
            createdAt: Date.now(),
            status: 'queued',
            kind: 'edit',
            parentJobId: null,
            items: [
              {
                itemId: 'item-1',
                originalTrackId: 'track-1',
                currentTrackId: 'track-1',
                stage: 'queued',
                fileSavedAt: null,
                reflectedAt: null,
                previousRevision: 'revision-1',
                resultRevision: null,
                changedFields: ['title'],
                errorCode: null,
                recoveryActions: [],
                restoreAvailable: false,
              },
            ],
          },
          admissionResults: [{ trackId: 'track-1', status: 'accepted', jobItemId: 'item-1' }],
        },
        { status: 202 },
      );
    if (url.endsWith('/curation-claims/claim-1') && method === 'DELETE') {
      releaseAttempts++;
      if (releaseAttempts === 1) throw new TypeError('lost release response');
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected request');
  });

  const result = await runId3OrganizeCommand({
    api: 'https://music.example/api/v1',
    tokenFile,
    fetch: fetcher,
    command: 'metadata-submit',
    trackId: 'track-1',
    revision: 'revision-1',
    manifest: {
      schemaVersion: 1,
      metadata: { title: 'Verified title' },
      sourceEvidence: [
        { url: 'https://artist.example/release', kind: 'official_artist', fields: ['title'] },
      ],
    },
    operationId: 'operation_metadata_000001',
  });

  expect(result.job?.id).toBe('job-1');
  expect(calls.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([
    'POST /api/v1/curation-claims',
    'POST /api/v1/metadata-jobs',
    'DELETE /api/v1/curation-claims/claim-1',
    'DELETE /api/v1/curation-claims/claim-1',
  ]);
});

/** Releases the reservation even when metadata admission fails after the claim was granted. */
it('releases a metadata claim when submission fails', async () => {
  const tokenFile = privateFile('token', 'mlpat_' + 'e'.repeat(48));
  const methods: string[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    methods.push(`${method} ${new URL(url).pathname}`);
    if (url.endsWith('/curation-claims'))
      return Response.json({
        schemaVersion: 1,
        claimId: 'claim-2',
        leaseUntil: Date.now() + 600_000,
        generation: 1,
        results: [{ trackId: 'track-1', status: 'granted' }],
      });
    if (url.endsWith('/metadata-jobs')) return Response.json({ code: 'conflict' }, { status: 409 });
    if (url.endsWith('/curation-claims/claim-2') && method === 'DELETE')
      return new Response(null, { status: 204 });
    throw new Error('unexpected request');
  });

  await expect(
    runId3OrganizeCommand({
      api: 'https://music.example/api/v1',
      tokenFile,
      fetch: fetcher,
      command: 'metadata-submit',
      trackId: 'track-1',
      revision: 'revision-1',
      manifest: {
        schemaVersion: 1,
        metadata: { title: 'Verified title' },
        sourceEvidence: [
          { url: 'https://artist.example/release', kind: 'official_artist', fields: ['title'] },
        ],
      },
      operationId: 'operation_metadata_000002',
    }),
  ).rejects.toThrow('client_failed:http_409');
  expect(methods).toEqual([
    'POST /api/v1/curation-claims',
    'POST /api/v1/metadata-jobs',
    'DELETE /api/v1/curation-claims/claim-2',
  ]);
});

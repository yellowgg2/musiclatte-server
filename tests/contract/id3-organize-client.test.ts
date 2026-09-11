import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  decodeId3OrganizationManifest,
  readPrivateToken,
  runId3OrganizeCommand,
} from '../../tools/id3-organize-client.js';

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

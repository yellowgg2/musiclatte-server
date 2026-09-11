import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runId3OrganizeCommand } from '../../tools/id3-organize-client.js';

async function batchModule() {
  return import('../../tools/id3-organize-batch-journal.js').catch(() => ({}));
}

const selection = {
  schemaVersion: 1 as const,
  capturedAt: 1000,
  source: { kind: 'playlist' as const, playlistId: 'pl-1', name: 'Synthetic List' },
  selectionRevision: 'a'.repeat(64),
  occurrenceCount: 3,
  uniqueTrackCount: 2,
  items: [
    {
      trackId: 'A',
      title: 'A title',
      artist: 'Artist',
      album: 'Album',
      occurrenceIndexes: [0, 2],
    },
    {
      trackId: 'B',
      title: 'B title',
      artist: null,
      album: null,
      occurrenceIndexes: [1],
    },
  ],
};

function paths() {
  const root = mkdtempSync(join(tmpdir(), 'musiclatte-batch-'));
  return { root, stateFile: join(root, 'batch.json') };
}

describe('private ID3 organization batch journal', () => {
  it('creates a strict private journal with stable IDs and one item per unique track', async () => {
    const module = await batchModule();
    expect(module).toHaveProperty('createId3OrganizationBatchJournal');
    if (!('createId3OrganizationBatchJournal' in module)) return;
    const { stateFile } = paths();
    const journal = module.createId3OrganizationBatchJournal({
      path: stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 's'.repeat(48),
      selection,
    });
    expect(lstatSync(stateFile).mode & 0o777).toBe(0o600);
    expect(journal.items).toHaveLength(2);
    expect(journal.items[0]).toMatchObject({
      trackId: 'A',
      occurrenceIndexes: [0, 2],
      state: 'pending',
    });
    expect(journal.items[0]!.operations).toEqual({
      cover: expect.any(String),
      metadata: expect.any(String),
      organization: expect.any(String),
    });
    const serialized = readFileSync(stateFile, 'utf8');
    expect(serialized).not.toMatch(/mlpat_|\/private|sourceEvidence|usageBasis|lyrics|\.jpg/);
    expect(module.decodeId3OrganizationBatchJournal(JSON.parse(serialized))).toEqual(journal);
    expect(() => module.decodeId3OrganizationBatchJournal({ ...journal, token: 'secret' })).toThrow(
      'client_failed:journal_invalid',
    );

    const favoriteState = paths().stateFile;
    expect(
      module.createId3OrganizationBatchJournal({
        path: favoriteState,
        api: 'https://music.example/api/v1',
        token: 'mlpat_' + 's'.repeat(48),
        selection: {
          ...selection,
          source: { kind: 'favorites' },
          occurrenceCount: 2,
          items: selection.items.map((item) => ({
            ...item,
            occurrenceIndexes: [item.occurrenceIndexes[0]!],
          })),
        },
      }).source,
    ).toEqual({ kind: 'favorites' });
    module.nextId3OrganizationBatchItem(favoriteState);
    module.checkpointId3OrganizationBatch(favoriteState, 'A', {
      kind: 'cover',
      uploadId: 'cover-upload-1',
    });
    expect(module.readId3OrganizationBatchJournal(favoriteState).items[0]!.coverUploadId).toBe(
      'cover-upload-1',
    );
  });

  it('rejects unsafe parents, modes, state paths and concurrent locks', async () => {
    const module = await batchModule();
    expect(module).toHaveProperty('acquireId3OrganizationBatchLock');
    if (!('acquireId3OrganizationBatchLock' in module)) return;
    const unsafe = paths();
    chmodSync(unsafe.root, 0o755);
    expect(() =>
      module.createId3OrganizationBatchJournal({
        path: unsafe.stateFile,
        api: 'https://music.example/api/v1',
        token: 'mlpat_' + 'x'.repeat(48),
        selection,
      }),
    ).toThrow('client_failed:journal_private');
    const symlink = paths();
    const target = join(symlink.root, 'real');
    mkdirSync(target, { mode: 0o700 });
    const linked = join(symlink.root, 'linked');
    symlinkSync(target, linked);
    expect(() =>
      module.createId3OrganizationBatchJournal({
        path: join(linked, 'batch.json'),
        api: 'https://music.example/api/v1',
        token: 'mlpat_' + 'x'.repeat(48),
        selection,
      }),
    ).toThrow('client_failed:journal_private');
    const existing = paths();
    writeFileSync(existing.stateFile, 'unexpected', { mode: 0o600 });
    expect(() =>
      module.createId3OrganizationBatchJournal({
        path: existing.stateFile,
        api: 'https://music.example/api/v1',
        token: 'mlpat_' + 'x'.repeat(48),
        selection,
      }),
    ).toThrow('client_failed:journal_exists');
    const locked = paths();
    module.createId3OrganizationBatchJournal({
      path: locked.stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 'x'.repeat(48),
      selection,
    });
    const release = module.acquireId3OrganizationBatchLock(locked.stateFile);
    expect(() => module.acquireId3OrganizationBatchLock(locked.stateFile)).toThrow(
      'client_failed:journal_locked',
    );
    release();
    chmodSync(locked.stateFile, 0o644);
    expect(() => module.readId3OrganizationBatchJournal(locked.stateFile)).toThrow(
      'client_failed:journal_private',
    );

    const linkedState = paths();
    const realState = join(linkedState.root, 'real.json');
    writeFileSync(realState, '{}', { mode: 0o600 });
    symlinkSync(realState, linkedState.stateFile);
    expect(() => module.readId3OrganizationBatchJournal(linkedState.stateFile)).toThrow(
      'client_failed:journal_private',
    );

    const linkedTemporary = paths();
    module.createId3OrganizationBatchJournal({
      path: linkedTemporary.stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 'x'.repeat(48),
      selection,
    });
    symlinkSync(linkedTemporary.stateFile, linkedTemporary.stateFile + '.tmp');
    expect(() => module.nextId3OrganizationBatchItem(linkedTemporary.stateFile)).toThrow(
      'client_failed:journal_private',
    );

    const linkedLock = paths();
    module.createId3OrganizationBatchJournal({
      path: linkedLock.stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 'x'.repeat(48),
      selection,
    });
    symlinkSync(linkedLock.stateFile, linkedLock.stateFile + '.lock');
    expect(() => module.acquireId3OrganizationBatchLock(linkedLock.stateFile)).toThrow(
      'client_failed:journal_locked',
    );

    const staleLock = paths();
    module.createId3OrganizationBatchJournal({
      path: staleLock.stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 'x'.repeat(48),
      selection,
    });
    writeFileSync(staleLock.stateFile + '.lock', '2147483647\n', { mode: 0o600 });
    expect(() => module.nextId3OrganizationBatchItem(staleLock.stateFile)).not.toThrow();
  });

  it.each(['before_write', 'after_temp_fsync', 'after_rename'] as const)(
    'leaves a valid checkpoint after a %s interruption',
    async (crashAt) => {
      const module = await batchModule();
      expect(module).toHaveProperty('advanceId3OrganizationBatch');
      if (!('advanceId3OrganizationBatch' in module)) return;
      const { stateFile } = paths();
      const initial = module.createId3OrganizationBatchJournal({
        path: stateFile,
        api: 'https://music.example/api/v1',
        token: 'mlpat_' + 'x'.repeat(48),
        selection,
      });
      expect(() =>
        module.advanceId3OrganizationBatch(stateFile, 'A', 'researching', { crashAt }),
      ).toThrow(`client_failed:injected_${crashAt}`);
      const recovered = module.readId3OrganizationBatchJournal(stateFile);
      expect(['pending', 'researching']).toContain(recovered.items[0]!.state);
      expect(() => module.decodeId3OrganizationBatchJournal(recovered)).not.toThrow();
      expect(existsSync(stateFile + '.tmp')).toBe(false);
      expect(initial.items[0]!.operations).toEqual(recovered.items[0]!.operations);
    },
  );

  it('enforces transitions, safe skips, system stops and resumable counts', async () => {
    const module = await batchModule();
    expect(module).toHaveProperty('id3OrganizationBatchStatus');
    if (!('id3OrganizationBatchStatus' in module)) return;
    const { stateFile } = paths();
    module.createId3OrganizationBatchJournal({
      path: stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 'x'.repeat(48),
      selection,
    });
    expect(module.nextId3OrganizationBatchItem(stateFile)).toMatchObject({
      trackId: 'A',
      state: 'researching',
      occurrenceCount: 2,
    });
    expect(() => module.advanceId3OrganizationBatch(stateFile, 'A', 'succeeded')).toThrow(
      'client_failed:journal_transition',
    );
    module.skipId3OrganizationBatchItem(stateFile, 'A', 'ambiguous_release');
    expect(() => module.skipId3OrganizationBatchItem(stateFile, 'B', 'made_up')).toThrow(
      'client_failed:skip_reason',
    );
    expect(module.nextId3OrganizationBatchItem(stateFile)).toMatchObject({ trackId: 'B' });
    module.recordId3OrganizationBatchFailure(stateFile, 'B', 'unsupported_format');
    expect(module.id3OrganizationBatchStatus(stateFile)).toMatchObject({
      total: 2,
      succeeded: 0,
      skipped: 1,
      blocked: 1,
      pending: 0,
      stopped: false,
    });

    const stopped = paths();
    module.createId3OrganizationBatchJournal({
      path: stopped.stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 'x'.repeat(48),
      selection,
    });
    module.nextId3OrganizationBatchItem(stopped.stateFile);
    module.recordId3OrganizationBatchFailure(stopped.stateFile, 'A', 'unauthenticated');
    expect(module.id3OrganizationBatchStatus(stopped.stateFile)).toMatchObject({
      stopped: true,
      stopCode: 'unauthenticated',
      pending: 2,
    });
    expect(module.nextId3OrganizationBatchItem(stopped.stateFile)).toMatchObject({ trackId: 'A' });
    expect(module.id3OrganizationBatchStatus(stopped.stateFile).stopped).toBe(false);
  });

  it('checkpoints accepted stages and reuses the stored metadata operation ID', async () => {
    const module = await batchModule();
    expect(module).toHaveProperty('checkpointId3OrganizationBatch');
    if (!('checkpointId3OrganizationBatch' in module)) return;
    const { root, stateFile } = paths();
    const tokenFile = join(root, 'token');
    writeFileSync(tokenFile, 'mlpat_' + 'z'.repeat(48), { mode: 0o600 });
    const calls: { path: string; body: any }[] = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      if (path.endsWith('/metadata-organization/selections')) return Response.json(selection);
      if (path.endsWith('/curation-claims'))
        return Response.json({
          schemaVersion: 1,
          claimId: 'claim-1',
          leaseUntil: Date.now() + 1000,
          generation: 1,
          results: [{ trackId: 'A', status: 'granted' }],
        });
      if (path.endsWith('/metadata-jobs'))
        return Response.json(
          {
            schemaVersion: 1,
            job: {
              id: 'metadata-job-1',
              libraryId: 'music',
              createdAt: Date.now(),
              status: 'succeeded',
              kind: 'edit',
              parentJobId: null,
              items: [
                {
                  itemId: 'item-1',
                  originalTrackId: 'A',
                  currentTrackId: 'A',
                  stage: 'succeeded',
                  fileSavedAt: 1,
                  reflectedAt: 2,
                  previousRevision: 'revision-1',
                  resultRevision: 'revision-2',
                  changedFields: ['album'],
                  errorCode: null,
                  recoveryActions: [],
                  restoreAvailable: true,
                },
              ],
            },
            admissionResults: [{ trackId: 'A', status: 'accepted', jobItemId: 'item-1' }],
          },
          { status: 202 },
        );
      if (path.endsWith('/curation-claims/claim-1')) return new Response(null, { status: 204 });
      throw new Error('unexpected request');
    };
    const common = {
      api: 'https://music.example/api/v1',
      tokenFile,
      stateFile,
      fetch: fetcher,
    };
    await runId3OrganizeCommand({
      ...common,
      command: 'batch-start',
      source: 'playlist',
      playlistId: 'pl-1',
    });
    expect(await runId3OrganizeCommand({ ...common, command: 'batch-next' })).toMatchObject({
      trackId: 'A',
      occurrenceCount: 2,
    });
    const manifest = {
      schemaVersion: 1 as const,
      metadata: { album: 'Verified album' },
      sourceEvidence: [
        {
          url: 'https://artist.example/release',
          kind: 'official_artist' as const,
          fields: ['album' as const],
        },
      ],
    };
    await runId3OrganizeCommand({
      ...common,
      command: 'metadata-submit',
      trackId: 'A',
      revision: 'revision-1',
      manifest,
    });
    await runId3OrganizeCommand({
      ...common,
      command: 'metadata-submit',
      trackId: 'A',
      revision: 'revision-1',
      manifest,
    });
    const metadataBodies = calls
      .filter(({ path }) => path.endsWith('/metadata-jobs'))
      .map(({ body }) => body.operationId);
    expect(metadataBodies).toHaveLength(2);
    expect(new Set(metadataBodies).size).toBe(1);
    expect(module.readId3OrganizationBatchJournal(stateFile).items[0]).toMatchObject({
      state: 'metadata_accepted',
      metadataJobId: 'metadata-job-1',
      resultRevision: 'revision-2',
      serverStage: 'succeeded',
    });

    const callsBeforeMismatch = calls.length;
    await expect(
      runId3OrganizeCommand({
        ...common,
        command: 'organization-submit',
        trackId: 'A',
        revision: 'different-revision',
        metadataJobId: 'metadata-job-1',
        sourceEvidence: manifest.sourceEvidence,
      }),
    ).rejects.toThrow('client_failed:journal_binding');
    expect(calls).toHaveLength(callsBeforeMismatch);

    module.checkpointId3OrganizationBatch(stateFile, 'A', {
      kind: 'organization',
      jobId: 'organization-job-1',
      newTrackId: null,
      serverStage: 'queued',
    });
    module.checkpointId3OrganizationBatch(stateFile, 'A', {
      kind: 'organization',
      jobId: 'organization-job-1',
      newTrackId: 'A2',
      serverStage: 'succeeded',
    });
    expect(module.nextId3OrganizationBatchItem(stateFile)).toMatchObject({ trackId: 'B' });
    expect(calls.filter(({ path }) => path.endsWith('/metadata-jobs'))).toHaveLength(2);
  });

  it('keeps the accepted organization checkpoint when bounded polling times out', async () => {
    const module = await batchModule();
    expect(module).toHaveProperty('checkpointId3OrganizationBatch');
    if (!('checkpointId3OrganizationBatch' in module)) return;
    const { root, stateFile } = paths();
    const tokenFile = join(root, 'token');
    writeFileSync(tokenFile, 'mlpat_' + 'p'.repeat(48), { mode: 0o600 });
    module.createId3OrganizationBatchJournal({
      path: stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 'p'.repeat(48),
      selection,
    });
    module.nextId3OrganizationBatchItem(stateFile);
    module.checkpointId3OrganizationBatch(stateFile, 'A', {
      kind: 'metadata',
      jobId: 'metadata-job-1',
      resultRevision: 'revision-2',
      serverStage: 'succeeded',
    });
    const job = {
      id: 'organization-job-1',
      itemId: 'item-1',
      libraryId: 'music',
      trackId: 'A',
      newTrackId: null,
      stage: 'queued',
      errorCode: null,
      nextOwner: null,
    };
    await expect(
      runId3OrganizeCommand({
        api: 'https://music.example/api/v1',
        tokenFile,
        stateFile,
        command: 'organization-submit',
        trackId: 'A',
        revision: 'revision-2',
        metadataJobId: 'metadata-job-1',
        sourceEvidence: [
          { url: 'https://artist.example/release', kind: 'official_artist', fields: ['album'] },
        ],
        poll: { attempts: 1, intervalMs: 0, recoveryRetries: 0 },
        sleep: async () => {},
        fetch: async (_input, init) =>
          Response.json({ schemaVersion: 1, job }, { status: init?.method === 'POST' ? 202 : 200 }),
      }),
    ).rejects.toThrow('client_failed:job_timeout');
    expect(module.readId3OrganizationBatchJournal(stateFile).items[0]).toMatchObject({
      state: 'organization_accepted',
      organizationJobId: 'organization-job-1',
      serverStage: 'queued',
    });
  });

  it('stops the batch before later mutations after an authenticated system failure', async () => {
    const module = await batchModule();
    expect(module).toHaveProperty('id3OrganizationBatchStatus');
    if (!('id3OrganizationBatchStatus' in module)) return;
    const { root, stateFile } = paths();
    const tokenFile = join(root, 'token');
    writeFileSync(tokenFile, 'mlpat_' + 'q'.repeat(48), { mode: 0o600 });
    module.createId3OrganizationBatchJournal({
      path: stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 'q'.repeat(48),
      selection,
    });
    module.nextId3OrganizationBatchItem(stateFile);
    await expect(
      runId3OrganizeCommand({
        api: 'https://music.example/api/v1',
        tokenFile,
        stateFile,
        command: 'metadata-submit',
        trackId: 'A',
        revision: 'revision-1',
        manifest: {
          schemaVersion: 1,
          metadata: { album: 'Verified album' },
          sourceEvidence: [
            { url: 'https://artist.example/release', kind: 'official_artist', fields: ['album'] },
          ],
        },
        fetch: async () => Response.json({}, { status: 503 }),
      }),
    ).rejects.toThrow('client_failed:http_503');
    expect(module.id3OrganizationBatchStatus(stateFile)).toMatchObject({
      stopped: true,
      stopCode: 'upstream_unavailable',
      pending: 2,
    });
  });

  it.each([
    'ambiguous_release',
    'official_evidence_missing',
    'unsupported_format',
    'metadata_incomplete',
    'destination_conflict',
  ])('treats %s as an item-local failure', async (code) => {
    const module = await batchModule();
    expect(module).toHaveProperty('recordId3OrganizationBatchFailure');
    if (!('recordId3OrganizationBatchFailure' in module)) return;
    const { stateFile } = paths();
    module.createId3OrganizationBatchJournal({
      path: stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 'f'.repeat(48),
      selection,
    });
    module.nextId3OrganizationBatchItem(stateFile);
    module.recordId3OrganizationBatchFailure(stateFile, 'A', code);
    expect(module.id3OrganizationBatchStatus(stateFile)).toMatchObject({
      blocked: 1,
      pending: 1,
      stopped: false,
    });
  });

  it.each([
    'unauthenticated',
    'forbidden',
    'upstream_unavailable',
    'policy_changed',
    'scope_changed',
  ])('treats %s as a batch-level stop', async (code) => {
    const module = await batchModule();
    expect(module).toHaveProperty('recordId3OrganizationBatchFailure');
    if (!('recordId3OrganizationBatchFailure' in module)) return;
    const { stateFile } = paths();
    module.createId3OrganizationBatchJournal({
      path: stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 'f'.repeat(48),
      selection,
    });
    module.nextId3OrganizationBatchItem(stateFile);
    module.recordId3OrganizationBatchFailure(stateFile, 'A', code);
    expect(module.id3OrganizationBatchStatus(stateFile)).toMatchObject({
      pending: 2,
      stopped: true,
      stopCode: code,
    });
  });

  it('continues after one ambiguous duplicate item and resumes accepted work without replaying success', async () => {
    const module = await batchModule();
    expect(module).toHaveProperty('checkpointId3OrganizationBatch');
    if (!('checkpointId3OrganizationBatch' in module)) return;
    const { stateFile } = paths();
    module.createId3OrganizationBatchJournal({
      path: stateFile,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 'r'.repeat(48),
      selection,
    });

    expect(module.nextId3OrganizationBatchItem(stateFile)).toMatchObject({
      trackId: 'A',
      occurrenceCount: 2,
    });
    module.skipId3OrganizationBatchItem(stateFile, 'A', 'ambiguous_release');
    const exact = module.nextId3OrganizationBatchItem(stateFile);
    expect(exact).toMatchObject({ trackId: 'B', state: 'researching', occurrenceCount: 1 });
    const stableOperations = module.readId3OrganizationBatchJournal(stateFile).items[1]!.operations;
    module.checkpointId3OrganizationBatch(stateFile, 'B', {
      kind: 'metadata',
      jobId: 'metadata-job-B',
      resultRevision: 'revision-B',
      serverStage: 'succeeded',
    });

    const resumed = module.nextId3OrganizationBatchItem(stateFile);
    expect(resumed).toMatchObject({
      trackId: 'B',
      state: 'metadata_accepted',
      checkpoint: { metadataJobId: 'metadata-job-B', resultRevision: 'revision-B' },
    });
    expect(module.readId3OrganizationBatchJournal(stateFile).items[1]!.operations).toEqual(
      stableOperations,
    );
    module.checkpointId3OrganizationBatch(stateFile, 'B', {
      kind: 'organization',
      jobId: 'organization-job-B',
      newTrackId: 'B2',
      serverStage: 'succeeded',
    });

    expect(module.nextId3OrganizationBatchItem(stateFile)).toBeNull();
    expect(module.id3OrganizationBatchStatus(stateFile)).toMatchObject({
      total: 2,
      succeeded: 1,
      skipped: 1,
      blocked: 0,
      pending: 0,
      stopped: false,
      current: null,
    });
  });
});

const installedSkillRoot = join(homedir(), '.codex', 'skills', 'musiclatte-id3-organize');

it.runIf(existsSync(join(installedSkillRoot, 'SKILL.md')))(
  'binds the installed skill to collection routing and recovery invariants',
  () => {
    const skill = readFileSync(join(installedSkillRoot, 'SKILL.md'), 'utf8');
    const description = /^description:\s*(.+)$/m.exec(skill)?.[1] ?? '';
    expect(description).toMatch(/one user-selected Musiclatte .* or .*current-account collection/i);
    expect(skill).toContain('(references/batch-operation.md)');

    const batch = readFileSync(
      join(installedSkillRoot, 'references', 'batch-operation.md'),
      'utf8',
    );
    const routing = new Map(
      batch.split('\n').flatMap((line) => {
        const row = /^\|\s*`([^`]+)`\s*\|\s*`(item|batch)`\s*\|/.exec(line);
        return row ? [[row[1]!, row[2]!] as const] : [];
      }),
    );
    for (const code of [
      'ambiguous_release',
      'official_evidence_missing',
      'unsupported_format',
      'metadata_incomplete',
      'destination_conflict',
    ])
      expect(routing.get(code)).toBe('item');
    for (const code of [
      'unauthenticated',
      'forbidden',
      'upstream_unavailable',
      'policy_changed',
      'scope_changed',
      'journal_invalid',
      'journal_locked',
      'contract_decode',
    ])
      expect(routing.get(code)).toBe('batch');

    for (const command of ['batch-start', 'batch-next', 'batch-skip', 'batch-status'])
      expect(batch).toMatch(new RegExp('`' + command + '(?:`|\\s)'));
    expect(batch).toMatch(/accepted[\s\S]*immediately[\s\S]*journal/i);
    expect(batch).toMatch(/succeeded[\s\S]*never[\s\S]*(research|mutat)/i);
    expect(batch).toMatch(/lyrics[\s\S]*(never|do not)/i);
  },
);

import { lstatSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createId3OrganizationBatchJournal,
  checkpointId3OrganizationBatch,
  completeId3OrganizationBatchSharedItem,
  id3OrganizationBatchStatus,
  nextId3OrganizationBatchItem,
  readId3OrganizationBatchJournal,
  reopenId3OrganizationSkippedItem,
  skipId3OrganizationBatchItem,
} from '../../tools/id3-organize-batch-journal.js';
import { runId3OrganizeCommand } from '../../tools/id3-organize-client.js';

function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), 'musiclatte-reopen-')), 'batch.json');
  createId3OrganizationBatchJournal({
    path,
    api: 'https://music.example/api/v1',
    token: 'mlpat_' + 'a'.repeat(48),
    selection: {
      schemaVersion: 1,
      capturedAt: 1,
      source: { kind: 'favorites' },
      selectionRevision: 'a'.repeat(64),
      occurrenceCount: 2,
      uniqueTrackCount: 2,
      items: ['A', 'B'].map((trackId, index) => ({
        trackId,
        title: trackId,
        artist: 'Artist',
        album: 'Album',
        occurrenceIndexes: [index],
      })),
    },
  });
  nextId3OrganizationBatchItem(path);
  skipId3OrganizationBatchItem(path, 'A', 'official_evidence_missing');
  nextId3OrganizationBatchItem(path);
  skipId3OrganizationBatchItem(path, 'B', 'ambiguous_release');
  return { path, backupPath: path + '.before-retry.json' };
}

describe('explicit skipped-item reconsideration', () => {
  it('preserves history, selection and other items; replay never resets accepted work', () => {
    const { path, backupPath } = fixture();
    const before = readFileSync(path, 'utf8');
    const original = readId3OrganizationBatchJournal(path);
    reopenId3OrganizationSkippedItem(path, 'A', 'retry-1', backupPath);
    expect(readFileSync(backupPath, 'utf8')).toBe(before);
    expect(lstatSync(backupPath).mode & 0o777).toBe(0o600);
    const reopened = readId3OrganizationBatchJournal(path);
    expect(reopened.selectionRevision).toBe(original.selectionRevision);
    expect(reopened.items[1]).toEqual(original.items[1]);
    expect(reopened.items[0]).toMatchObject({ state: 'pending', errorCode: null });
    expect(reopened.items[0]!.operations).not.toEqual(original.items[0]!.operations);
    expect(id3OrganizationBatchStatus(path)).toMatchObject({ total: 2, pending: 1, skipped: 1 });
    nextId3OrganizationBatchItem(path);
    checkpointId3OrganizationBatch(path, 'A', {
      kind: 'metadata',
      step: 'required',
      jobId: 'accepted-job',
      resultRevision: null,
      serverStage: 'queued',
    });
    const active = readFileSync(path, 'utf8');
    reopenId3OrganizationSkippedItem(path, 'A', 'retry-1', backupPath);
    expect(readFileSync(path, 'utf8')).toBe(active);
    expect(() =>
      reopenId3OrganizationSkippedItem(path, 'B', 'retry-2', path + '.other.json'),
    ).toThrow('client_failed:journal_transition');
  });

  it('never reopens a succeeded item under a new intent', () => {
    const { path, backupPath } = fixture();
    reopenId3OrganizationSkippedItem(path, 'A', 'retry-1', backupPath);
    nextId3OrganizationBatchItem(path);
    completeId3OrganizationBatchSharedItem(path, 'A', 'A-successor');
    const before = readFileSync(path, 'utf8');
    expect(() =>
      reopenId3OrganizationSkippedItem(path, 'A', 'retry-2', path + '.other.json'),
    ).toThrow('client_failed:journal_transition');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('requires a fresh editable revision and makes only an authenticated read', async () => {
    const { path, backupPath } = fixture();
    const tokenFile = path + '.token';
    writeFileSync(tokenFile, 'mlpat_' + 'a'.repeat(48), { mode: 0o600 });
    const requests: string[] = [];
    const common = {
      api: 'https://music.example/api/v1',
      tokenFile,
      stateFile: path,
      trackId: 'A',
      operationId: 'retry-1',
      backupFile: backupPath,
      command: 'batch-reopen-skipped' as const,
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        requests.push((init?.method ?? 'GET') + ' ' + String(input));
        return Response.json({
          schemaVersion: 1,
          trackId: 'A',
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
          fileRevision: 'fresh',
          values: {
            title: 'A',
            artist: ['Artist'],
            album: 'Album',
            albumArtist: ['Artist'],
            trackNumber: null,
            year: null,
            genre: [],
          },
          coverFrames: [],
          lyricsFrames: [],
          lastVerifiedAt: 1,
        });
      },
    };
    const before = readFileSync(path, 'utf8');
    await expect(runId3OrganizeCommand({ ...common, revision: 'stale' })).rejects.toThrow(
      'client_failed:journal_binding',
    );
    expect(readFileSync(path, 'utf8')).toBe(before);
    await expect(runId3OrganizeCommand({ ...common, revision: 'fresh' })).resolves.toMatchObject({
      pending: 1,
      skipped: 1,
    });
    expect(requests).toEqual(Array(2).fill('GET https://music.example/api/v1/tracks/A/metadata'));
    await runId3OrganizeCommand({ ...common, revision: 'fresh' });
    expect(requests).toHaveLength(2);
  });

  it('fails closed without changing the journal when the backup is unsafe', () => {
    const { path, backupPath } = fixture();
    symlinkSync(path, backupPath);
    const before = readFileSync(path, 'utf8');
    expect(() => reopenId3OrganizationSkippedItem(path, 'A', 'retry-1', backupPath)).toThrow(
      'client_failed:journal_private',
    );
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('recovers after the backup is durable but before the journal is replaced', () => {
    const { path, backupPath } = fixture();
    const before = readFileSync(path, 'utf8');
    expect(() =>
      reopenId3OrganizationSkippedItem(path, 'A', 'retry-1', backupPath, 'before_write'),
    ).toThrow('client_failed:injected_before_write');
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(readFileSync(backupPath, 'utf8')).toBe(before);
    reopenId3OrganizationSkippedItem(path, 'A', 'retry-1', backupPath);
    expect(id3OrganizationBatchStatus(path).pending).toBe(1);
    expect(() =>
      reopenId3OrganizationSkippedItem(path, 'missing', 'retry-2', path + '.other.json'),
    ).toThrow('client_failed:journal_binding');
  });
});

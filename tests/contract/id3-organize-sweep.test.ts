import { existsSync, linkSync, lstatSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runId3OrganizeCommand } from '../../tools/id3-organize-client.js';
import {
  appendId3OrganizationSweepPage,
  createId3OrganizationSweepJournal,
  decodeId3OrganizationSweepJournal,
  readId3OrganizationSweepJournal,
} from '../../tools/id3-organize-sweep-journal.js';
import { readId3OrganizationBatchJournal } from '../../tools/id3-organize-batch-journal.js';

const api = 'https://music.example/api/v1';
const token = 'mlpat_' + 's'.repeat(48);
const revision = 'a'.repeat(64);

function paths() {
  const root = mkdtempSync(join(tmpdir(), 'musiclatte-sweep-'));
  const stateFile = join(root, 'sweep.json');
  const tokenFile = join(root, 'token');
  writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
  return { root, stateFile, tokenFile };
}

const summary = (needsOrganization: number, rest: Partial<Record<string, number>> = {}) => ({
  total:
    needsOrganization +
    (rest.organized ?? 0) +
    (rest.processing ?? 0) +
    (rest.attention ?? 0) +
    (rest.unknown ?? 0),
  organized: rest.organized ?? 0,
  needsOrganization,
  processing: rest.processing ?? 0,
  attention: rest.attention ?? 0,
  unknown: rest.unknown ?? 0,
});

const item = (ordinal: number) => ({
  mediaLinkId: `media-${ordinal}`,
  trackId: `track-${ordinal}`,
  title: `Title ${ordinal}`,
  artist: ordinal % 2 ? 'Artist' : null,
  album: null,
});

function page(input: {
  items: ReturnType<typeof item>[];
  nextCursor: string | null;
  needs: number;
  selectionId?: string;
  capturedAt?: number;
  expiresAt?: number;
}) {
  const capturedAt = input.capturedAt ?? Date.now();
  return {
    schemaVersion: 1 as const,
    selectionId: input.selectionId ?? 'selection-1',
    capturedAt,
    expiresAt: input.expiresAt ?? capturedAt + 60_000,
    inventoryRevision: revision,
    completeCoverage: true as const,
    summary: summary(input.needs),
    items: input.items,
    nextCursor: input.nextCursor,
  };
}

describe('unorganized ID3 organization sweep journal', () => {
  it('captures 1,001 items in stable private sibling shards before becoming runnable', () => {
    const { stateFile } = paths();
    const first = page({ items: [], nextCursor: 'cursor-0', needs: 1001 });
    createId3OrganizationSweepJournal({ path: stateFile, api, token, page: first });
    for (let offset = 0; offset < 1001; offset += 100) {
      const values = Array.from({ length: Math.min(100, 1001 - offset) }, (_, index) =>
        item(offset + index),
      );
      appendId3OrganizationSweepPage(
        stateFile,
        api,
        token,
        page({
          items: values,
          nextCursor: offset + values.length === 1001 ? null : `cursor-${offset + values.length}`,
          needs: 1001,
          capturedAt: first.capturedAt,
          expiresAt: first.expiresAt,
        }),
      );
    }
    const journal = readId3OrganizationSweepJournal(stateFile);
    expect(journal).toMatchObject({ state: 'ready', capturedItemCount: 1001 });
    expect(journal.shards).toMatchObject([{ itemCount: 1000 }, { itemCount: 1 }]);
    expect(
      journal.shards.every(({ file }) =>
        /^sweep\.json\.[a-f0-9]{16}\.shard-\d{6}\.json$/.test(file),
      ),
    ).toBe(true);
    expect(lstatSync(stateFile).mode & 0o777).toBe(0o600);
    const firstChild = join(dirname(stateFile), journal.shards[0]!.file);
    const secondChild = join(dirname(stateFile), journal.shards[1]!.file);
    expect(lstatSync(firstChild).mode & 0o777).toBe(0o600);
    expect(readId3OrganizationBatchJournal(firstChild).items).toHaveLength(1000);
    expect(readId3OrganizationBatchJournal(secondChild).items[0]).toMatchObject({
      mediaLinkId: 'media-1000',
      occurrenceIndexes: [1000],
    });
    const serialized = readFileSync(stateFile, 'utf8');
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(stateFile);
    expect(serialized).not.toMatch(/sourceEvidence|lyrics|coverUpload|relativeFileKey/);
  });

  it.each(['before_write', 'after_temp_fsync', 'after_rename'] as const)(
    'recovers a valid parent checkpoint after %s',
    (parentCrashAt) => {
      const { stateFile } = paths();
      const first = page({ items: [item(0)], nextCursor: 'next', needs: 2 });
      createId3OrganizationSweepJournal({ path: stateFile, api, token, page: first });
      const last = page({
        items: [item(1)],
        nextCursor: null,
        needs: 2,
        capturedAt: first.capturedAt,
        expiresAt: first.expiresAt,
      });
      expect(() =>
        appendId3OrganizationSweepPage(stateFile, api, token, last, { parentCrashAt }),
      ).toThrow(`client_failed:injected_${parentCrashAt}`);
      expect(() => readId3OrganizationSweepJournal(stateFile)).not.toThrow();
      if (readId3OrganizationSweepJournal(stateFile).state === 'capturing')
        appendId3OrganizationSweepPage(stateFile, api, token, last);
      expect(readId3OrganizationSweepJournal(stateFile)).toMatchObject({
        state: 'ready',
        capturedItemCount: 2,
      });
      expect(existsSync(stateFile + '.tmp')).toBe(false);
    },
  );

  it.each(['before_write', 'after_temp_fsync', 'after_rename'] as const)(
    'recovers an idempotent child append after %s',
    (childCrashAt) => {
      const { stateFile } = paths();
      const first = page({ items: [item(0)], nextCursor: 'next', needs: 2 });
      createId3OrganizationSweepJournal({ path: stateFile, api, token, page: first });
      const last = page({
        items: [item(1)],
        nextCursor: null,
        needs: 2,
        capturedAt: first.capturedAt,
        expiresAt: first.expiresAt,
      });
      expect(() =>
        appendId3OrganizationSweepPage(stateFile, api, token, last, { childCrashAt }),
      ).toThrow(`client_failed:injected_${childCrashAt}`);
      appendId3OrganizationSweepPage(stateFile, api, token, last);
      const parent = readId3OrganizationSweepJournal(stateFile);
      const child = readId3OrganizationBatchJournal(
        join(dirname(stateFile), parent.shards[0]!.file),
      );
      expect(child.items.map(({ mediaLinkId }) => mediaLinkId)).toEqual(['media-0', 'media-1']);
      expect(parent).toMatchObject({ state: 'ready', capturedItemCount: 2 });
    },
  );

  it('rejects unknown fields, escaping child refs and hard-linked state', () => {
    const { stateFile, root } = paths();
    const first = page({ items: [], nextCursor: null, needs: 0 });
    const journal = createId3OrganizationSweepJournal({ path: stateFile, api, token, page: first });
    expect(() => decodeId3OrganizationSweepJournal({ ...journal, token })).toThrow(
      'client_failed:sweep_invalid',
    );
    const current = JSON.parse(readFileSync(stateFile, 'utf8'));
    current.shards = [{ file: '../escape.json', itemCount: 1 }];
    current.capturedItemCount = 1;
    current.aggregate = { ...current.aggregate, total: 1, pending: 1 };
    expect(() => decodeId3OrganizationSweepJournal(current)).toThrow('client_failed:sweep_invalid');
    linkSync(stateFile, join(root, 'linked.json'));
    expect(() => readId3OrganizationSweepJournal(stateFile)).toThrow('client_failed:sweep_private');
  });

  it('blocks a count mismatch without allowing work to start', () => {
    const { stateFile } = paths();
    const incomplete = page({ items: [item(0)], nextCursor: null, needs: 2 });
    createId3OrganizationSweepJournal({ path: stateFile, api, token, page: incomplete });
    expect(readId3OrganizationSweepJournal(stateFile)).toMatchObject({
      state: 'blocked',
      blockCode: 'selection_count_mismatch',
    });
  });
});

describe('unorganized sweep client orchestration', () => {
  it('captures every page and classifies four stale live states without creating jobs', async () => {
    const { stateFile, tokenFile } = paths();
    const capturedAt = Date.now();
    const items = [item(0), item(1), item(2), item(3)];
    const statusStates = [
      { state: 'organized', reason: 'verified', stage: 'succeeded', changedAt: 1 },
      { state: 'processing', reason: 'job_active', stage: 'moving', changedAt: 2 },
      { state: 'attention', reason: 'job_failed', stage: 'failed', changedAt: 3 },
      { state: 'unknown', reason: 'identity_unavailable', stage: null, changedAt: null },
    ] as const;
    const calls: Array<{ path: string; method: string }> = [];
    let statusIndex = 0;
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, method: init?.method ?? 'GET' });
      if (url.pathname.endsWith('/unorganized-selections'))
        return Response.json(
          page({ items: items.slice(0, 2), nextCursor: 'cursor-2', needs: 4, capturedAt }),
        );
      if (url.pathname.endsWith('/pages'))
        return Response.json(
          page({ items: items.slice(2), nextCursor: null, needs: 4, capturedAt }),
        );
      if (url.pathname.endsWith('/statuses')) {
        const body = JSON.parse(String(init?.body));
        return Response.json({
          schemaVersion: 1,
          capturedAt: Date.now(),
          items: [{ target: body.targets[0], ...statusStates[statusIndex++]! }],
        });
      }
      throw new Error('unexpected mutation');
    };
    const common = { api, tokenFile, stateFile, fetch: fetcher };
    expect(await runId3OrganizeCommand({ ...common, command: 'sweep-start' })).toMatchObject({
      state: 'ready',
      capturedItemCount: 4,
    });
    const outcomes = [];
    for (let index = 0; index < 4; index++)
      outcomes.push((await runId3OrganizeCommand({ ...common, command: 'sweep-next' })).outcome);
    expect(outcomes).toEqual([
      'already_organized',
      'deferred_processing',
      'deferred_attention',
      'blocked_identity',
    ]);
    expect(await runId3OrganizeCommand({ ...common, command: 'sweep-status' })).toMatchObject({
      state: 'completed_with_summary',
      aggregate: {
        alreadyOrganized: 1,
        deferredProcessing: 1,
        deferredAttention: 1,
        blockedIdentity: 1,
        pending: 0,
      },
    });
    expect(calls.filter(({ path }) => path.endsWith('/statuses'))).toHaveLength(4);
    expect(calls.filter(({ path }) => /metadata-jobs|organization-jobs/.test(path))).toHaveLength(
      0,
    );
  });

  it('enters the existing workflow only for needs and resumes without another preflight', async () => {
    const { stateFile, tokenFile } = paths();
    let statusCalls = 0;
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/unorganized-selections'))
        return Response.json(page({ items: [item(0)], nextCursor: null, needs: 1 }));
      if (url.pathname.endsWith('/statuses')) {
        statusCalls++;
        const body = JSON.parse(String(init?.body));
        return Response.json({
          schemaVersion: 1,
          capturedAt: Date.now(),
          items: [
            {
              target: body.targets[0],
              state: 'needs_organization',
              reason: 'never_organized',
              stage: null,
              changedAt: null,
            },
          ],
        });
      }
      throw new Error('unexpected request');
    };
    const common = { api, tokenFile, stateFile, fetch: fetcher };
    await runId3OrganizeCommand({ ...common, command: 'sweep-start' });
    const first = await runId3OrganizeCommand({ ...common, command: 'sweep-next' });
    const resumed = await runId3OrganizeCommand({ ...common, command: 'sweep-next' });
    expect(first).toMatchObject({
      mediaLinkId: 'media-0',
      trackId: 'track-0',
      state: 'researching',
    });
    expect(resumed).toMatchObject({ mediaLinkId: 'media-0', state: 'researching' });
    expect(statusCalls).toBe(1);
  });

  it('keeps a partial capture non-runnable after a malformed page', async () => {
    const { stateFile, tokenFile } = paths();
    const capturedAt = Date.now();
    const fetcher = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/unorganized-selections'))
        return Response.json(page({ items: [item(0)], nextCursor: 'next', needs: 2, capturedAt }));
      return Response.json({ schemaVersion: 1, selectionId: 'selection-1' });
    };
    await expect(
      runId3OrganizeCommand({ api, tokenFile, stateFile, command: 'sweep-start', fetch: fetcher }),
    ).rejects.toThrow('Invalid organization response');
    expect(readId3OrganizationSweepJournal(stateFile).state).toBe('capturing');
    await expect(
      runId3OrganizeCommand({ api, tokenFile, stateFile, command: 'sweep-next', fetch: fetcher }),
    ).rejects.toThrow('client_failed:sweep_capture_incomplete');
  });

  it.each(['snapshot_expired', 'snapshot_scope_changed'] as const)(
    'checkpoints %s and rejects another PAT without leaking either token',
    async (captureError) => {
      const { stateFile, tokenFile, root } = paths();
      const capturedAt = Date.now();
      const fetcher = async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/unorganized-selections'))
          return Response.json(
            page({ items: [item(0)], nextCursor: 'next', needs: 2, capturedAt }),
          );
        return Response.json({ error: { code: captureError } }, { status: 409 });
      };
      expect(
        await runId3OrganizeCommand({
          api,
          tokenFile,
          stateFile,
          command: 'sweep-start',
          fetch: fetcher,
        }),
      ).toMatchObject({ state: 'blocked', blockCode: captureError });
      const otherToken = join(root, 'other-token');
      const other = 'mlpat_' + 'x'.repeat(48);
      writeFileSync(otherToken, other, { mode: 0o600 });
      await expect(
        runId3OrganizeCommand({ api, tokenFile: otherToken, stateFile, command: 'sweep-status' }),
      ).rejects.toThrow('client_failed:sweep_binding');
      const serialized = readFileSync(stateFile, 'utf8');
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain(other);
    },
  );
});

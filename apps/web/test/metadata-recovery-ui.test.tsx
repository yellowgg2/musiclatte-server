// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MetadataJob, MetadataSnapshot } from '@musiclatte/contracts';
import type { MetadataClient } from '../src/metadata/client';
afterEach(cleanup);
const snapshot: MetadataSnapshot = {
  schemaVersion: 1,
  trackId: 'A',
  editable: true,
  reason: null,
  format: 'mp3',
  supportedFields: ['title'],
  fileRevision: 'current-revision',
  values: {
    title: 'Current title',
    artist: [],
    album: null,
    albumArtist: [],
    trackNumber: null,
    year: null,
    genre: [],
  },
  coverFrames: [],
  lyricsFrames: [],
  lastVerifiedAt: 1,
};
const item: MetadataJob['items'][number] = {
  itemId: 'item',
  originalTrackId: 'A',
  currentTrackId: 'A',
  stage: 'reflecting',
  fileSavedAt: 2,
  reflectedAt: null,
  previousRevision: 'old',
  resultRevision: 'saved',
  changedFields: ['title'],
  errorCode: 'reflection_mismatch',
  recoveryActions: ['recheck', 'restore'],
  restoreAvailable: true,
};
const job: MetadataJob = {
  id: 'job',
  libraryId: 'music',
  createdAt: 1,
  status: 'reflecting',
  kind: 'edit',
  parentJobId: null,
  items: [item],
};
async function component() {
  const modules = import.meta.glob('../src/metadata/components/MetadataRecovery.tsx');
  expect(Object.keys(modules), 'recovery component exists').toHaveLength(1);
  return (await modules[
    Object.keys(modules)[0]!
  ]!()) as typeof import('../src/metadata/components/MetadataRecovery');
}
function makeSUT() {
  const recheck = vi.fn().mockResolvedValue(job);
  const restore = vi
    .fn()
    .mockResolvedValue({ ...job, id: 'restore-job', kind: 'restore', parentJobId: 'job' });
  const preview = vi.fn().mockResolvedValue({
    schemaVersion: 1,
    jobId: 'job',
    itemId: 'item',
    backupCreatedAt: 1,
    current: snapshot,
    currentCovers: [],
    original: {
      values: { ...snapshot.values, title: 'Original title' },
      lyricsFrames: [],
      covers: [],
    },
  });
  const read = vi.fn().mockResolvedValue(snapshot);
  const intent = vi.fn().mockResolvedValue({
    targets: [{ trackId: 'A', expectedRevision: 'stale' }],
    patch: { title: { op: 'set', value: 'Submitted title' } },
  });
  const submit = vi.fn();
  const retry = vi.fn();
  const client = {
    recheck,
    restore,
    restorePreview: preview,
    read,
    intent,
    submit,
    retry,
  } as unknown as MetadataClient;
  return {
    recheck,
    restore,
    preview,
    read,
    intent,
    submit,
    retry,
    props: {
      job,
      locale: 'en' as const,
      client,
      csrfToken: 'csrf',
      onSubmitted: vi.fn(),
      onUnauthenticated: vi.fn(),
      onRefresh: vi.fn(),
      onEdit: vi.fn(),
    },
  };
}
/** Saved items only schedule scan/lookup, never a second write or failed-only retry. */
it('should recheck reflection using only its recheck endpoint', async () => {
  const { MetadataRecovery } = await component();
  const c = makeSUT();
  render(<MetadataRecovery {...c.props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check library reflection again' }));
  await waitFor(() => expect(c.recheck).toHaveBeenCalledOnce());
  expect(c.recheck.mock.calls[0]![1]).toMatchObject({
    itemIds: ['item'],
    operationId: expect.any(String),
  });
  expect(c.restore).not.toHaveBeenCalled();
  expect(c.submit).not.toHaveBeenCalled();
  expect(c.retry).not.toHaveBeenCalled();
});
/** The original metadata and latest revision must be reviewed before an explicit restore. */
it('should show current versus original values and restore only after confirmation', async () => {
  const { MetadataRecovery } = await component();
  const c = makeSUT();
  render(<MetadataRecovery {...c.props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review original restore' }));
  await screen.findByText('Original title');
  expect(screen.getByText('Current title')).toBeTruthy();
  expect(c.restore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Restore original file' }));
  await waitFor(() => expect(c.restore).toHaveBeenCalledOnce());
  expect(c.restore.mock.calls[0]![1]).toEqual({
    operationId: expect.any(String),
    itemId: 'item',
    currentExpectedRevision: 'current-revision',
  });
  expect(c.props.onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ id: 'restore-job' }));
});
/** Cancelling a restore comparison must leave the file untouched. */
it('should cancel a prepared restore without submitting', async () => {
  const { MetadataRecovery } = await component();
  const c = makeSUT();
  render(<MetadataRecovery {...c.props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review original restore' }));
  await screen.findByText('Original title');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(c.restore).not.toHaveBeenCalled();
});
/** A conflict opens a fresh draft without silently copying the previously submitted patch. */
it('should compare a conflict and open only the freshly read snapshot', async () => {
  const { MetadataRecovery } = await component();
  const c = makeSUT();
  const conflict = {
    ...job,
    status: 'failed' as const,
    items: [
      {
        ...item,
        stage: 'conflict' as const,
        fileSavedAt: null,
        restoreAvailable: false,
        recoveryActions: ['refresh' as const, 'retry' as const],
        errorCode: 'revision_conflict' as const,
      },
    ],
  };
  render(<MetadataRecovery {...c.props} job={conflict} />);
  fireEvent.click(screen.getByRole('button', { name: 'Load current music information' }));
  await screen.findByText('Submitted title');
  expect(screen.getByText('Current title')).toBeTruthy();
  expect(c.props.onEdit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit from current values' }));
  expect(c.props.onEdit).toHaveBeenCalledWith(snapshot);
  expect(c.retry).not.toHaveBeenCalled();
});
/** A denied restore and unsupported unsaved failure must not receive misleading actions. */
it('should hide unsupported recovery actions', async () => {
  const { MetadataRecovery } = await component();
  const c = makeSUT();
  render(
    <MetadataRecovery
      {...c.props}
      job={{
        ...job,
        items: [
          {
            ...item,
            stage: 'failed',
            fileSavedAt: null,
            errorCode: 'unsupported_format',
            restoreAvailable: false,
            recoveryActions: [],
          },
        ],
      }}
    />,
  );
  expect(screen.queryByRole('button')).toBeNull();
});
/** An intervening write invalidates the restore summary; it must not silently replace the revision. */
it('should require a new comparison after a restore conflict', async () => {
  const { ApiError } = await import('../src/auth/client');
  const { MetadataRecovery } = await component();
  const c = makeSUT();
  c.restore.mockRejectedValueOnce(new ApiError('conflict'));
  render(<MetadataRecovery {...c.props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review original restore' }));
  await screen.findByText('Original title');
  fireEvent.click(screen.getByRole('button', { name: 'Restore original file' }));
  await screen.findByText(
    'The file changed again. Reload and compare the current values before continuing.',
  );
  expect(screen.queryByRole('button', { name: 'Restore original file' })).toBeNull();
  expect(c.preview).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Load current music information' }));
  await screen.findByText('Original title');
  expect(c.preview).toHaveBeenCalledTimes(2);
  expect(c.restore).toHaveBeenCalledOnce();
});
/** An unknown network outcome retains operation identity instead of creating another restore. */
it('should resend an uncertain restore using the exact same operation', async () => {
  const { ApiError } = await import('../src/auth/client');
  const { MetadataRecovery } = await component();
  const c = makeSUT();
  c.restore.mockRejectedValueOnce(new ApiError('upstream_unavailable'));
  render(<MetadataRecovery {...c.props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review original restore' }));
  await screen.findByText('Original title');
  fireEvent.click(screen.getByRole('button', { name: 'Restore original file' }));
  const { messages } = await import('../src/i18n');
  fireEvent.click(await screen.findByRole('button', { name: messages.en['metadata.resend'] }));
  await waitFor(() => expect(c.restore).toHaveBeenCalledTimes(2));
  expect(c.restore.mock.calls[0]![1]).toEqual(c.restore.mock.calls[1]![1]);
});

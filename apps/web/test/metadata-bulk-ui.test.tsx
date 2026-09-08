// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';

async function bulkModule() {
  const modules = import.meta.glob('../src/metadata/bulk.ts');
  expect(Object.keys(modules), 'bulk helpers exist').toHaveLength(1);
  return (await modules[Object.keys(modules)[0]!]!()) as typeof import('../src/metadata/bulk');
}
describe('bulk metadata intent', () => {
  /** Mixed values remain a display hint and unchanged fields never enter the patch. */
  it('should preserve mixed untouched fields and distinguish explicit clear', async () => {
    const bulk = await bulkModule();
    expect(bulk.commonValue(['First', 'Second'])).toEqual({ kind: 'mixed' });
    expect(
      bulk.commonValue([
        ['One', 'Two'],
        ['One', 'Two'],
      ]),
    ).toEqual({ kind: 'common', value: ['One', 'Two'] });
    expect(
      bulk.buildBulkPatch({
        title: { op: 'keep' },
        album: { op: 'clear' },
        year: { op: 'set', value: '2026' },
      }),
    ).toEqual({ album: { op: 'clear' }, year: { op: 'set', value: '2026' } });
  });
  /** Duplicate playlist occurrences resolve to one physical song target in stable order. */
  it('should deduplicate occurrences and enforce the explicit target limit', async () => {
    const bulk = await bulkModule();
    expect(bulk.uniqueTargets(['A', 'B', 'A'])).toEqual(['A', 'B']);
    expect(() => bulk.uniqueTargets(Array.from({ length: 65 }, (_, i) => String(i)))).toThrow(
      'target_limit',
    );
  });
  /** Durable saved or ambiguous items never enter a failed-only write retry. */
  it('should select only explicitly retryable unsaved failures', async () => {
    const bulk = await bulkModule();
    const item = {
      itemId: 'failed',
      currentTrackId: 'A',
      stage: 'failed',
      fileSavedAt: null,
      recoveryActions: ['retry'],
    };
    const job = {
      items: [
        item,
        { ...item, itemId: 'saved', fileSavedAt: 2 },
        { ...item, itemId: 'pending', stage: 'reflecting' },
        { ...item, itemId: 'ambiguous', stage: 'recovery_required' },
        { ...item, itemId: 'denied', recoveryActions: [] },
      ],
    };
    expect(bulk.retryTargets(job as never).map((x) => x.itemId)).toEqual(['failed']);
  });
});

/** Bulk editor keeps mixed titles untouched while sending explicit shared album/year changes. */
it('should review dirty bulk fields with every original file revision', async () => {
  const { render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
  const { MetadataEditor } = await import('../src/metadata/components/MetadataEditor');
  const { createMetadataClient } = await import('../src/metadata/client');
  const snapshots = ['A', 'B'].map((trackId, i) => ({
    schemaVersion: 1 as const,
    trackId,
    editable: true,
    reason: null,
    format: 'mp3' as const,
    supportedFields: ['title', 'album', 'year'] as const,
    fileRevision: `revision-${i}`,
    values: {
      title: trackId,
      album: 'Shared',
      year: '2020',
      artist: [],
      albumArtist: [],
      trackNumber: null,
      genre: [],
    },
    coverFrames: [],
    lyricsFrames: [],
    lastVerifiedAt: 1,
  }));
  const calls: unknown[] = [];
  const client = createMetadataClient({
    fetcher: async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      calls.push(body);
      return Response.json({
        schemaVersion: 1,
        libraryId: 'music',
        targetCount: 2,
        changedFields: Object.keys(body.patch),
        targets: body.targets.map((x: { trackId: string; expectedRevision: string }) => ({
          trackId: x.trackId,
          fileRevision: x.expectedRevision,
        })),
        writeGuaranteed: false,
      });
    },
  });
  // Extra props intentionally reach the existing single editor to demonstrate the missing bulk behavior.
  const props = {
    snapshot: snapshots[0],
    bulk: { snapshots, occurrenceCount: 3, fields: ['title', 'album', 'year'] },
    locale: 'en',
    client,
    csrfToken: 'synthetic',
    apiOrigin: '',
    canLyrics: false,
    onSubmitted: () => {},
    onClose: () => {},
    onUnauthenticated: () => {},
  };
  try {
    const view = render(
      <MetadataEditor {...(props as unknown as ComponentProps<typeof MetadataEditor>)} />,
    );
    expect(screen.getByLabelText('Title')).toHaveProperty('value', '');
    expect(screen.getByText(/Multiple values/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear Album' }));
    view.rerender(
      <MetadataEditor
        {...(props as unknown as ComponentProps<typeof MetadataEditor>)}
        locale="ko"
      />,
    );
    expect(screen.getByLabelText('연도')).toHaveProperty('value', '2026');
    expect(screen.getByText('삭제 예정')).toBeTruthy();
    view.rerender(
      <MetadataEditor
        {...(props as unknown as ComponentProps<typeof MetadataEditor>)}
        locale="en"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      targets: [
        { trackId: 'A', expectedRevision: 'revision-0' },
        { trackId: 'B', expectedRevision: 'revision-1' },
      ],
      patch: { album: { op: 'clear' }, year: { op: 'set', value: '2026' } },
    });
  } finally {
    cleanup();
  }
});

/** Uneditable files require visible, explicit exclusion before the remaining target set can open. */
it('should require explicit exclusion and retain the selected occurrence count', async () => {
  const modules = import.meta.glob('../src/metadata/components/BulkMetadataEditor.tsx');
  expect(Object.keys(modules), 'bulk selection loader exists').toHaveLength(1);
  const { BulkMetadataEditor } = (await modules[
    Object.keys(modules)[0]!
  ]!()) as typeof import('../src/metadata/components/BulkMetadataEditor');
  const { render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
  const { createMetadataClient } = await import('../src/metadata/client');
  const base = {
    schemaVersion: 1,
    editable: true,
    reason: null,
    format: 'mp3',
    supportedFields: ['title', 'album'],
    fileRevision: 'revision',
    values: {
      title: 'Song',
      album: 'Album',
      artist: [],
      albumArtist: [],
      year: null,
      trackNumber: null,
      genre: [],
    },
    coverFrames: [],
    lyricsFrames: [],
    lastVerifiedAt: 1,
  };
  const writes: string[] = [];
  const client = createMetadataClient({
    fetcher: async (url, init) => {
      if (init?.method === 'POST') {
        writes.push(String(url));
        const body = JSON.parse(init.body as string);
        return Response.json({
          schemaVersion: 1,
          libraryId: 'music',
          targetCount: 1,
          changedFields: ['title'],
          targets: [{ trackId: body.targets[0].trackId, fileRevision: 'revision' }],
          writeGuaranteed: false,
        });
      }
      const id = String(url).includes('/B/') ? 'B' : 'A';
      return Response.json({
        ...base,
        trackId: id,
        ...(id === 'B' ? { editable: false, reason: 'read_only' } : {}),
      });
    },
  });
  try {
    render(
      <BulkMetadataEditor
        ids={['A', 'B', 'A']}
        occurrenceCount={3}
        fields={['title', 'album']}
        locale="en"
        client={client}
        csrfToken="synthetic"
        apiOrigin=""
        onClose={() => {}}
        onSubmitted={() => {}}
        onUnauthenticated={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Exclude unavailable songs' })).toBeTruthy(),
    );
    expect(screen.queryByLabelText('Title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Exclude unavailable songs' }));
    fireEvent.click(screen.getByRole('button', { name: /Edit.*1/ }));
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeTruthy());
    expect(screen.getByText(/3 selected entries · 1 files/)).toBeTruthy();
    expect(writes.every((url) => url.endsWith('metadata-previews'))).toBe(true);
  } finally {
    cleanup();
  }
});

/** Existing selection toolbar exposes metadata editing independently of playlist write permission. */
it('should offer bulk editing from the existing loaded selection toolbar', async () => {
  const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
  const { vi } = await import('vitest');
  const ui = await import('../src/metadata/MetadataUIProvider');
  const { SelectionProvider } = await import('../src/selection/SelectionProvider');
  const { SelectionBar } = await import('../src/selection/components/SelectionBar');
  vi.spyOn(ui, 'useMetadataUI').mockReturnValue({
    canEdit: true,
    bulkFields: ['album'],
    locale: 'en',
    base: '/',
    apiOrigin: '',
    csrfToken: 'synthetic',
    canLyrics: false,
    canHistory: true,
    open: () => {},
    accept: () => {},
    onUnauthenticated: () => {},
  } as never);
  try {
    render(
      <SelectionProvider>
        <SelectionBar
          locale="en"
          scopeLabel="Loaded songs"
          pageItems={[
            { id: 'A', order: 0 },
            { id: 'B', order: 1 },
            { id: 'A', order: 2 },
          ]}
          fetcher={fetch}
          apiOrigin=""
          csrfToken="synthetic"
          canWrite={false}
          onUnauthenticated={() => {}}
        />
      </SelectionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select songs' }));
    fireEvent.click(screen.getByRole('button', { name: /Select.*page|Select loaded/i }));
    expect(screen.getByRole('button', { name: 'Edit shared music information' })).toHaveProperty(
      'disabled',
      false,
    );
  } finally {
    cleanup();
    vi.restoreAllMocks();
  }
});

/** A retry rereads only unsaved failures and requires review before a new operation is submitted. */
it('should retry only the failed item with its fresh revision after review', async () => {
  const modules = import.meta.glob('../src/metadata/components/MetadataRetry.tsx');
  expect(Object.keys(modules), 'retry review exists').toHaveLength(1);
  const { MetadataRetry } = (await modules[
    Object.keys(modules)[0]!
  ]!()) as typeof import('../src/metadata/components/MetadataRetry');
  const { render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
  const { vi } = await import('vitest');
  const base = {
    itemId: 'failed',
    currentTrackId: 'B',
    originalTrackId: 'B',
    stage: 'failed',
    fileSavedAt: null,
    recoveryActions: ['retry'],
    changedFields: ['album'],
  };
  const job = {
    id: 'job',
    items: [
      { ...base, itemId: 'saved', currentTrackId: 'A', stage: 'succeeded', fileSavedAt: 1 },
      base,
    ],
  };
  const client = {
    read: vi.fn(async (..._args: unknown[]) => ({
      trackId: 'B',
      fileRevision: 'fresh',
      editable: true,
      values: { title: 'B', album: 'Current' },
    })),
    intent: vi.fn(async () => ({
      targets: [{ trackId: 'B', expectedRevision: 'old' }],
      patch: { album: { op: 'clear' } },
    })),
    preview: vi.fn(async (..._args: unknown[]) => ({})),
    retry: vi.fn(async (..._args: unknown[]) => ({ id: 'child' })),
  };
  try {
    render(
      <MetadataRetry
        job={job as never}
        locale="en"
        client={client as never}
        csrfToken="synthetic"
        onSubmitted={() => {}}
        onUnauthenticated={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review failed songs for retry' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry these failed songs' })).toBeTruthy(),
    );
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.read.mock.calls[0]?.[0]).toBe('B');
    expect(client.retry).not.toHaveBeenCalled();
    expect(client.preview.mock.calls[0]?.[0]).toEqual({
      targets: [{ trackId: 'B', expectedRevision: 'fresh' }],
      patch: { album: { op: 'clear' } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry these failed songs' }));
    await waitFor(() => expect(client.retry).toHaveBeenCalledTimes(1));
    expect(client.retry.mock.calls[0]?.[1]).toMatchObject({
      items: [{ itemId: 'failed', expectedRevision: 'fresh' }],
    });
  } finally {
    cleanup();
  }
});

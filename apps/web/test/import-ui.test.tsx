// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportJob } from '@musiclatte/contracts';
import { Router } from '../src/app/Router';

const job: ImportJob = {
  id: 'job-one',
  libraryId: 'music',
  createdAt: 1700000000000,
  cancelRequestedAt: null,
  retryOfJobId: null,
  status: 'partial',
  items: [
    {
      id: 'item-ready',
      sourceId: 'abcdefghijk',
      stage: 'ready',
      title: 'Saved song',
      mediaLinkId: 'media-one',
    },
    {
      id: 'item-failed',
      sourceId: '12345678901',
      stage: 'failed',
      title: 'Failed song',
      failureCode: 'download_failed',
    },
  ],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
function createTestContext() {
  const calls: {
    path: string;
    method: string;
    body: Record<string, unknown>;
    signal?: AbortSignal | null | undefined;
  }[] = [];
  const state = {
    username: 'listener',
    permission: 'allowed',
    availability: 'available',
    supported: true,
    jobs: [] as ImportJob[],
    libraries: [{ id: 'music' }],
    failWrite: false,
    failRead: false,
    duplicateCreate: false,
    pending: null as ReturnType<typeof deferred<Response>> | null,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path: url.pathname + url.search, method, body, signal: init?.signal });
    if (url.pathname.endsWith('/session'))
      return Response.json({
        schemaVersion: 1,
        authScheme: 'cookie',
        username: state.username,
        role: 'user',
        expiresAt: Date.now() + 3600000,
        csrfToken: 'synthetic-csrf',
      });
    if (url.pathname.endsWith('/capabilities'))
      return Response.json({
        schemaVersion: 1,
        instanceId: 'fixture',
        revision: 'imports',
        features: {
          'music.browse': { supported: false, permission: 'denied', availability: 'available' },
          'imports.youtube': {
            supported: state.supported,
            permission: state.permission,
            availability: state.availability,
          },
          'playlists.read': { supported: true, permission: 'allowed', availability: 'available' },
        },
      });
    if (url.pathname === '/api/v1/playlists')
      return Response.json({ schemaVersion: 1, playlists: [] });
    if (url.pathname.startsWith('/api/v1/imports')) {
      if (method === 'GET') {
        if (state.pending) {
          const pending = state.pending;
          state.pending = null;
          return pending.promise;
        }
        if (state.failRead)
          return Response.json({ error: { code: 'upstream_unavailable' } }, { status: 503 });
        if (url.pathname !== '/api/v1/imports')
          return Response.json({
            schemaVersion: 1,
            job: state.jobs.find((j) => url.pathname.endsWith(j.id)),
          });
        return Response.json({
          schemaVersion: 1,
          jobs: state.jobs,
          libraries: state.libraries,
          nextCursor: null,
        });
      }
      if (state.failWrite) {
        state.failWrite = false;
        throw new Error('lost response');
      }
      if (method === 'DELETE') {
        state.jobs = state.jobs.map((j) =>
          url.pathname.endsWith(j.id) ? { ...j, cancelRequestedAt: Date.now() } : j,
        );
        return Response.json({
          schemaVersion: 1,
          job: state.jobs.find((j) => url.pathname.endsWith(j.id)),
        });
      }
      const parent = state.jobs.find((entry) => url.pathname.endsWith(`/${entry.id}/retries`));
      const created: ImportJob = url.pathname.endsWith('/retries')
        ? {
            ...parent!,
            id: 'child-job',
            status: 'queued',
            retryOfJobId: parent!.id,
            items: parent!.items
              .filter((item) => body.itemIds.includes(item.id))
              .map(({ failureCode: _removed, ...item }) => ({
                ...item,
                id: `child-${item.id}`,
                stage: 'queued' as const,
              })),
          }
        : {
            ...job,
            id: 'new-job',
            status: 'queued',
            items: [{ id: 'new-item', sourceId: 'abcdefghijk', stage: 'queued' }],
          };
      if (state.duplicateCreate && !url.pathname.endsWith('/retries')) {
        created.status = 'completed';
        created.items = [
          {
            id: 'new-duplicate',
            sourceId: 'abcdefghijk',
            stage: 'duplicate',
            duplicate: { kind: 'item', id: 'active-item' },
          },
        ];
      }
      state.jobs = [created, ...state.jobs];
      return Response.json({ schemaVersion: 1, job: created }, { status: 202 });
    }
    throw new Error('Unexpected fixture route');
  };
  return { state, calls, fetcher };
}
function makeSUT(context = createTestContext(), path = '/imports') {
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', path);
  const view = render(<Router fetcher={context.fetcher} />);
  return { ...context, ...view, user: userEvent.setup() };
}
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('imports route and durable job UI', () => {
  it('focuses the retained attempt when a submitted duplicate result has no separate card', async () => {
    const context = createTestContext();
    context.state.duplicateCreate = true;
    context.state.jobs = [
      {
        ...job,
        id: 'active',
        createdAt: 20,
        status: 'running',
        items: [
          {
            id: 'active-item',
            sourceId: 'abcdefghijk',
            title: 'Current attempt',
            stage: 'downloading',
          },
        ],
      },
      {
        ...job,
        id: 'old-failure',
        createdAt: 10,
        status: 'failed',
        items: [
          {
            id: 'old-item',
            sourceId: 'abcdefghijk',
            title: 'Old failure',
            stage: 'failed',
            failureCode: 'publish_failed',
          },
        ],
      },
    ];
    const c = makeSUT(context);
    const heading = await screen.findByRole('heading', { name: 'Current attempt', level: 3 });
    const field = screen.getByRole('textbox', { name: 'YouTube links' });
    await c.user.type(field, 'https://youtu.be/abcdefghijk');
    await c.user.click(screen.getByRole('button', { name: 'Import links' }));
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe(''));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(document.activeElement).toBe(heading);
  });

  it('shows one current card for repeated failures while preserving other songs and original navigation', async () => {
    const context = createTestContext();
    const failed = (id: string, title: string) => ({
      id,
      sourceId: 'abcdefghijk',
      title,
      stage: 'failed' as const,
      failureCode: 'publish_failed' as const,
    });
    context.state.jobs = [
      {
        ...job,
        id: 'latest',
        createdAt: 30,
        status: 'failed',
        retryOfJobId: 'original',
        items: [failed('latest-item', 'Latest failure')],
      },
      {
        ...job,
        id: 'duplicate',
        createdAt: 40,
        status: 'completed',
        items: [
          {
            id: 'duplicate-item',
            sourceId: 'abcdefghijk',
            title: 'Duplicate request',
            stage: 'duplicate',
            duplicate: { kind: 'item', id: 'latest-item' },
          },
        ],
      },
      {
        ...job,
        id: 'original',
        createdAt: 20,
        status: 'failed',
        items: [failed('original-item', 'Earlier failure')],
      },
      {
        ...job,
        id: 'mixed',
        createdAt: 10,
        items: [
          failed('mixed-failed', 'Oldest failure'),
          { ...job.items[0]!, sourceId: '98765432109', title: 'Preserved success' },
        ],
      },
    ];
    const c = makeSUT(context);
    await screen.findByRole('heading', { name: 'Latest failure', level: 3 });
    expect(screen.queryByText('Earlier failure')).toBeNull();
    expect(screen.queryByText('Oldest failure')).toBeNull();
    expect(screen.queryByText('Duplicate request')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Preserved success', level: 3 })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    await c.user.click(screen.getByRole('link', { name: 'View original import' }));
    const original = await screen.findByRole('heading', { name: 'Earlier failure', level: 3 });
    expect(document.activeElement).toBe(original);
    await c.user.click(screen.getByRole('button', { name: 'Retry Latest failure' }));
    await screen.findByText('Queued');
    expect(screen.queryByText('Earlier failure')).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Latest failure', level: 3 })).toHaveLength(1);
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('should distinguish a duplicate request from an already imported file', async () => {
    const context = createTestContext();
    context.state.jobs = [
      {
        ...job,
        status: 'completed',
        items: [
          {
            id: 'duplicate',
            sourceId: 'abcdefghijk',
            title: 'Known song',
            stage: 'duplicate',
            duplicate: { kind: 'item', id: 'original-item' },
          },
        ],
      },
    ];
    makeSUT(context);
    await screen.findByText('Known song');
    expect(screen.getByText('Already requested')).toBeTruthy();
    expect(screen.queryByText('Already imported')).toBeNull();
  });

  it('should keep the form available for another import while a song downloads', async () => {
    const context = createTestContext();
    context.state.jobs = [
      {
        ...job,
        status: 'running',
        items: [
          {
            id: 'downloading',
            sourceId: '98765432109',
            title: 'Downloading song',
            stage: 'downloading',
          },
        ],
      },
    ];
    const c = makeSUT(context);
    const field = await screen.findByRole('textbox', { name: 'YouTube links' });
    await c.user.type(field, 'https://youtu.be/abcdefghijk');
    await c.user.click(screen.getByRole('button', { name: 'Import links' }));
    await screen.findByText('Queued');
    expect(screen.getByText('Downloading song')).toBeTruthy();
    expect(screen.getByText('Downloading')).toBeTruthy();
    expect((field as HTMLTextAreaElement).disabled).toBe(false);
    expect((field as HTMLTextAreaElement).value).toBe('');
    expect(c.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('should lead each compact import row with the song title and preserve recovery actions', async () => {
    const context = createTestContext();
    context.state.jobs = [
      { ...structuredClone(job), retryOfJobId: 'older-job' },
      {
        ...structuredClone(job),
        id: 'older-job',
        status: 'completed',
        items: [{ ...job.items[0]!, id: 'older-item', title: 'Earlier song' }],
      },
    ];
    makeSUT(context);
    await screen.findByText('Saved song');
    const title = screen.getByRole('heading', { level: 3, name: 'Saved song' });
    const article = title.closest('article')!;
    expect(within(article).getByRole('heading', { level: 3, name: 'Failed song' })).toBeTruthy();
    expect(within(article).queryByText('Some items failed')).toBeNull();
    expect(within(article).queryByRole('heading', { name: /^Import ·/ })).toBeNull();
    expect(within(article).getByRole('button', { name: 'Retry Failed song' })).toBeTruthy();
    expect(within(article).getByRole('link', { name: 'View original import' })).toBeTruthy();
    expect(within(article).getByText('Download failed. You can retry this item.')).toBeTruthy();
  });

  /** A supported consumer opens the primary route with an accessible multiline field. */
  it('should expose the enabled route and validate input without putting URLs in history', async () => {
    const c = makeSUT();
    expect(await screen.findByRole('heading', { name: 'Import music' })).toBeTruthy();
    expect(document.title).toBe('Import music · Musiclatte');
    expect(screen.getByRole('link', { name: 'Imports' }).getAttribute('aria-current')).toBe('page');
    const field = screen.getByRole('textbox', { name: 'YouTube links' });
    await c.user.type(field, 'https://example.invalid/private');
    await c.user.click(screen.getByRole('button', { name: 'Import links' }));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect(c.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(window.location.href).not.toContain('example.invalid');
  });
  it('should submit the selected video from a radio link without playlist context', async () => {
    const c = makeSUT();
    const field = await screen.findByRole('textbox', { name: 'YouTube links' });
    await c.user.type(
      field,
      'https://www.youtube.com/watch?v=s3_uirvnSdI&list=RDVf2PhH7d7j0&index=20',
    );
    await c.user.click(screen.getByRole('button', { name: 'Import links' }));
    await screen.findByText('Queued');
    const writes = c.calls.filter((call) => call.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.body.urls).toEqual(['https://www.youtube.com/watch?v=s3_uirvnSdI']);
    expect(field.getAttribute('aria-invalid')).not.toBe('true');
  });
  /** One or multiple links share a body-only operation, and network retries replay its exact identity. */
  it('should replay submission and keep queued distinct from ready', async () => {
    const c = makeSUT();
    const field = await screen.findByRole('textbox', { name: 'YouTube links' });
    c.state.failWrite = true;
    await c.user.type(field, 'https://youtu.be/abcdefghijk\nhttps://youtu.be/12345678901');
    await c.user.click(screen.getByRole('button', { name: 'Import links' }));
    await screen.findByRole('alert');
    await c.user.click(screen.getByRole('button', { name: 'Retry request' }));
    await screen.findByText('Queued');
    const writes = c.calls.filter((c) => c.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes[0]!.body).toEqual(writes[1]!.body);
    expect(writes[0]!.body.urls).toHaveLength(2);
    expect((field as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText('Ready')).toBeNull();
  });
  /** Failed-only child retry preserves original successes and cooperative cancellation copy. */
  it('should retain successes, link a retry child and distinguish cancel requested from cancelled', async () => {
    const context = createTestContext();
    context.state.jobs = [structuredClone(job)];
    const c = makeSUT(context);
    await screen.findByText('Saved song');
    await c.user.click(screen.getByRole('button', { name: 'Retry Failed song' }));
    await screen.findByText('Queued');
    expect(c.calls.find((c) => c.path.endsWith('/retries'))?.body.itemIds).toEqual(['item-failed']);
    expect(screen.getByText('Saved song')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View original import' }).getAttribute('href')).toBe(
      '#import-job-one',
    );
    await c.user.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(screen.getByText('Songs already published will not be deleted.')).toBeTruthy();
    await c.user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    await screen.findByText('Cancellation requested');
    expect(screen.queryByText('Cancelled')).toBeNull();
    expect(screen.getByText('Saved song')).toBeTruthy();
  });
  /** Denied and unavailable direct routes retain their meaning and offer safe recovery. */
  it.each(['denied', 'unavailable', 'unsupported'])(
    'should gate the %s route without making import requests',
    async (mode) => {
      const context = createTestContext();
      if (mode === 'denied') context.state.permission = 'denied';
      if (mode === 'unavailable') context.state.availability = 'temporarily_unavailable';
      if (mode === 'unsupported') context.state.supported = false;
      const c = makeSUT(context);
      await screen.findByRole('heading', {
        name:
          mode === 'denied'
            ? 'Access denied'
            : mode === 'unavailable'
              ? 'Import worker unavailable'
              : 'Feature unavailable',
      });
      expect(screen.queryByRole('link', { name: 'Imports' })).toBeNull();
      expect(c.calls.some((c) => c.path.startsWith('/api/v1/imports'))).toBe(false);
      if (mode === 'unavailable')
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    },
  );
  /** A reload recovers the durable job and hides the selector for a single destination. */
  it('should recover existing jobs and show the selector only for multiple libraries', async () => {
    const context = createTestContext();
    context.state.jobs = [structuredClone(job)];
    context.state.libraries = [{ id: 'music' }, { id: 'archive' }];
    const c = makeSUT(context);
    await screen.findByText('Saved song');
    await c.user.selectOptions(screen.getByRole('combobox', { name: 'Library' }), 'archive');
    await c.user.type(
      screen.getByRole('textbox', { name: 'YouTube links' }),
      'https://youtu.be/abcdefghijk',
    );
    await c.user.click(screen.getByRole('button', { name: 'Import links' }));
    await screen.findByText('Queued');
    expect(c.calls.find((c) => c.method === 'POST')?.body.libraryId).toBe('archive');
    c.unmount();
    context.state.libraries = [{ id: 'music' }];
    makeSUT(context);
    await screen.findByText('Saved song');
    expect(screen.queryByRole('combobox', { name: 'Library' })).toBeNull();
  });
  /** Leaving the route aborts a pending read and its late response cannot restore old data. */
  it('should discard a late response after route exit and account change', async () => {
    const context = createTestContext();
    context.state.jobs = [structuredClone(job)];
    const c = makeSUT(context);
    await screen.findByText('Saved song');
    const pending = deferred<Response>();
    context.state.pending = pending;
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() =>
      expect(context.calls.filter((c) => c.path === '/api/v1/imports')).toHaveLength(2),
    );
    const read = context.calls.filter((c) => c.path === '/api/v1/imports').at(-1)!;
    await c.user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(read.signal?.aborted).toBe(true);
    await act(async () =>
      pending.resolve(
        Response.json({
          schemaVersion: 1,
          jobs: [job],
          libraries: [{ id: 'music' }],
          nextCursor: null,
        }),
      ),
    );
    expect(screen.queryByText('Saved song')).toBeNull();
    context.state.username = 'other';
    context.state.jobs = [];
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByText('other');
    await c.user.click(screen.getByRole('link', { name: 'Imports' }));
    await screen.findByText('No imports yet');
    expect(screen.queryByText('Saved song')).toBeNull();
  });
});

/** Moving a completed job into history must preserve focused DOM and keyboard continuity. */
it('should preserve job heading focus when polling moves active work into history', async () => {
  const context = createTestContext();
  context.state.jobs = [
    { ...job, status: 'running', items: [{ ...job.items[0]!, stage: 'registering' }] },
  ];
  makeSUT(context);
  await screen.findByText('Saved song');
  const heading = screen.getByRole('heading', { level: 3 });
  heading.focus();
  vi.useFakeTimers();
  context.state.jobs = [structuredClone(job)];
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(document.activeElement).toBe(heading);
});

/** Capability recovery restores a meaningful focus target instead of leaving focus on body. */
it('should focus the page heading after unavailable capability recovery', async () => {
  const context = createTestContext();
  context.state.availability = 'temporarily_unavailable';
  const c = makeSUT(context);
  await screen.findByRole('heading', { name: 'Import worker unavailable' });
  context.state.availability = 'available';
  await c.user.click(screen.getByRole('button', { name: 'Try again' }));
  const heading = await screen.findByRole('heading', { name: 'Import music' });
  expect(document.activeElement).toBe(heading);
});

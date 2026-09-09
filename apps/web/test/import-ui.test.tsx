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
      const created: ImportJob = url.pathname.endsWith('/retries')
        ? {
            ...job,
            id: 'child-job',
            status: 'queued',
            retryOfJobId: job.id,
            items: [{ ...job.items[1]!, stage: 'queued' as const, failureCode: undefined }].map(
              ({ failureCode: _removed, ...item }) => item,
            ),
          }
        : {
            ...job,
            id: 'new-job',
            status: 'queued',
            items: [{ id: 'new-item', sourceId: 'abcdefghijk', stage: 'queued' }],
          };
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

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistSummary } from '@musiclatte/contracts';
import { PlaylistsPage } from '../src/pages/playlists/PlaylistsPage';
import { createPlaylistClient } from '../src/playlists/client';
import * as metadata from '../src/metadata/MetadataSyncProvider';
import { createMetadataClient } from '../src/metadata/client';
import { initialMetadataState } from '../src/metadata/state';

const summaries: PlaylistSummary[] = ['opaque / 한글?&', 'missing', 'failed', 'later'].map(
  (id, index) => ({
    id,
    name: `List ${index + 1}`,
    owner: 'fixture',
    songCount: 3,
    created: '2026-01-01',
    changed: '2026-01-01',
    duration: 300,
    public: false,
    editable: false,
    coverState: 'fallback',
    revision: 'A'.repeat(43),
  }),
);
const observers: { callback: IntersectionObserverCallback; elements: Set<Element> }[] = [];
class Observer {
  record: (typeof observers)[number];
  constructor(callback: IntersectionObserverCallback) {
    this.record = { callback, elements: new Set() };
    observers.push(this.record);
  }
  observe = (element: Element) => this.record.elements.add(element);
  unobserve = (element: Element) => this.record.elements.delete(element);
  disconnect = () => this.record.elements.clear();
}
function visible(...ids: string[]) {
  act(() => {
    for (const observer of observers)
      observer.callback(
        Array.from(observer.elements)
          .filter((element) => ids.includes(element.getAttribute('data-playlist-id')!))
          .map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
        {} as IntersectionObserver,
      );
  });
}
function makeSUT() {
  const pending: { id: string; signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'https://api.example.test');
    calls.push(url);
    if (url.pathname === '/api/v1/playlists')
      return Response.json({ schemaVersion: 1, playlists: summaries });
    if (url.pathname.endsWith('/artwork'))
      return new Promise((resolve) =>
        pending.push({
          id: decodeURIComponent(url.pathname.split('/').at(-2)!),
          signal: init!.signal as AbortSignal,
          resolve,
        }),
      );
    throw new Error('Unexpected fixture route');
  };
  const props = {
    base: '/nested/',
    locale: 'en' as const,
    onLocale: vi.fn(),
    fetcher,
    apiOrigin: 'https://api.example.test',
    onUnauthenticated: vi.fn(),
    canWrite: false,
    csrfToken: 'fixture-a',
  };
  const view = render(<PlaylistsPage {...props} />);
  return { pending, calls, props, view };
}
async function finish(
  pending: ReturnType<typeof makeSUT>['pending'],
  index: number,
  coverArt?: string,
  status = 200,
) {
  await act(async () =>
    pending[index]!.resolve(
      Response.json(
        status === 200
          ? {
              schemaVersion: 1,
              playlistId: pending[index]!.id,
              coverState: coverArt ? 'available' : 'fallback',
              ...(coverArt ? { coverArt } : {}),
            }
          : { error: { code: status === 401 ? 'unauthenticated' : 'upstream_unavailable' } },
        { status },
      ),
    ),
  );
}
beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', Observer);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('playlist artwork admission', () => {
  /** Text and navigation render before visible-only artwork reads, with at most one outstanding read. */
  it('should load only visible cards serially, deduplicate results and keep fallback on failure', async () => {
    const { pending, view } = makeSUT();
    expect(await screen.findByRole('link', { name: /List 1.*3 songs/ })).toBeTruthy();
    expect(pending).toHaveLength(0);
    visible(summaries[0]!.id, 'missing', 'failed');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(summaries[0]!.id);
    expect(screen.getByRole('link', { name: /List 1.*3 songs/ }).getAttribute('href')).toBe(
      '/nested/playlists/opaque%20%2F%20%ED%95%9C%EA%B8%80%3F%26',
    );
    await finish(pending, 0, 'cover / later');
    expect(pending).toHaveLength(2);
    const image = screen.getByRole('link', { name: /List 1.*3 songs/ }).querySelector('img');
    expect(image?.getAttribute('src')).toBe(
      'https://api.example.test/api/v1/media/cover/cover%20%2F%20later',
    );
    fireEvent.error(image!);
    expect(
      screen.getByRole('link', { name: /List 1.*3 songs/ }).querySelector('[data-state="failure"]'),
    ).not.toBeNull();
    await finish(pending, 1);
    await finish(pending, 2, undefined, 503);
    visible(...summaries.map((p) => p.id).slice(0, 3));
    expect(pending).toHaveLength(3);
    expect(
      screen.getByRole('link', { name: /List 2.*3 songs/ }).querySelector('[data-state="missing"]'),
    ).not.toBeNull();
    visible('later');
    expect(pending).toHaveLength(4);
    view.unmount();
    expect(pending[3]!.signal.aborted).toBe(true);
  });

  /** Metadata content changes invalidate covers while status-only polling preserves completed work. */
  it('should refresh content generations and reject late responses from the old generation', async () => {
    let state = { ...initialMetadataState };
    vi.spyOn(metadata, 'useMetadataSync').mockImplementation(() => ({
      state,
      client: createMetadataClient(),
      coverUrl: (id: string) => `/covers/${id}?v=${state.version}`,
      refresh: vi.fn(),
      refreshOrganization: vi.fn(),
    }));
    const { pending, view, props } = makeSUT();
    await screen.findByRole('link', { name: /List 1.*3 songs/ });
    visible(summaries[0]!.id);
    state = { ...state, statusVersion: 1 };
    view.rerender(<PlaylistsPage {...props} />);
    expect(pending).toHaveLength(1);
    state = { ...state, version: 1 };
    view.rerender(<PlaylistsPage {...props} />);
    expect(pending[0]!.signal.aborted).toBe(true);
    visible(summaries[0]!.id);
    expect(pending).toHaveLength(2);
    await finish(pending, 1, 'new');
    await finish(pending, 0, 'stale');
    expect(
      screen
        .getByRole('link', { name: /List 1.*3 songs/ })
        .querySelector('img')
        ?.getAttribute('src'),
    ).toBe('/covers/new?v=1');
  });

  /** Foreground refresh retries once; a changed account/client cannot reuse or complete prior artwork. */
  it('should refresh on foreground and clear requests and covers on account scope change', async () => {
    const { pending, view, props, calls } = makeSUT();
    await screen.findByRole('link', { name: /List 1.*3 songs/ });
    visible(summaries[0]!.id);
    await finish(pending, 0, 'old-cover');
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() =>
      expect(calls.filter((url) => url.pathname === '/api/v1/playlists')).toHaveLength(2),
    );
    visible(summaries[0]!.id);
    expect(pending).toHaveLength(2);
    view.rerender(<PlaylistsPage {...props} csrfToken="fixture-b" />);
    expect(pending[1]!.signal.aborted).toBe(true);
    await screen.findByRole('link', { name: /List 1.*3 songs/ });
    await finish(pending, 1, 'stale-account');
    expect(screen.getByRole('link', { name: /List 1.*3 songs/ }).querySelector('img')).toBeNull();
    visible(summaries[0]!.id);
    expect(pending).toHaveLength(3);
    await finish(pending, 2, undefined, 401);
    expect(props.onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  /** Without IntersectionObserver the same admission queue remains bounded and progresses after errors. */
  it('should use serial fallback when observers are unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { pending } = makeSUT();
    await waitFor(() => expect(pending).toHaveLength(1));
    await finish(pending, 0, undefined, 503);
    expect(pending).toHaveLength(2);
    await finish(pending, 1);
    expect(pending).toHaveLength(3);
  });
});

/** Artwork descriptors are minimal, versioned, opaque-ID bound and cannot redirect media requests. */
it('should strictly decode artwork descriptors through the authenticated API origin', async () => {
  const id = 'opaque / 한글?&';
  let body: unknown = {
    schemaVersion: 1,
    playlistId: id,
    coverState: 'available',
    coverArt: 'cover/1',
  };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(body));
  const client = createPlaylistClient({ fetcher, apiOrigin: 'https://api.example.test' });
  expect(await client.artwork(id, new AbortController().signal)).toEqual(body);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `https://api.example.test/api/v1/playlists/${encodeURIComponent(id)}/artwork`,
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    credentials: 'include',
    redirect: 'error',
    cache: 'no-store',
  });
  for (body of [
    { schemaVersion: 1, playlistId: 'wrong', coverState: 'fallback' },
    { schemaVersion: 2, playlistId: id, coverState: 'fallback' },
    { schemaVersion: 1, playlistId: id, coverState: 'fallback', coverArt: 'x' },
    { schemaVersion: 1, playlistId: id, coverState: 'available', coverArt: ' ' },
    {
      schemaVersion: 1,
      playlistId: id,
      coverState: 'available',
      coverArt: 'x',
      url: 'https://other.test',
    },
  ]) {
    await expect(client.artwork(id, new AbortController().signal)).rejects.toMatchObject({
      code: 'internal_error',
    });
  }
});

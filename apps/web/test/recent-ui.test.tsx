// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentDownloadItem, RecentDownloadResponse } from '@musiclatte/contracts';
import { Router } from '../src/app/Router';
const filter = { from: '2026-08-31T12:00:00.000Z', to: '2026-09-07T12:00:00.000Z' };
const item = (n: number): RecentDownloadItem => ({
  eventId: `event-${n}`,
  downloadCompletedAt: '2026-09-07T11:00:00.000Z',
  registeredAt: '2026-09-07T11:01:00.000Z',
  state: 'ready',
  song: { id: `song-${n}`, title: `Song ${n}`, isDir: false },
});
function createTestContext() {
  const state = {
    username: 'listener',
    supported: true,
    permission: 'allowed',
    availability: 'available',
    status: 200,
    fresh: false,
    fullNavigation: false,
    pending: null as Promise<Response> | null,
  };
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(url);
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
        instanceId: 'test',
        revision: '1',
        features: Object.fromEntries(
          [
            'music.browse',
            'music.stream',
            'playlists.read',
            'playlists.write',
            'library.recentDownloads',
            ...(state.fullNavigation
              ? ['listening.history', 'mixes.saved', 'metadata.curation', 'favorites.songs']
              : []),
          ].map((key) => [
            key,
            key === 'library.recentDownloads'
              ? {
                  supported: state.supported,
                  permission: state.permission,
                  availability: state.availability,
                }
              : { supported: true, permission: 'allowed', availability: 'available' },
          ]),
        ),
      });
    if (url.pathname.endsWith('/favorites/songs'))
      return Response.json({ schemaVersion: 1, songs: [] });
    if (url.pathname.endsWith('/music/folders'))
      return Response.json({ schemaVersion: 1, folders: [] });
    if (url.pathname.endsWith('/recent-downloads')) {
      if (state.pending) {
        const p = state.pending;
        state.pending = null;
        return p;
      }
      if (state.status !== 200)
        return Response.json(
          {
            error: {
              code:
                state.status === 401
                  ? 'unauthenticated'
                  : state.status === 403
                    ? 'forbidden'
                    : 'upstream_unavailable',
            },
          },
          { status: state.status },
        );
      const page: RecentDownloadResponse = {
        schemaVersion: 1,
        filter: url.searchParams.has('from')
          ? { from: url.searchParams.get('from')!, to: url.searchParams.get('to')! }
          : filter,
        asOf: state.fresh ? '2026-09-07T12:01:00.000Z' : filter.to,
        items: url.searchParams.has('cursor')
          ? [item(1), item(2)]
          : [
              ...(state.fresh ? [item(3)] : []),
              item(1),
              {
                eventId: 'registering',
                downloadCompletedAt: '2026-09-07T10:00:00.000Z',
                state: 'registering',
              },
              {
                eventId: 'missing',
                downloadCompletedAt: '2026-09-07T09:00:00.000Z',
                state: 'missing',
              },
            ],
        nextCursor: url.searchParams.has('cursor') ? null : 'opaque-page',
      };
      return Response.json(page);
    }
    throw new Error(`Unexpected ${url.pathname}`);
  };
  return { state, calls, fetcher };
}
function makeSUT(context = createTestContext(), path = '/music/recent') {
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', path);
  const audio = {
    src: '',
    currentTime: 0,
    duration: 0,
    volume: 1,
    paused: true,
    ended: false,
    error: null,
    load: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(async () => {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
  render(<Router fetcher={context.fetcher} audioFactory={() => audio} />);
  return { ...context, audio, user: userEvent.setup() };
}
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
describe('recent route', () => {
  /** Direct reload focuses the mounted product heading after capabilities resolve. */
  it('should focus the recent heading after direct authentication restore', async () => {
    makeSUT();
    await screen.findByText('Song 1');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Recent downloads' }));
  });

  /** Music entry is present only at the full available capability intersection. */
  it('should navigate from the music entry and default to server seven-day range', async () => {
    const c = makeSUT(undefined, '/music');
    await c.user.click(await screen.findByRole('link', { name: 'Recent downloads' }));
    expect(await screen.findByText('Song 1')).toBeTruthy();
    expect(window.location.pathname).toBe('/music/recent');
    expect(window.location.search).toBe('');
    const request = c.calls.find((url) => url.pathname.endsWith('/recent-downloads'))!;
    expect(request.searchParams.has('from')).toBe(false);
    expect(await screen.findByRole('heading', { name: 'Recent downloads' })).toBe(
      document.activeElement,
    );
    const navigation = screen.getByRole('navigation', { name: 'Music' });
    expect(
      within(navigation)
        .getByRole('link', { name: 'Recent downloads' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByRole('region', { name: 'Recent download controls' })).toBeTruthy();
  });

  /** Every available music destination stays visible below the current page heading. */
  it('should show the complete music navigation below the recent heading', async () => {
    const context = createTestContext();
    context.state.fullNavigation = true;
    makeSUT(context);

    const heading = await screen.findByRole('heading', { name: 'Recent downloads' });
    const navigation = screen
      .getAllByRole('navigation')
      .find(
        (candidate) =>
          candidate.getAttribute('data-variant') === 'tabs' &&
          within(candidate).queryByText('Recent downloads'),
      );
    expect(navigation).toBeTruthy();
    expect(
      within(navigation!)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'All music',
      'Recent listening',
      'Frequently played',
      'Saved mixes',
      'Music curation',
      'Recent downloads',
      'Favorites',
    ]);
    expect(
      heading.compareDocumentPosition(navigation!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });
  /** No empty entry remains for unsupported or unavailable producers. */
  it.each(['unsupported', 'unavailable', 'denied'])(
    'should hide the %s music entry',
    async (mode) => {
      const c = createTestContext();
      if (mode === 'unsupported') c.state.supported = false;
      if (mode === 'unavailable') c.state.availability = 'temporarily_unavailable';
      if (mode === 'denied') c.state.permission = 'denied';
      makeSUT(c, '/music');
      await screen.findByRole('heading', { name: 'All music' });
      expect(screen.queryByRole('link', { name: 'Recent downloads' })).toBeNull();
    },
  );
  /** Loaded ready songs select across pages; event refresh never selects a replacement song. */
  it('should preserve selection and player through pagination, refresh and retry', async () => {
    const c = makeSUT();
    await screen.findByText('Song 1');
    await c.user.click(screen.getByRole('button', { name: 'Select songs' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await c.user.click(screen.getByRole('checkbox', { name: 'Select Song 1' }));
    expect(c.audio.play).not.toHaveBeenCalled();
    await c.user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Song 2');
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    await c.user.click(screen.getByRole('checkbox', { name: 'Select Song 2' }));
    await c.user.click(screen.getByRole('button', { name: 'Play loaded songs' }));
    await waitFor(() => expect(c.audio.play).toHaveBeenCalled());
    c.audio.pause.mockClear();
    c.state.fresh = true;
    await c.user.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Song 3');
    expect(
      (screen.getByRole('checkbox', { name: 'Deselect Song 1' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole('checkbox', { name: 'Select Song 3' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.getByText('2 songs selected')).toBeTruthy();
    c.state.status = 503;
    await c.user.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('alert');
    expect(screen.getByText('2 songs selected')).toBeTruthy();
    expect(screen.getAllByText('Song 1').length).toBeGreaterThan(0);
    expect(c.audio.pause).not.toHaveBeenCalled();
    c.state.status = 200;
    await c.user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
  /** Custom period commits reset scope, invalid input focuses the field, and no dates enter the URL. */
  it('should apply a local date range and reset selection explicitly', async () => {
    const c = makeSUT();
    await screen.findByText('Song 1');
    await c.user.click(screen.getByRole('button', { name: 'Select songs' }));
    await c.user.click(screen.getByRole('checkbox', { name: 'Select Song 1' }));
    await c.user.selectOptions(screen.getByLabelText('Period'), 'custom');
    await c.user.click(screen.getByRole('button', { name: 'Apply dates' }));
    expect(screen.getByLabelText('From date').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-05' } });
    fireEvent.change(screen.getByLabelText('Through date'), { target: { value: '2026-09-04' } });
    await c.user.click(screen.getByRole('button', { name: 'Apply dates' }));
    expect(screen.getByLabelText('Through date')).toBe(document.activeElement);
    fireEvent.change(screen.getByLabelText('Through date'), { target: { value: '2026-09-06' } });
    await c.user.click(screen.getByRole('button', { name: 'Apply dates' }));
    await waitFor(() => expect(c.calls.some((url) => url.searchParams.has('from'))).toBe(true));
    expect(screen.queryByText('1 song selected')).toBeNull();
    expect(window.location.search).toBe('');
  });
  /** Applying a new-item notice keeps keyboard focus inside the refreshed page. */
  it('should focus the heading after applying the new-item notice', async () => {
    const c = makeSUT();
    await screen.findByText('Song 1');
    c.state.fresh = true;
    await act(async () => window.dispatchEvent(new Event('focus')));
    await c.user.click(await screen.findByRole('button', { name: 'Show new downloads' }));
    await screen.findByText('Song 3');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Recent downloads' }));
  });
  /** Capability outages retain an already loaded snapshot and its selection. */
  it('should retain selection when capability temporarily becomes unavailable', async () => {
    const c = makeSUT();
    await screen.findByText('Song 1');
    await c.user.click(screen.getByRole('button', { name: 'Select songs' }));
    await c.user.click(screen.getByRole('checkbox', { name: 'Select Song 1' }));
    c.state.availability = 'temporarily_unavailable';
    await act(async () => window.dispatchEvent(new Event('focus')));
    await screen.findByRole('alert');
    expect(screen.getByText('1 song selected')).toBeTruthy();
    expect(screen.getByText('Song 1')).toBeTruthy();
  });
  /** Finishing the last page retains a keyboard target instead of dropping focus to body. */
  it('should keep load-more focus after the final page', async () => {
    const c = makeSUT();
    await screen.findByText('Song 1');
    const more = screen.getByRole('button', { name: 'Load more' });
    await c.user.click(more);
    await screen.findByText('Song 2');
    expect(document.activeElement).toBe(more);
    expect(more.isConnected).toBe(true);
  });
  /** Account swaps abort and fence old response data and selection. */
  it('should ignore the old account response after account replacement', async () => {
    const c = makeSUT();
    await screen.findByText('Song 1');
    let resolve!: (value: Response) => void;
    c.state.pending = new Promise((r) => {
      resolve = r;
    });
    await c.user.click(screen.getByRole('button', { name: 'Refresh' }));
    c.state.username = 'other';
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() =>
      expect(c.calls.filter((u) => u.pathname.endsWith('/recent-downloads')).length).toBe(3),
    );
    await act(async () =>
      resolve(
        Response.json({
          schemaVersion: 1,
          filter,
          asOf: filter.to,
          nextCursor: null,
          items: [item(99)],
        }),
      ),
    );
    expect(screen.queryByText('Song 99')).toBeNull();
  });
  /** Expired sessions keep a safe recent returnTo; forbidden API responses provide a recovery link. */
  it.each([401, 403])('should recover from HTTP %s', async (status) => {
    const c = createTestContext();
    c.state.status = status;
    makeSUT(c);
    if (status === 401) await waitFor(() => expect(window.location.pathname).toBe('/login'));
    else expect(await screen.findByRole('link', { name: 'Back to music' })).toBeTruthy();
    if (status === 401)
      expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/music/recent');
  });
});

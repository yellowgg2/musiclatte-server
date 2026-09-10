// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArtistInfoPanel } from '../src/pages/music/ArtistInfoPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps local artist navigation and exposes plain expandable information', async () => {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    calls.push(new URL(String(input)));
    return Response.json({
      schemaVersion: 1,
      artistId: 'ar-1',
      state: 'available',
      biography: '<script>must stay text</script> ' + 'Long biography. '.repeat(40),
      coverArtId: 'cover-local',
      similarArtists: [{ id: 'ar-2', name: 'Related artist' }],
    });
  };
  const user = userEvent.setup();
  render(
    <ArtistInfoPanel
      artistId="ar-1"
      artistName="Current artist"
      base="/"
      locale="en"
      fetcher={fetcher}
      apiOrigin="https://api.example.test"
      coverUrl={(id) => `/api/v1/media/cover/${encodeURIComponent(id)}`}
      onUnauthenticated={() => {}}
    />,
  );
  expect(await screen.findByText(/Long biography/)).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
  const image = screen.getByRole('img', { name: 'Current artist artwork' });
  expect(image.getAttribute('data-state')).toBe('loading');
  expect(document.querySelector('img')?.getAttribute('src')).toBe(
    '/api/v1/media/cover/cover-local',
  );
  expect(screen.getByRole('link', { name: 'Related artist' }).getAttribute('href')).toBe(
    '/music/artists/ar-2',
  );
  await user.click(screen.getByRole('button', { name: 'Show more' }));
  expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
  expect(calls[0]!.pathname).toBe('/api/v1/music/artists/ar-1/info');
});

it('keeps empty and retryable failure independent', async () => {
  let attempt = 0;
  const fetcher: typeof fetch = async () => {
    attempt++;
    if (attempt === 1)
      return Response.json(
        { schemaVersion: 1, error: { code: 'upstream_unavailable', retryable: true } },
        { status: 503 },
      );
    return Response.json({
      schemaVersion: 1,
      artistId: 'ar-1',
      state: 'empty',
      similarArtists: [],
    });
  };
  const user = userEvent.setup();
  render(
    <ArtistInfoPanel
      artistId="ar-1"
      artistName="Current artist"
      base="/"
      locale="en"
      fetcher={fetcher}
      apiOrigin=""
      coverUrl={() => ''}
      onUnauthenticated={() => {}}
    />,
  );
  expect((await screen.findByRole('alert')).textContent).toContain('unavailable');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.getByText('No server information is available.')).toBeTruthy());
});

it('ignores a stale artist response after rapid navigation', async () => {
  let finish: ((response: Response) => void) | undefined;
  const fetcher: typeof fetch = async (input) => {
    const id = new URL(String(input), 'http://localhost').pathname.includes('ar-1');
    if (id) return new Promise<Response>((resolve) => (finish = resolve));
    return Response.json({
      schemaVersion: 1,
      artistId: 'ar-2',
      state: 'available',
      biography: 'Second artist',
      similarArtists: [],
    });
  };
  const props = {
    artistName: 'Artist',
    base: '/',
    locale: 'en' as const,
    fetcher,
    apiOrigin: '',
    coverUrl: () => '',
    onUnauthenticated: () => {},
  };
  const view = render(<ArtistInfoPanel {...props} artistId="ar-1" />);
  view.rerender(<ArtistInfoPanel {...props} artistId="ar-2" />);
  expect(await screen.findByText('Second artist')).toBeTruthy();
  finish?.(
    Response.json({
      schemaVersion: 1,
      artistId: 'ar-1',
      state: 'available',
      biography: 'Stale artist',
      similarArtists: [],
    }),
  );
  await Promise.resolve();
  expect(screen.queryByText('Stale artist')).toBeNull();
});

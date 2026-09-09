// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Router } from '../src/app/Router';
import { createCurationUIFixture } from '../../../tools/verification/curation-ui-fixture';
class Audio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 180;
  volume = 1;
  paused = true;
  ended = false;
  error = null;
  load = vi.fn();
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  play = vi.fn(async () => {
    this.paused = false;
    this.dispatchEvent(new Event('playing'));
  });
}
function setup() {
  let mode = 'normal';
  const fixture = createCurationUIFixture(() => mode);
  const audio = new Audio();
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', '/music/curation');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(<Router fetcher={fixture.fetcher} audioFactory={() => audio} />);
  return {
    ...fixture,
    audio,
    user: userEvent.setup(),
    mode: (v: string) => {
      mode = v;
    },
  };
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
it('renders completed with missing lyrics, pages a frozen list, filters independently and opens current editor status', async () => {
  const c = setup();
  await screen.findByText(/Showing 25 of 27/);
  await c.user.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByText(/Showing 27 of 27/);
  await c.user.selectOptions(
    screen.getByRole('combobox', { name: 'Required review status' }),
    'completed',
  );
  await c.user.selectOptions(
    screen.getByRole('combobox', { name: 'Optional information' }),
    'lyrics',
  );
  await screen.findByText(/Showing 25 of 25/);
  expect(screen.getAllByText(/Required review completed · Lyrics: Missing/).length).toBe(25);
  await c.user.click(
    screen.getByRole('button', { name: 'Curation details for Evening in the studio' }),
  );
  await screen.findByText('Required review and optional information are independent.');
  await c.user.click(
    screen.getByRole('button', { name: 'Music information: Evening in the studio' }),
  );
  await c.user.click(await screen.findByRole('button', { name: 'Edit music information' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('Required review completed');
});
it('does not reset active playback when filters or locale change', async () => {
  const c = setup();
  await screen.findByText(/Showing 25 of 27/);
  await c.user.click(screen.getByRole('button', { name: 'Play Evening in the studio' }));
  await waitFor(() => expect(c.audio.play).toHaveBeenCalledTimes(1));
  act(() => {
    c.audio.currentTime = 42;
    c.audio.dispatchEvent(new Event('timeupdate'));
  });
  const src = c.audio.src;
  await c.user.selectOptions(
    screen.getByRole('combobox', { name: 'Required review status' }),
    'needs_review',
  );
  await screen.findByText(/Showing 1 of 1/);
  await c.user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ko');
  expect(c.audio.currentTime).toBe(42);
  expect(c.audio.src).toBe(src);
  expect(c.audio.play).toHaveBeenCalledTimes(1);
});
it('requires a fresh snapshot after expiry and distinguishes partial inventory from no matching tracks', async () => {
  const c = setup();
  await screen.findByText(/Showing 25 of 27/);
  c.mode('snapshot-expired');
  await c.user.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('button', { name: 'Reload current list' });
  expect(screen.queryByText('Evening in the studio')).toBeNull();
  c.mode('inventory-pending');
  await c.user.click(screen.getByRole('button', { name: 'Reload current list' }));
  await screen.findByText(/Library verification is not finished/);
  await c.user.selectOptions(screen.getByRole('combobox', { name: 'File format' }), 'unsupported');
  await screen.findByText('No matching tracks');
  expect(screen.getAllByText(/Library verification is not finished/).length).toBeGreaterThan(0);
});
it('refreshes curation from a real metadata change response after optional editing and retains completion', async () => {
  const c = setup();
  await screen.findByText(/Showing 25 of 27/);
  await c.user.click(
    screen.getByRole('button', { name: 'Music information: Evening in the studio' }),
  );
  await c.user.click(await screen.findByRole('button', { name: 'Edit music information' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('Required review completed');
  await c.user.type(
    within(dialog).getByRole('textbox', { name: 'Lyrics text' }),
    'Original synthetic words',
  );
  await c.user.click(within(dialog).getByRole('button', { name: 'Review changes' }));
  await c.user.click(await screen.findByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await screen.findByText(/Required review completed · Lyrics: Present/);
  expect(c.requests.some((r) => r.path === '/api/v1/metadata-changes')).toBe(true);
});
it('removes previous rows when current authorization is denied', async () => {
  const c = setup();
  await screen.findByText(/Showing 25 of 27/);
  c.mode('scope-denied');
  await c.user.click(screen.getByRole('button', { name: 'Refresh list' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Evening in the studio')).toBeNull();
});
it('discards a late previous-filter response from the actual Router', async () => {
  const fixture = createCurationUIFixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const fetcher: typeof fetch = async (input, init) => {
    const response = await fixture.fetcher(input, init);
    if (String(input).includes('/tracks?') && first) {
      first = false;
      await pending;
    }
    return response;
  };
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', '/music/curation');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(<Router fetcher={fetcher} audioFactory={() => new Audio()} />);
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByRole('combobox', { name: 'Required review status' }),
    'needs_review',
  );
  await screen.findByText(/Showing 1 of 1/);
  await act(async () => release());
  expect(screen.queryByText('Evening in the studio')).toBeNull();
  expect(screen.getByText('Studio track 2')).toBeTruthy();
});

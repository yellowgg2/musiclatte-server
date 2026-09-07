// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from '../src/app/Router';
import { engineFixture } from '../../../tests/support/engine-fixtures';
function createTestContext() {
  const state = {
    username: 'manager',
    supported: true,
    permission: 'allowed',
    availability: 'available',
    revision: '1',
    status: 200,
    value: engineFixture(),
    pending: null as Promise<Response> | null,
  };
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    calls.push({ path, init });
    if (path.endsWith('/session'))
      return Response.json({
        schemaVersion: 1,
        authScheme: 'cookie',
        username: state.username,
        expiresAt: Date.now() + 3600000,
        csrfToken: `synthetic-${state.username}`,
      });
    if (path.endsWith('/capabilities'))
      return Response.json({
        schemaVersion: 1,
        instanceId: 'test',
        revision: state.revision,
        features: {
          'music.browse': { supported: false, permission: 'denied', availability: 'available' },
          'engine.manage': {
            supported: state.supported,
            permission: state.permission,
            availability: state.availability,
          },
        },
      });
    if (path.endsWith('/engine')) {
      if (state.pending) {
        const promise = state.pending;
        state.pending = null;
        return promise;
      }
      if (state.status !== 200) return new Response('private error', { status: state.status });
      return Response.json(state.value, { status: init?.method === 'POST' ? 202 : 200 });
    }
    throw new Error(`Unexpected ${path}`);
  };
  return { state, calls, fetcher };
}
function makeSUT(context = createTestContext()) {
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', '/settings');
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
  const audioFactory = vi.fn(() => audio);
  render(<Router fetcher={context.fetcher} audioFactory={audioFactory} />);
  return { ...context, audioFactory, user: userEvent.setup() };
}
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
const panel = () => screen.getByRole('region', { name: 'Download engine' });
const ready = () => screen.findByText('nightly-2026.09.07');
describe('engine settings', () => {
  /** Unknown, denied and unsupported capabilities never render a management placeholder or read API. */
  it.each([
    { supported: false },
    { permission: 'denied' },
    { permission: 'unknown' },
    { availability: 'unknown' },
    { permission: 'unknown', availability: 'temporarily_unavailable' },
  ])('should hide non-manager state %j', async (patch) => {
    const context = createTestContext();
    Object.assign(context.state, patch);
    const c = makeSUT(context);
    await screen.findByText('manager');
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Download engine' })).toBeNull();
    expect(c.calls.some((call) => call.path.endsWith('/engine'))).toBe(false);
  });
  /** Every lifecycle state remains labeled with preserved active version and no previous control misuse. */
  it.each([
    ['never_checked', 'Not checked yet'],
    ['checking', 'Checking for an update'],
    ['up_to_date', 'No new version'],
    ['candidate_pending_validation', 'Waiting for source validation'],
    ['active', 'Active'],
    ['update_failed', 'Update check failed'],
    ['validation_failed', 'Candidate validation failed'],
    ['restored', 'Previous version restored'],
  ] as const)('should explain %s', async (status, label) => {
    const context = createTestContext();
    context.state.value = engineFixture({
      status,
      ...(status === 'never_checked'
        ? { previousVersion: null, recoverability: 'no_previous', lastCheckedAt: null }
        : {}),
      ...(status === 'candidate_pending_validation'
        ? { candidateVersion: 'nightly-candidate' }
        : {}),
    });
    makeSUT(context);
    await ready();
    expect(within(panel()).getByText(label)).toBeTruthy();
    expect(within(panel()).getByText('Active version')).toBeTruthy();
    expect(
      (
        within(panel()).getByRole('button', {
          name: 'Restore previous version',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(status === 'checking' || status === 'never_checked');
    if (status === 'candidate_pending_validation')
      expect(within(panel()).getByText(/next eligible source/)).toBeTruthy();
  });
  /** A known unavailable manager retains status context and explicit recovery. */
  it('should keep the unavailable manager panel and retry capabilities', async () => {
    const context = createTestContext();
    context.state.availability = 'temporarily_unavailable';
    const c = makeSUT(context);
    await ready();
    expect(within(panel()).getByText('Engine management is temporarily unavailable')).toBeTruthy();
    c.state.availability = 'available';
    await c.user.click(within(panel()).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(
        within(panel()).queryByText('Engine management is temporarily unavailable'),
      ).toBeNull(),
    );
  });
  /** Accepted is not completed; duplicate submits are locked until observed progress settles. */
  it('should show accepted check, poll progress, and preserve action focus', async () => {
    const c = makeSUT();
    await ready();
    let resolve!: (r: Response) => void;
    c.state.pending = new Promise((r) => {
      resolve = r;
    });
    const check = within(panel()).getByRole('button', { name: 'Check now' });
    await c.user.click(check);
    fireEvent.click(check);
    expect(c.calls.filter((call) => call.init?.method === 'POST')).toHaveLength(1);
    expect(document.activeElement).toBe(
      within(panel()).getByRole('group', { name: 'Engine actions' }),
    );
    c.state.value = engineFixture({ status: 'checking' });
    await act(async () => resolve(Response.json(engineFixture(), { status: 202 })));
    expect(within(panel()).getByText(/Check requested/)).toBeTruthy();
    await screen.findByText('Checking for an update', {}, { timeout: 4500 });
    c.state.value = engineFixture({ status: 'up_to_date' });
    await screen.findByText('No new version', {}, { timeout: 4500 });
    await waitFor(() => expect((check as HTMLButtonElement).disabled).toBe(false));
    expect(document.activeElement).toBe(check);
  });
  /** A daily-budget no-op retains the independently read status without inventing an update failure. */
  it('should settle an acknowledged coalesced check without changing the displayed engine', async () => {
    const c = makeSUT();
    await ready();
    await c.user.click(within(panel()).getByRole('button', { name: 'Check now' }));
    expect(within(panel()).getByText(/Check requested/)).toBeTruthy();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000);
    await waitFor(() => expect(within(panel()).queryByText(/Check requested/)).toBeNull(), {
      timeout: 4500,
    });
    expect(within(panel()).queryByRole('alert')).toBeNull();
    expect(
      (within(panel()).getByRole('button', { name: 'Check now' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(c.calls.filter((call) => call.init?.method === 'POST')).toHaveLength(1);
    expect(within(panel()).getByText(c.state.value.activeVersion!)).toBeTruthy();
  });
  /** Repeating an already-restored pointer is a server no-op and must not become a false timeout. */
  it('should settle an already restored pointer without expecting another swap', async () => {
    const context = createTestContext();
    context.state.value = engineFixture({ status: 'restored' });
    const c = makeSUT(context);
    await ready();
    await c.user.click(within(panel()).getByRole('button', { name: 'Restore previous version' }));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000);
    await waitFor(() => expect(within(panel()).queryByText(/Restore requested/)).toBeNull(), {
      timeout: 4500,
    });
    expect(within(panel()).queryByRole('alert')).toBeNull();
    expect(within(panel()).getByText('Previous version restored')).toBeTruthy();
    expect(c.calls.filter((call) => call.init?.method === 'POST')).toHaveLength(1);
  });
  /** Restore acknowledgement remains pending until the active pointer actually changes. */
  it('should explain next-job restore and observe completion', async () => {
    const c = makeSUT();
    await ready();
    await c.user.click(within(panel()).getByRole('button', { name: 'Restore previous version' }));
    expect(within(panel()).getByText(/Restore requested/)).toBeTruthy();
    expect(
      within(panel()).getByText(/Running imports and saved music playback continue/),
    ).toBeTruthy();
    c.state.value = engineFixture({
      activeVersion: 'nightly-2026.09.06',
      previousVersion: 'nightly-2026.09.07',
      status: 'restored',
    });
    await screen.findByText('Previous version restored', {}, { timeout: 4500 });
    expect(c.calls.filter((call) => call.init?.method === 'POST')).toHaveLength(1);
  });
  /** Account changes discard both late successes and late authentication errors. */
  it.each([200, 401])('should discard a late account read with HTTP %s', async (status) => {
    const context = createTestContext();
    let resolve!: (r: Response) => void;
    context.state.pending = new Promise((r) => {
      resolve = r;
    });
    const c = makeSUT(context);
    await waitFor(() => expect(c.calls.some((call) => call.path.endsWith('/engine'))).toBe(true));
    c.state.username = 'other-manager';
    c.state.value = engineFixture({ activeVersion: 'other-version' });
    fireEvent(window, new Event('focus'));
    await screen.findByText('other-version');
    await act(async () =>
      resolve(Response.json(engineFixture({ activeVersion: 'stale-version' }), { status })),
    );
    expect(screen.queryByText('stale-version')).toBeNull();
    expect(screen.getByText('other-version')).toBeTruthy();
  });
  /** Permission loss invalidates pending mutations before a late error can expire the new session. */
  it('should discard a late action after capability revocation', async () => {
    const c = makeSUT();
    await ready();
    let resolve!: (r: Response) => void;
    c.state.pending = new Promise((r) => {
      resolve = r;
    });
    await c.user.click(within(panel()).getByRole('button', { name: 'Check now' }));
    c.state.permission = 'denied';
    fireEvent(window, new Event('focus'));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Download engine' })).toBeNull(),
    );
    await act(async () => resolve(new Response('', { status: 401 })));
    expect(screen.getByText('manager')).toBeTruthy();
  });
  /** Errors are local, safe, recoverable and do not remount audio during locale changes. */
  it('should recover a failed read and switch locale without remounting the player', async () => {
    const context = createTestContext();
    context.state.status = 503;
    const c = makeSUT(context);
    await screen.findByText('Could not refresh engine status');
    c.state.status = 200;
    await c.user.click(within(panel()).getByRole('button', { name: 'Try again' }));
    await ready();
    const count = c.audioFactory.mock.calls.length;
    await c.user.selectOptions(screen.getByRole('combobox'), 'ko');
    expect(screen.getByRole('region', { name: '다운로드 엔진' })).toBeTruthy();
    expect(c.audioFactory).toHaveBeenCalledTimes(count);
    expect(screen.queryByText('private error')).toBeNull();
  });
  /** Unconfirmed actions require explicit refresh; a background read cannot silently unlock replay. */
  it('should retain an unknown action outcome until explicit recovery', async () => {
    const c = makeSUT();
    await ready();
    await c.user.click(within(panel()).getByRole('button', { name: 'Restore previous version' }));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 31000);
    await screen.findByText(
      'The result could not be confirmed. Refresh before trying again.',
      {},
      { timeout: 4500 },
    );
    const count = c.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2200));
    });
    expect(c.calls.length).toBe(count);
    expect(
      (within(panel()).getByRole('button', { name: 'Check now' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await c.user.click(within(panel()).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(
        (within(panel()).getByRole('button', { name: 'Check now' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  }, 10000);
  /** A slow initial read must settle before the polling interval starts another request. */
  it('should never overlap the initial status read with polling', async () => {
    const context = createTestContext();
    let resolve!: (response: Response) => void;
    context.state.pending = new Promise((done) => {
      resolve = done;
    });
    const c = makeSUT(context);
    await waitFor(() =>
      expect(c.calls.filter((call) => call.path.endsWith('/engine'))).toHaveLength(1),
    );
    await act(async () => {
      await new Promise((done) => setTimeout(done, 2200));
    });
    expect(c.calls.filter((call) => call.path.endsWith('/engine'))).toHaveLength(1);
    await act(async () => resolve(Response.json(engineFixture())));
    await ready();
  });
});

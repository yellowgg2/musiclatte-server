// @vitest-environment jsdom
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ComponentType, type ReactNode } from 'react';

async function moduleAt(path: string) {
  const file = resolve(`apps/web/src/${path}`);
  expect(existsSync(file), `${path} implementation`).toBe(true);
  return import(file);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const capabilities = {
  schemaVersion: 1,
  instanceId: 'fixture-instance',
  revision: 'account-shell',
  features: {
    'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
    'playlists.read': { supported: true, permission: 'allowed', availability: 'available' },
    'favorites.songs': { supported: true, permission: 'allowed', availability: 'available' },
  },
} as const;

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('global account shell', () => {
  /** The client requests the aggregate without account input and rejects malformed counts. */
  it('should decode only a strict non-negative account summary', async () => {
    const { createAccountSummaryClient } = (await moduleAt('account/client.ts')) as {
      createAccountSummaryClient: (options: { fetcher: typeof fetch; apiOrigin: string }) => {
        read: (signal: AbortSignal) => Promise<unknown>;
      };
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) });
      return Response.json({ schemaVersion: 1, favoriteSongCount: 2, playlistCount: 3 });
    };
    const client = createAccountSummaryClient({
      fetcher,
      apiOrigin: 'https://api.example.test',
    });

    await expect(client.read(new AbortController().signal)).resolves.toEqual({
      schemaVersion: 1,
      favoriteSongCount: 2,
      playlistCount: 3,
    });
    expect(calls[0]?.url).toBe('https://api.example.test/api/v1/account/summary');
    expect(calls[0]?.init?.credentials).toBe('include');
    expect(calls[0]?.init?.method).toBeUndefined();

    const malformed = createAccountSummaryClient({
      fetcher: async () =>
        Response.json({ schemaVersion: 1, favoriteSongCount: -1, playlistCount: 1 }),
      apiOrigin: '',
    });
    await expect(malformed.read(new AbortController().signal)).rejects.toThrow('internal_error');
  });

  /** Scope changes clear stale data, ignore late responses, and same-account retry preserves success. */
  it('should own loading, ready, error, retry, and account-instance lifetime', async () => {
    const { AccountSummaryProvider, useAccountSummary } = (await moduleAt(
      'account/AccountSummaryProvider.tsx',
    )) as {
      AccountSummaryProvider: ComponentType<{
        scope: string;
        enabled: boolean;
        fetcher: typeof fetch;
        apiOrigin: string;
        onUnauthenticated: () => void;
        children: ReactNode;
      }>;
      useAccountSummary: () => {
        state: {
          status: string;
          summary?: { favoriteSongCount: number; playlistCount: number };
        };
        refresh: () => void;
      };
    };
    const first = deferred<Response>();
    const second = deferred<Response>();
    const third = deferred<Response>();
    const responses: Array<Promise<Response> | Response> = [
      first.promise,
      second.promise,
      third.promise,
      Response.json({ error: { code: 'upstream_unavailable' } }, { status: 503 }),
      Response.json({ schemaVersion: 1, favoriteSongCount: 7, playlistCount: 8 }),
    ];
    const fetcher: typeof fetch = async () => await responses.shift()!;
    function Probe() {
      const { state, refresh } = useAccountSummary();
      return (
        <div>
          <span data-testid="summary-status">{state.status}</span>
          {state.summary && (
            <span data-testid="summary-counts">
              {state.summary.favoriteSongCount}:{state.summary.playlistCount}
            </span>
          )}
          <button onClick={refresh}>Refresh summary</button>
        </div>
      );
    }
    const renderScope = (scope: string) => (
      <AccountSummaryProvider
        scope={scope}
        enabled
        fetcher={fetcher}
        apiOrigin=""
        onUnauthenticated={vi.fn()}
      >
        <Probe />
      </AccountSummaryProvider>
    );
    const view = render(renderScope('fixture-a:instance-a'));
    expect(screen.getByTestId('summary-status').textContent).toBe('loading');

    view.rerender(renderScope('fixture-b:instance-b'));
    expect(screen.queryByTestId('summary-counts')).toBeNull();
    await act(async () =>
      first.resolve(Response.json({ schemaVersion: 1, favoriteSongCount: 99, playlistCount: 99 })),
    );
    expect(screen.queryByTestId('summary-counts')).toBeNull();

    await act(async () =>
      second.resolve(Response.json({ schemaVersion: 1, favoriteSongCount: 4, playlistCount: 5 })),
    );
    expect((await screen.findByTestId('summary-counts')).textContent).toBe('4:5');

    view.rerender(renderScope('fixture-c:instance-c'));
    expect(screen.queryByTestId('summary-counts')).toBeNull();
    await act(async () =>
      third.resolve(Response.json({ schemaVersion: 1, favoriteSongCount: 6, playlistCount: 7 })),
    );
    expect((await screen.findByTestId('summary-counts')).textContent).toBe('6:7');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Refresh summary' }));
    await waitFor(() => expect(screen.getByTestId('summary-status').textContent).toBe('error'));
    expect(screen.getByTestId('summary-counts').textContent).toBe('6:7');
    await user.click(screen.getByRole('button', { name: 'Refresh summary' }));
    expect((await screen.findByTestId('summary-counts')).textContent).toBe('7:8');
    expect(screen.getByTestId('summary-status').textContent).toBe('ready');
  });

  /** Desktop and mobile surfaces share identity, links, focus return, and explicit logout. */
  it('should expose responsive account actions without hiding route content', async () => {
    const { AccountSummaryProvider } = (await moduleAt('account/AccountSummaryProvider.tsx')) as {
      AccountSummaryProvider: ComponentType<{
        scope: string;
        enabled: boolean;
        fetcher: typeof fetch;
        apiOrigin: string;
        onUnauthenticated: () => void;
        children: ReactNode;
      }>;
    };
    const { AppShell } = (await moduleAt('app/AppShell.tsx')) as {
      AppShell: ComponentType<{
        locale: 'en';
        base: string;
        capabilities: typeof capabilities;
        account: {
          username: string;
          busy: boolean;
          error: null;
          onLogout: () => void;
        };
        children: ReactNode;
      }>;
    };
    const logout = vi.fn();
    const fetcher: typeof fetch = async () =>
      Response.json({ schemaVersion: 1, favoriteSongCount: 2, playlistCount: 3 });
    render(
      <AccountSummaryProvider
        scope="fixture-listener:fixture-instance"
        enabled
        fetcher={fetcher}
        apiOrigin=""
        onUnauthenticated={vi.fn()}
      >
        <AppShell
          locale="en"
          base="/"
          capabilities={capabilities}
          account={{ username: 'fixture-listener', busy: false, error: null, onLogout: logout }}
        >
          <h1>Current route</h1>
        </AppShell>
      </AccountSummaryProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Current route' })).toBeTruthy();
    const account = await screen.findByRole('region', { name: 'Current account' });
    expect(within(account).getByText('fixture-listener')).toBeTruthy();
    expect(within(account).getByRole('link', { name: '2 favorites' })).toBeTruthy();
    expect(within(account).getByRole('link', { name: '3 playlists' })).toBeTruthy();
    await userEvent.click(within(account).getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);

    const trigger = screen.getByRole('button', {
      name: 'Open account menu for fixture-listener',
    });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Current account' });
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(within(dialog).getByRole('link', { name: '2 favorites' })).toBeTruthy();
    within(dialog).getByRole('button', { name: 'Sign out' }).focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Close account menu' }),
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Current account' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await userEvent.click(trigger);
    const reopened = screen.getByRole('dialog', { name: 'Current account' });
    fireEvent.mouseDown(reopened.parentElement!);
    expect(screen.queryByRole('dialog', { name: 'Current account' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  /** Count links follow each capability independently and still render a meaningful zero. */
  it('should keep identity available when account-count capabilities are partial', async () => {
    const { AccountSummaryProvider } = (await moduleAt('account/AccountSummaryProvider.tsx')) as {
      AccountSummaryProvider: ComponentType<{
        scope: string;
        enabled: boolean;
        fetcher: typeof fetch;
        apiOrigin: string;
        onUnauthenticated: () => void;
        children: ReactNode;
      }>;
    };
    const { AppShell } = (await moduleAt('app/AppShell.tsx')) as {
      AppShell: ComponentType<Record<string, unknown>>;
    };
    render(
      <AccountSummaryProvider
        scope="fixture-listener:fixture-instance"
        enabled
        fetcher={async () =>
          Response.json({ schemaVersion: 1, favoriteSongCount: 0, playlistCount: 9 })
        }
        apiOrigin=""
        onUnauthenticated={vi.fn()}
      >
        <AppShell
          locale="en"
          base="/"
          capabilities={{
            ...capabilities,
            features: {
              ...capabilities.features,
              'playlists.read': {
                supported: true,
                permission: 'denied',
                availability: 'available',
              },
            },
          }}
          account={{ username: 'fixture-listener', busy: false, error: null, onLogout: vi.fn() }}
        >
          <h1>Route</h1>
        </AppShell>
      </AccountSummaryProvider>,
    );
    const account = screen.getByRole('region', { name: 'Current account' });
    expect(within(account).getByText('fixture-listener')).toBeTruthy();
    expect(await within(account).findByRole('link', { name: '0 favorites' })).toBeTruthy();
    expect(within(account).queryByRole('link', { name: /playlists/ })).toBeNull();
    expect(within(account).getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  /** Logout busy state blocks repeat activation and prevents dismissing the mobile surface. */
  it('should keep recoverable logout state inside the account surface', async () => {
    const { AccountSummaryProvider } = (await moduleAt('account/AccountSummaryProvider.tsx')) as {
      AccountSummaryProvider: ComponentType<{
        scope: string;
        enabled: boolean;
        fetcher: typeof fetch;
        apiOrigin: string;
        onUnauthenticated: () => void;
        children: ReactNode;
      }>;
    };
    const { AppShell } = (await moduleAt('app/AppShell.tsx')) as {
      AppShell: ComponentType<Record<string, unknown>>;
    };
    const logout = vi.fn();
    function Harness() {
      const [busy, setBusy] = useState(false);
      return (
        <AccountSummaryProvider
          scope="fixture-listener:fixture-instance"
          enabled={false}
          fetcher={fetch}
          apiOrigin=""
          onUnauthenticated={vi.fn()}
        >
          <AppShell
            locale="en"
            base="/"
            capabilities={capabilities}
            account={{
              username: 'fixture-listener',
              busy,
              error: busy ? 'upstream_unavailable' : null,
              onLogout: () => {
                logout();
                setBusy(true);
              },
            }}
          >
            <h1>Route</h1>
          </AppShell>
        </AccountSummaryProvider>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', {
      name: 'Open account menu for fixture-listener',
    });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Current account' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(
      (within(dialog).getByRole('button', { name: 'Signing out' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Signing out' }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText(/reach the server/)).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Current account' })).toBeTruthy();
  });
});

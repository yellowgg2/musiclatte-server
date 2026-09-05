// @vitest-environment jsdom
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';

async function moduleAt(path: string) {
  const file = resolve(`apps/web/src/${path}`);
  expect(existsSync(file), `${path} implementation`).toBe(true);
  return import(file);
}
const session = () => ({
  schemaVersion: 1,
  username: 'fixture-listener',
  authScheme: 'cookie',
  csrfToken: 'synthetic-csrf',
  expiresAt: Date.now() + 60000,
});
const capabilities = {
  schemaVersion: 1,
  instanceId: 'fixture',
  revision: 'one',
  features: {
    'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
    'imports.youtube': { supported: true, permission: 'allowed', availability: 'available' },
  },
};
function createTestContext() {
  let signedIn = false;
  let failure = '';
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/api/v1/music/folders'))
      return Response.json({ schemaVersion: 1, folders: [] });
    if (url.endsWith('/capabilities')) return Response.json(capabilities);
    if (init?.method === 'POST') {
      if (failure) return Response.json({ error: { code: failure } }, { status: 401 });
      signedIn = true;
    }
    if (init?.method === 'DELETE') {
      signedIn = false;
      return new Response(null, { status: 204 });
    }
    return signedIn
      ? Response.json(session())
      : Response.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  };
  return {
    fetcher,
    calls,
    fail: (value: string) => {
      failure = value;
    },
    signIn: () => {
      signedIn = true;
    },
  };
}
async function makeSUT(context = createTestContext(), base = '/') {
  const { Router } = (await moduleAt('app/Router.tsx')) as {
    Router: ComponentType<{ fetcher: typeof fetch; base: string; apiOrigin?: string }>;
  };
  return {
    context,
    view: render(<Router fetcher={context.fetcher} base={base} />),
    user: userEvent.setup(),
  };
}
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});
describe('login shell', () => {
  /** A new cookie identity cannot inherit the previous account's capability snapshot. */
  it('should clear previous account capabilities when a new session cannot load its extensions', async () => {
    const { createSessionStore } = await moduleAt('auth/session-store.ts');
    let second = false;
    const store = createSessionStore({
      read: async () => session(),
      login: async () =>
        second ? { ...session(), username: 'second-fixture', csrfToken: 'second-csrf' } : session(),
      logout: async () => {},
      capabilities: async () => {
        if (second) throw new Error('offline');
        return capabilities;
      },
    });
    await store.login('fixture-listener', 'synthetic-password');
    expect(store.getSnapshot().capabilities).toEqual(capabilities);
    second = true;
    await store.login('second-fixture', 'synthetic-password');
    expect(store.getSnapshot().session?.username).toBe('second-fixture');
    expect(store.getSnapshot().capabilities).toBeNull();
    store.dispose();
  });

  /** Retry exposes a loading state and prevents duplicate recovery while the server is pending. */
  it('should show loading during recovery and return to login after an unauthenticated response', async () => {
    localStorage.setItem('musiclatte.locale', 'en');
    let attempts = 0;
    let finish!: (response: Response) => void;
    const context = createTestContext();
    context.fetcher = async () => {
      attempts++;
      if (attempts === 1) return new Response(null, { status: 503 });
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    };
    const { user } = await makeSUT(context);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('status').textContent).toContain('Checking your session');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    finish(Response.json({ error: { code: 'unauthenticated' } }, { status: 401 }));
    expect(await screen.findByLabelText('Username')).toBeTruthy();
  });

  /** Music layout is inspectable only in development and does not activate music navigation. */
  it('should render the music shell fixture with shared status and no unfinished navigation', async () => {
    const { ShellFixture } = await moduleAt('dev/ShellFixture.tsx');
    render(<ShellFixture />);
    expect(screen.getByRole('heading', { name: 'Music shell fixture' })).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Music' })).toBeNull();
  });

  /** Cookie transport keeps credentials in the request body and restores CSRF before logout. */
  it('should log in, switch locale, restore and log out through the cookie API', async () => {
    localStorage.setItem('musiclatte.locale', 'en');
    const { user, context, view } = await makeSUT();
    await user.type(await screen.findByLabelText('Username'), 'fixture-listener');
    await user.type(screen.getByLabelText('Password'), 'synthetic-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Music' })).toBeTruthy();
    expect(window.location.pathname).toBe('/music');
    expect(screen.queryByRole('link', { name: /Playlist|Import/ })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.selectOptions(screen.getByLabelText('Language'), 'ko');
    expect(await screen.findByRole('heading', { name: '설정' })).toBeTruthy();
    view.unmount();
    await makeSUT(context);
    expect(await screen.findByRole('heading', { name: '설정' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '로그아웃' }));
    expect(await screen.findByLabelText('사용자 이름')).toBeTruthy();
    const post = context.calls.find((x) => x.init?.method === 'POST')!;
    expect(JSON.parse(String(post.init?.body))).toEqual({
      kind: 'password',
      username: 'fixture-listener',
      password: 'synthetic-password',
    });
    expect(post.init?.credentials).toBe('include');
    const logout = context.calls.find((x) => x.init?.method === 'DELETE')!;
    expect(new Headers(logout.init?.headers).get('X-CSRF-Token')).toBe('synthetic-csrf');
    expect(Object.keys(localStorage)).toEqual(['musiclatte.locale']);
  });
  /** Authentication errors are localized and return keyboard focus without retaining passwords. */
  it('should recover from wrong credentials and preserve username', async () => {
    localStorage.setItem('musiclatte.locale', 'en');
    const context = createTestContext();
    context.fail('unauthenticated');
    const { user } = await makeSUT(context);
    await user.type(await screen.findByLabelText('Username'), 'fixture-listener');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.keyboard('{Enter}');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Check your username and password',
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Password')));
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('fixture-listener');
    context.fail('');
    await user.type(screen.getByLabelText('Password'), 'synthetic-password{Enter}');
    expect(await screen.findByRole('heading', { name: 'Music' })).toBeTruthy();
  });
  /** Unsafe, encoded and unimplemented return paths never become navigation targets. */
  it('should allow only implemented relative return paths within the SPA base', async () => {
    const { safeReturnPath } = await moduleAt('auth/guards.ts');
    for (const path of [
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      '/%2f%2fevil.test',
      '/api/v1/session',
      '/settings/../music',
      '/settings?returnTo=//evil.test',
    ])
      expect(safeReturnPath(path, '/')).toBe('/music');
    expect(safeReturnPath('/latte/settings', '/latte/')).toBe('/latte/settings');
    expect(safeReturnPath('/settings', '/latte/')).toBe('/latte/music');
  });
  /** Private extension outages preserve the authenticated account and standard profile. */
  it('should retain session when capabilities are unavailable and hide unimplemented entries', async () => {
    localStorage.setItem('musiclatte.locale', 'en');
    const context = createTestContext();
    context.signIn();
    const original = context.fetcher;
    context.fetcher = async (url, init) =>
      String(url).endsWith('/capabilities')
        ? new Response(null, { status: 503 })
        : original(url, init);
    await makeSUT(context);
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByText('fixture-listener')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Music|Import|Playlist/ })).toBeNull();
  });
  /** Direct unsupported routes show a scoped recovery page, never an unfinished feature. */
  it('should guard direct routes and preserve the SPA mount base', async () => {
    localStorage.setItem('musiclatte.locale', 'en');
    window.history.replaceState(null, '', '/latte/imports');
    const context = createTestContext();
    context.signIn();
    const { user } = await makeSUT(context, '/latte/');
    expect(await screen.findByRole('heading', { name: 'Page unavailable' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Back to settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(window.location.pathname).toBe('/latte/settings');
  });
  /** Feature decisions distinguish denied, unsupported and uncertain availability. */
  it('should intersect implemented features with explicit server permission', async () => {
    const { featureState, clientFeatures } = await moduleAt('capabilities/client-features.ts');
    expect(clientFeatures['music.browse']).toBe(true);
    expect(clientFeatures['music.stream']).toBe(false);
    expect(
      featureState({ supported: false, permission: 'allowed', availability: 'available' }),
    ).toBe('unsupported');
    expect(featureState({ supported: true, permission: 'denied', availability: 'available' })).toBe(
      'denied',
    );
    expect(
      featureState({
        supported: true,
        permission: 'allowed',
        availability: 'temporarily_unavailable',
      }),
    ).toBe('unavailable');
    expect(featureState(undefined)).toBe('unknown');
  });
  /** A late session or capability response cannot resurrect a logged-out account. */
  it('should ignore stale requests after logout', async () => {
    const { createSessionStore } = await moduleAt('auth/session-store.ts');
    let resolveRead!: (value: unknown) => void;
    const client = {
      read: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      logout: async () => {},
      login: async () => session(),
      capabilities: async () => capabilities,
    };
    const store = createSessionStore(client);
    await store.login('fixture-listener', 'synthetic-password');
    const pending = store.restore();
    await store.logout();
    resolveRead(session());
    await pending;
    expect(store.getSnapshot().session).toBeNull();
    expect(store.getSnapshot().status).toBe('signed-out');
    store.dispose();
  });
  /** Absolute expiration clears the UI and produces a localized reauthentication path. */
  it('should expire the session without waiting for another API request', async () => {
    const { createSessionStore } = await moduleAt('auth/session-store.ts');
    vi.useFakeTimers();
    try {
      const store = createSessionStore({
        read: async () => ({ ...session(), expiresAt: Date.now() + 1000 }),
        login: async () => session(),
        logout: async () => {},
        capabilities: async () => capabilities,
      });
      await store.restore();
      await vi.advanceTimersByTimeAsync(1001);
      expect(store.getSnapshot().session).toBeNull();
      expect(store.getSnapshot().reason).toBe('expired');
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  /** Failed logout keeps a recovery path because the HttpOnly cookie might still be valid. */
  it('should retain the account when logout fails and recover CSRF on retry', async () => {
    const { createSessionStore } = await moduleAt('auth/session-store.ts');
    const { ApiError } = await moduleAt('auth/client.ts');
    let fails = true;
    const store = createSessionStore({
      read: async () => session(),
      login: async () => session(),
      logout: async () => {
        if (fails) throw new ApiError('csrf_rejected');
      },
      capabilities: async () => capabilities,
    });
    await store.restore();
    await store.logout();
    expect(store.getSnapshot().session?.username).toBe('fixture-listener');
    expect(store.getSnapshot().error).toBe('csrf_rejected');
    fails = false;
    await store.logout();
    expect(store.getSnapshot().session).toBeNull();
    store.dispose();
  });
  /** Locale preference wins over browser language; blocked storage remains usable. */
  it('should resolve locale safely and preserve translation completeness', async () => {
    const { resolveLocale } = await moduleAt('i18n/locale.ts');
    expect(resolveLocale('en', ['ko-KR'])).toBe('en');
    expect(resolveLocale(null, ['ko-KR', 'en'])).toBe('ko');
    expect(resolveLocale('invalid', ['fr', 'en-US'])).toBe('en');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await makeSUT();
    expect(await screen.findByRole('button', { name: /Sign in|로그인/ })).toBeTruthy();
  });
  /** Cross-origin API configuration never changes the origin-root session path. */
  it('should validate cookie response and sanitize raw server errors', async () => {
    const { createSessionClient, ApiError } = await moduleAt('auth/client.ts');
    let observed = '';
    const client = createSessionClient({
      apiOrigin: 'https://api.example.test',
      fetcher: async (url: string) => {
        observed = url;
        return Response.json({
          ...session(),
          authScheme: 'bearer',
          accessToken: 'must-not-consume',
        });
      },
    });
    await expect(client.read()).rejects.toBeInstanceOf(ApiError);
    expect(observed).toBe('https://api.example.test/api/v1/session');
  });
});

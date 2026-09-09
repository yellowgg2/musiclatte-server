// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Router } from '../src/app/Router';
import type { AccessToken } from '@musiclatte/contracts';
const secret = 'mlpat_' + 'REDACTED_SYNTHETIC_TOKEN_'.padEnd(43, 'X');
function fixture() {
  const state = {
    username: 'owner',
    permission: 'allowed',
    availability: 'available',
    lost: false,
    late: null as Promise<Response> | null,
    tokens: [] as AccessToken[],
  };
  const calls: { path: string; method: string; body: unknown }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (path.endsWith('/session'))
      return Response.json({
        schemaVersion: 1,
        authScheme: 'cookie',
        username: state.username,
        csrfToken: 'csrf-' + state.username,
        expiresAt: Date.now() + 3600000,
      });
    if (path.endsWith('/capabilities'))
      return Response.json({
        schemaVersion: 1,
        instanceId: 'fixture',
        revision: state.username + state.permission + state.availability,
        features: {
          'music.browse': { supported: false, permission: 'denied', availability: 'available' },
          'automation.tokens': {
            supported: true,
            permission: state.permission,
            availability: state.availability,
          },
        },
      });
    if (path.endsWith('/access-tokens/options'))
      return Response.json({
        schemaVersion: 1,
        now: Date.now(),
        maxTokenAgeMs: 86400000,
        libraryIds: ['music', 'archive'],
        scopes: ['metadata:read', 'metadata:write', 'lyrics:write', 'curation:write'],
      });
    if (path.endsWith('/access-tokens') && method === 'POST') {
      const token: AccessToken = {
        id: '11111111-1111-4111-8111-111111111111',
        ...body,
        createdAt: Date.now(),
        lastUsedAt: null,
        revokedAt: null,
      };
      state.tokens.unshift(token);
      if (state.late) return state.late;
      if (state.lost) throw new TypeError('lost');
      return Response.json(
        { schemaVersion: 1, token: secret, accessToken: token },
        { status: 201 },
      );
    }
    if (path.endsWith('/access-tokens'))
      return Response.json({
        schemaVersion: 1,
        accessTokens: state.tokens,
        total: state.tokens.length,
        nextCursor: null,
      });
    if (method === 'DELETE') {
      state.tokens[0]!.revokedAt = Date.now();
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected_fixture_route');
  };
  return { state, calls, fetcher };
}
function setup(c = fixture()) {
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', '/settings');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(<Router fetcher={c.fetcher} />);
  return { ...c, user: userEvent.setup() };
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
it('issues once, hides the secret, reloads the list and revokes from the settings route', async () => {
  const c = setup();
  await screen.findByRole('heading', { name: 'Access tokens' });
  await c.user.type(
    await screen.findByRole('textbox', { name: 'Token name' }),
    'Studio automation',
  );
  await c.user.click(screen.getByRole('checkbox', { name: 'music' }));
  await c.user.click(screen.getByRole('button', { name: 'Create token' }));
  expect(await screen.findByDisplayValue(secret)).toBeTruthy();
  expect(
    JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + window.location.href,
  ).not.toContain(secret);
  await c.user.click(screen.getByRole('button', { name: 'Hide token' }));
  expect(screen.queryByDisplayValue(secret)).toBeNull();
  await c.user.click(screen.getByRole('button', { name: 'Revoke Studio automation' }));
  await c.user.click(screen.getByRole('button', { name: 'Confirm revocation' }));
  await screen.findByText('Revoked');
  expect(c.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
});
it('does not automatically reissue after a lost create response', async () => {
  const c = setup();
  c.state.lost = true;
  await c.user.type(await screen.findByRole('textbox', { name: 'Token name' }), 'Lost response');
  await c.user.click(screen.getByRole('checkbox', { name: 'music' }));
  await c.user.click(screen.getByRole('button', { name: 'Create token' }));
  await screen.findByText(/The token may have been created/);
  expect((screen.getByRole('button', { name: 'Create token' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await c.user.click(screen.getByRole('button', { name: 'Refresh tokens' }));
  await waitFor(() => expect(screen.getByText('Lost response')).toBeTruthy());
  expect(c.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
});
it('keeps drafts across locale changes and reports clipboard failure without persisting the secret', async () => {
  const c = setup();
  await c.user.type(await screen.findByRole('textbox', { name: 'Token name' }), 'Locale draft');
  await c.user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ko');
  expect(screen.getByDisplayValue('Locale draft')).toBeTruthy();
  await c.user.selectOptions(screen.getByRole('combobox', { name: '언어' }), 'en');
  await c.user.click(screen.getByRole('checkbox', { name: 'music' }));
  await c.user.click(screen.getByRole('button', { name: 'Create token' }));
  await screen.findByDisplayValue(secret);
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('unavailable'));
  await c.user.click(screen.getByRole('button', { name: 'Copy token' }));
  await screen.findByText(/Copy failed/);
  await c.user.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(screen.queryByDisplayValue(secret)).toBeNull());
});
it('discards a late issuance after leaving settings and never submits a second create', async () => {
  const c = setup();
  let resolve!: (response: Response) => void;
  c.state.late = new Promise<Response>((done) => {
    resolve = done;
  });
  await c.user.type(await screen.findByRole('textbox', { name: 'Token name' }), 'Late token');
  await c.user.click(screen.getByRole('checkbox', { name: 'music' }));
  await c.user.dblClick(screen.getByRole('button', { name: 'Create token' }));
  await c.user.click(screen.getByRole('button', { name: 'Sign out' }));
  resolve(
    Response.json(
      { schemaVersion: 1, token: secret, accessToken: c.state.tokens[0] },
      { status: 201 },
    ),
  );
  await waitFor(() => expect(screen.queryByDisplayValue(secret)).toBeNull());
  expect(c.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
});
it('does not fetch token data for a denied owner', async () => {
  const c = fixture();
  c.state.permission = 'denied';
  setup(c);
  await screen.findByText('You do not have permission to manage automation tokens.');
  expect(c.calls.filter((call) => call.path.includes('access-tokens'))).toHaveLength(0);
});

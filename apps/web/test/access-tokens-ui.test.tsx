// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    organizationPermission: 'allowed',
    organizationAvailability: 'available',
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
          'metadata.write': {
            supported: true,
            permission: 'allowed',
            availability: 'available',
            formats: ['mp3'],
            fields: [
              'title',
              'artist',
              'album',
              'albumArtist',
              'trackNumber',
              'year',
              'genre',
              'cover',
              'lyrics',
            ],
          },
          'metadata.organization': {
            supported: true,
            permission: state.organizationPermission,
            availability: state.organizationAvailability,
            formats: ['mp3'],
            fields: [
              'title',
              'artist',
              'album',
              'albumArtist',
              'trackNumber',
              'year',
              'genre',
              'cover',
              'lyrics',
            ],
          },
        },
      });
    if (path.endsWith('/access-tokens/options') && state.availability !== 'available')
      return Response.json(
        { schemaVersion: 1, error: { code: 'upstream_unavailable' } },
        { status: 503 },
      );
    if (path.endsWith('/access-tokens/options'))
      return Response.json({
        schemaVersion: 1,
        now: Date.now(),
        maxTokenAgeMs: 86400000,
        libraryIds: ['music', 'archive'],
        scopes: [
          'metadata:read',
          'metadata:write',
          'lyrics:write',
          'curation:write',
          'media:organize',
        ],
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

/** The desktop guide keeps its secondary preset action at the normal control height. */
it('keeps the recommended preset action compact beside multi-line guidance', () => {
  const css = readFileSync(
    resolve('apps/web/src/pages/settings/AccessTokensPanel.module.css'),
    'utf8',
  );

  expect(css).toMatch(/\.guide\s*\{[^}]*align-items:\s*start/);
});

/** One-time token focus reveals the whole card above fixed mobile controls. */
it('scrolls the one-time token card into view after focusing the raw value', async () => {
  const original = HTMLElement.prototype.scrollIntoView;
  const reveal = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: reveal,
  });
  try {
    const c = setup();
    await c.user.type(await screen.findByRole('textbox', { name: 'Token name' }), 'Visible token');
    await c.user.click(screen.getByRole('checkbox', { name: 'music' }));
    await c.user.click(screen.getByRole('button', { name: 'Create token' }));

    const raw = await screen.findByLabelText('One-time token');
    expect(document.activeElement).toBe(raw);
    expect(reveal).toHaveBeenCalledWith({ block: 'nearest' });
  } finally {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: original,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  }
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

it('shows one actionable reason when token management is unavailable', async () => {
  const c = fixture();
  c.state.availability = 'temporarily_unavailable';
  setup(c);
  await screen.findByText('Token management is temporarily unavailable');
  const refresh = screen.getByRole('button', { name: 'Refresh tokens' }) as HTMLButtonElement;
  await waitFor(() => expect(refresh.disabled).toBe(false));

  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.queryByText('Cannot reach the server. Please try again shortly.')).toBeNull();
});

/** Permission choices explain their effect and the selected library boundary without product-specific wording. */
it('describes every permission and the library boundary without Codex wording', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Access tokens' });

  expect(
    screen.getByText(
      'View the current ID3 metadata for songs in selected libraries. This permission is always required.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByText('Change supported ID3 metadata such as title, artist, album, and cover.'),
  ).toBeTruthy();
  expect(
    screen.getByText(
      'Add or change lyrics. This optional permission is not needed to organize files.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByText('Record whether optional information was checked, missing, or unavailable.'),
  ).toBeTruthy();
  expect(
    screen.getByText(
      'Move songs into folders based on their ID3 metadata. Read and edit are required.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      '"music" is the name of a Musiclatte music library. Choose which libraries the token can access; the permissions above apply only to songs in selected libraries.',
    ),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Use recommended settings' })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/Codex/i);
});

it('builds the recommended scope preset without issuing and preserves explicit dependency control', async () => {
  const c = setup();
  await screen.findByRole('heading', { name: 'Access tokens' });
  const read = screen.getByRole('checkbox', { name: 'Read metadata' }) as HTMLInputElement;
  const write = screen.getByRole('checkbox', { name: 'Edit metadata' }) as HTMLInputElement;
  const lyrics = screen.getByRole('checkbox', { name: 'Edit lyrics' }) as HTMLInputElement;
  const organize = screen.getByRole('checkbox', {
    name: 'Organize media files',
  }) as HTMLInputElement;

  expect(read.checked).toBe(true);
  expect(write.checked).toBe(false);
  expect(lyrics.checked).toBe(false);
  expect(organize.checked).toBe(false);
  await c.user.click(screen.getByRole('button', { name: 'Use recommended settings' }));
  expect(write.checked).toBe(true);
  expect(write.disabled).toBe(true);
  expect(organize.checked).toBe(true);
  expect(lyrics.checked).toBe(false);
  expect(c.calls.filter((call) => call.method === 'POST')).toHaveLength(0);

  await c.user.click(organize);
  expect(organize.checked).toBe(false);
  expect(write.checked).toBe(true);
  expect(write.disabled).toBe(false);
  await c.user.click(write);
  expect(write.checked).toBe(false);
  await c.user.click(organize);
  expect(write.checked).toBe(true);
  expect(organize.checked).toBe(true);

  await c.user.type(screen.getByRole('textbox', { name: 'Token name' }), 'Media organizer');
  await c.user.click(screen.getByRole('checkbox', { name: 'music' }));
  await c.user.click(screen.getByRole('button', { name: 'Create token' }));
  const request = c.calls.find((call) => call.method === 'POST');
  expect(request?.body).toMatchObject({
    scopes: ['metadata:read', 'metadata:write', 'media:organize'],
  });
});

it('explains optional lyrics, advertised fields and distinct organization readiness failures', async () => {
  setup();
  await screen.findByText(
    'Add or change lyrics. This optional permission is not needed to organize files.',
  );
  expect(screen.getByText(/Title · Artist · Album · Album artist/)).toBeTruthy();
  expect(
    screen.getByText(
      'Supported fields describe what Musiclatte can write. Values are not researched or verified automatically.',
    ),
  ).toBeTruthy();
  cleanup();

  const unavailable = fixture();
  unavailable.state.organizationAvailability = 'temporarily_unavailable';
  setup(unavailable);
  await screen.findByText(
    'Media organization is configured, but its worker is temporarily unavailable.',
  );
  cleanup();

  const denied = fixture();
  denied.state.organizationPermission = 'denied';
  setup(denied);
  await screen.findByText('This account is not allowed to organize media files.');
  expect(
    screen.getByRole('button', { name: 'Use recommended settings' }) as HTMLButtonElement,
  ).toHaveProperty('disabled', true);
  expect(
    screen.getByRole('checkbox', { name: 'Organize media files' }) as HTMLInputElement,
  ).toHaveProperty('disabled', true);
});

import { createAccessTokenTestContext as makeSUT } from '../../../tests/support/access-token-harness.js';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSessionService } from '../src/auth/session-service.js';
import { createAccessTokenService } from '../src/auth/access-token-service.js';
import { readAutomationConfig } from '../src/automation/config.js';
import { join } from 'node:path';
import { chmodSync, writeFileSync } from 'node:fs';
import { browserHeaders, password } from '../../../tests/support/auth-harness.js';

describe('personal access token API', () => {
  it('denies options safely when automation is disabled', async () => {
    const c = await makeSUT(false);
    try {
      expect(
        (await c.app.inject({ url: '/api/v1/access-tokens/options', headers: c.headers }))
          .statusCode,
      ).toBe(403);
      expect((await c.app.inject({ url: '/api/v1/access-tokens/options' })).statusCode).toBe(401);
    } finally {
      await c.cleanup();
    }
  });
  it('should expose current allowed libraries and expiry limits only to session owners', async () => {
    const c = await makeSUT();
    try {
      const response = await c.app.inject({
        url: '/api/v1/access-tokens/options',
        headers: c.headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        schemaVersion: 1,
        libraryIds: ['library-1'],
        scopes: [
          'metadata:read',
          'metadata:write',
          'lyrics:write',
          'curation:write',
          'media:organize',
          'collections:read',
        ],
      });
      expect(response.json().maxTokenAgeMs).toBeGreaterThan(0);
      const issued = await c.app.inject({
        method: 'POST',
        url: '/api/v1/access-tokens',
        headers: c.headers,
        payload: c.payload,
      });
      expect(
        (
          await c.app.inject({
            url: '/api/v1/access-tokens/options',
            headers: { authorization: 'Bearer ' + issued.json().token },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await c.cleanup();
    }
  });
  /** Collection access is explicit, roundtrips through owner APIs, and never grants session routes. */
  it('should issue collection read scope without widening ordinary collection APIs', async () => {
    const c = await makeSUT();
    try {
      const created = await c.app.inject({
        method: 'POST',
        url: '/api/v1/access-tokens',
        headers: c.headers,
        payload: { ...c.payload, scopes: ['metadata:read', 'collections:read'] },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().accessToken.scopes).toEqual(['collections:read', 'metadata:read']);
      const listed = await c.app.inject({ url: '/api/v1/access-tokens', headers: c.headers });
      expect(listed.json().accessTokens[0]?.scopes).toEqual(['collections:read', 'metadata:read']);
      const patHeaders = { authorization: `Bearer ${created.json().token}` };
      expect(
        (await c.app.inject({ url: '/api/v1/favorites/songs', headers: patHeaders })).statusCode,
      ).toBe(403);
      expect(
        (await c.app.inject({ url: '/api/v1/playlists', headers: patHeaders })).statusCode,
      ).toBe(403);
      expect(
        (
          await c.app.inject({
            method: 'POST',
            url: '/api/v1/access-tokens',
            headers: c.headers,
            payload: { ...c.payload, scopes: ['collections:read'] },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await c.cleanup();
    }
  });
  /** Legacy bearer owners can manage tokens while another owner sees no private token metadata. */
  it('should support native session owners and conceal tokens owned by other accounts', async () => {
    const c = await makeSUT();
    try {
      const service = createSessionService(c.options);
      const own = await service.login(
        { kind: 'password', username: password.username, password: password.password },
        'bearer',
      );
      const headers = {
        authorization: `Bearer ${own.body.accessToken}`,
        'content-type': 'application/json',
      };
      const created = await c.app.inject({
        method: 'POST',
        url: '/api/v1/access-tokens',
        headers,
        payload: c.payload,
      });
      expect(created.statusCode).toBe(201);
      const issued = created.json();
      c.state.accountIdentityFromProof = true;
      const another = await service.login(
        { kind: 'password', username: 'another-owner', password: password.password },
        'bearer',
      );
      const otherHeaders = { authorization: `Bearer ${another.body.accessToken}` };
      expect(
        (await c.app.inject({ url: '/api/v1/access-tokens', headers: otherHeaders })).json().total,
      ).toBe(0);
      expect(
        (
          await c.app.inject({
            method: 'DELETE',
            url: `/api/v1/access-tokens/${issued.accessToken.id}`,
            headers: otherHeaders,
          })
        ).statusCode,
      ).toBe(404);
      const denied = await c.app.inject({
        method: 'POST',
        url: '/api/v1/access-tokens',
        headers: { ...otherHeaders, 'content-type': 'application/json' },
        payload: c.payload,
      });
      expect(denied.statusCode).toBe(403);
    } finally {
      await c.cleanup();
    }
  });
  /** Only explicit opt-in and an owner-private, bounded configuration enable automation. */
  it('should require private automation configuration without invented token retention', async () => {
    const c = await makeSUT();
    try {
      expect(readAutomationConfig({})).toEqual({ enabled: false });
      expect(() => readAutomationConfig({ AUTOMATION_ENABLED: 'yes' })).toThrow();
      const path = join(c.storage.root, 'automation-config.json');
      const env = { AUTOMATION_ENABLED: 'true', AUTOMATION_CONFIG_PATH: path };
      writeFileSync(path, JSON.stringify({ schemaVersion: 1, maxTokenAgeMs: 1000 }), {
        mode: 0o600,
      });
      expect(readAutomationConfig(env)).toEqual({ enabled: true, maxTokenAgeMs: 1000 });
      chmodSync(path, 0o644);
      expect(() => readAutomationConfig(env)).toThrow();
      chmodSync(path, 0o600);
      for (const maxTokenAgeMs of [0, -1, 1.5, '1000']) {
        writeFileSync(path, JSON.stringify({ schemaVersion: 1, maxTokenAgeMs }));
        expect(() => readAutomationConfig(env)).toThrow();
      }
    } finally {
      await c.cleanup();
    }
  });
  /** PAT verification rechecks identity, scopes and current library access independently of logout. */
  it('should enforce fresh upstream authorization and keep PAT lifetime independent of logout', async () => {
    const c = await makeSUT();
    try {
      const issued = (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/access-tokens',
          headers: c.headers,
          payload: c.payload,
        })
      ).json();
      const auth = createSessionService(c.options);
      const tokens = createAccessTokenService(auth, c.automation);
      await expect(tokens.verify(issued.token)).resolves.toMatchObject({
        ownerUsername: password.username,
        allowedLibraries: ['library-1'],
      });
      await expect(tokens.verify(issued.token, ['metadata:write'])).rejects.toMatchObject({
        status: 403,
      });
      expect(
        (
          await c.app.inject({
            method: 'DELETE',
            url: '/api/v1/session',
            headers: c.headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(204);
      await expect(tokens.verify(issued.token)).resolves.toMatchObject({
        ownerUsername: password.username,
      });
      c.state.status = 503;
      await expect(tokens.verify(issued.token)).rejects.toMatchObject({ status: 503 });
      c.state.status = 200;
      c.state.emptyLibrary = true;
      await expect(tokens.verify(issued.token)).rejects.toMatchObject({ status: 403 });
      c.state.emptyLibrary = false;
      c.state.username = 'different-user';
      await expect(tokens.verify(issued.token)).rejects.toMatchObject({ status: 401 });
      c.state.username = password.username;
      await expect(tokens.verify(issued.token)).rejects.toMatchObject({ status: 401 });
    } finally {
      await c.cleanup();
    }
  });
  /** A revocation during upstream I/O cannot admit a stale token afterwards. */
  it('should reject tokens revoked while their upstream identity is being checked', async () => {
    const c = await makeSUT();
    try {
      const issued = (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/access-tokens',
          headers: c.headers,
          payload: c.payload,
        })
      ).json();
      c.state.identityResponseGate = async () => {
        c.tokens.revokeOwned(password.username, issued.accessToken.id);
      };
      const tokens = createAccessTokenService(createSessionService(c.options), c.automation);
      await expect(tokens.verify(issued.token)).rejects.toMatchObject({ status: 401 });
    } finally {
      await c.cleanup();
    }
  });
  /** Session owners can issue/list/revoke tokens without granting PATs session API access. */
  it('should issue once and preserve token isolation from session routes', async () => {
    const c = await makeSUT();
    try {
      const created = await c.app.inject({
        method: 'POST',
        url: '/api/v1/access-tokens',
        headers: c.headers,
        payload: c.payload,
      });
      expect(created.statusCode).toBe(201);
      expect(created.headers['cache-control']).toBe('no-store');
      const issued = created.json();
      expect(issued.token).toMatch(/^mlpat_/);
      const list = await c.app.inject({ url: '/api/v1/access-tokens', headers: c.headers });
      expect(list.statusCode).toBe(200);
      expect(list.json().accessTokens).toEqual([issued.accessToken]);
      expect(list.body).not.toContain(issued.token);
      const auth = { authorization: `Bearer ${issued.token}` };
      for (const url of [
        '/api/v1/access-tokens',
        '/api/v1/session',
        '/api/v1/capabilities',
        '/api/v1/tracks/track-1/metadata',
      ]) {
        expect((await c.app.inject({ url, headers: auth })).statusCode).toBe(403);
      }
      expect(
        (
          await c.app.inject({
            url: '/api/v1/access-tokens',
            headers: { ...auth, cookie: c.headers.cookie },
          })
        ).statusCode,
      ).toBe(400);
      expect((await c.app.inject('/api/v1/access-tokens?token=hidden')).statusCode).toBe(400);
      const cap = await c.app.inject({ url: '/api/v1/capabilities', headers: c.headers });
      expect(cap.json().features['automation.tokens']).toMatchObject({
        supported: true,
        permission: 'allowed',
      });
      expect(cap.json().features['metadata.curation'].supported).toBe(false);
      for (let i = 0; i < 2; i++)
        expect(
          (
            await c.app.inject({
              method: 'DELETE',
              url: `/api/v1/access-tokens/${issued.accessToken.id}`,
              headers: c.headers,
              payload: {},
            })
          ).statusCode,
        ).toBe(204);
      expect(
        c.tokens.findByHash(createHash('sha256').update(issued.token).digest('hex')),
      ).toBeNull();
    } finally {
      await c.cleanup();
    }
  });
  /** Scope, library and browser intent checks reject privilege escalation before token issuance. */
  it('should reject unauthorized scopes libraries and missing CSRF', async () => {
    const c = await makeSUT();
    try {
      for (const change of [
        { scopes: ['lyrics:write'] },
        { scopes: ['metadata:read', 'media:organize'] },
        { libraryIds: ['outside'] },
        { adminRole: true },
        { expiresAt: 3000 },
        { name: 'bad\nname' },
      ]) {
        const response = await c.app.inject({
          method: 'POST',
          url: '/api/v1/access-tokens',
          headers: c.headers,
          payload: { ...c.payload, ...change },
        });
        expect([400, 403]).toContain(response.statusCode);
      }
      const headers = { ...c.headers, 'x-csrf-token': '' };
      expect(
        (
          await c.app.inject({
            method: 'POST',
            url: '/api/v1/access-tokens',
            headers,
            payload: c.payload,
          })
        ).statusCode,
      ).toBe(403);
      expect(c.tokens.listOwned(password.username).total).toBe(0);
    } finally {
      await c.cleanup();
    }
  });
  /** Automation stays off unless explicitly configured. */
  it('should deny token issuance with automation disabled', async () => {
    const c = await makeSUT(false);
    try {
      expect(
        (
          await c.app.inject({
            method: 'POST',
            url: '/api/v1/access-tokens',
            headers: c.headers,
            payload: c.payload,
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await c.cleanup();
    }
  });
});

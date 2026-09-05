import type { ApiErrorCode, CapabilitiesResponse } from '@musiclatte/contracts';
import { errorCode, type CookieSession, type SessionClient } from './client';
export interface SessionState {
  status: 'loading' | 'signed-in' | 'signed-out' | 'error';
  session: CookieSession | null;
  capabilities: CapabilitiesResponse | null;
  capabilityUnavailable: boolean;
  busy: boolean;
  error: ApiErrorCode | null;
  reason: 'expired' | null;
}
export function createSessionStore(client: SessionClient) {
  let state: SessionState = {
    status: 'loading',
    session: null,
    capabilities: null,
    capabilityUnavailable: false,
    busy: false,
    error: null,
    reason: null,
  };
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  function update(patch: Partial<SessionState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  function clear(reason: SessionState['reason'] = null) {
    generation++;
    clearTimeout(timer);
    update({
      status: 'signed-out',
      session: null,
      capabilities: null,
      capabilityUnavailable: false,
      busy: false,
      error: null,
      reason,
    });
  }
  function armExpiry(session: CookieSession) {
    clearTimeout(timer);
    const remaining = session.expiresAt - Date.now();
    if (remaining <= 0) {
      clear('expired');
      return;
    }
    timer = setTimeout(() => armExpiry(session), Math.min(remaining, 2147483647));
  }
  function setSession(session: CookieSession) {
    const sameSession =
      state.session?.csrfToken === session.csrfToken && state.session.username === session.username;
    update({
      session,
      status: 'signed-in',
      ...(!sameSession ? { capabilities: null, capabilityUnavailable: false } : {}),
    });
    armExpiry(session);
  }
  async function accept(session: CookieSession, version: number) {
    if (version !== generation) return;
    update({ error: null, reason: null, busy: false });
    setSession(session);
    if (version !== generation) return;
    try {
      const capabilities = await client.capabilities();
      if (version === generation) update({ capabilities, capabilityUnavailable: false });
    } catch (error) {
      if (version !== generation) return;
      if (errorCode(error) === 'unauthenticated') clear('expired');
      else update({ capabilityUnavailable: true });
    }
  }
  async function restore() {
    if (state.busy) return;
    const version = ++generation;
    if (!state.session) update({ status: 'loading', error: null });
    try {
      await accept(await client.read(), version);
    } catch (error) {
      if (version !== generation) return;
      const code = errorCode(error);
      if (code === 'unauthenticated') clear(state.session ? 'expired' : state.reason);
      else update({ status: state.session ? 'signed-in' : 'error', error: code, busy: false });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    restore,
    expire: () => clear('expired'),
    async login(username: string, password: string) {
      if (state.busy) return;
      const version = ++generation;
      update({ busy: true, error: null });
      try {
        let csrf = state.session?.csrfToken;
        if (state.reason === 'expired') {
          try {
            csrf = (await client.read()).csrfToken;
          } catch (error) {
            if (errorCode(error) !== 'unauthenticated') throw error;
          }
        }
        if (version !== generation) return;
        await accept(await client.login(username, password, csrf), version);
      } catch (error) {
        if (version !== generation) return;
        const code = errorCode(error);
        // Recover a rotated cookie's CSRF without automatically resubmitting a password.
        if (code === 'csrf_rejected') {
          await restoreAfterCsrf(version);
        }
        if (version === generation) update({ busy: false, error: code });
      }
    },
    async logout() {
      if (state.busy) return;
      const version = ++generation;
      update({ busy: true, error: null });
      try {
        let csrf = state.session?.csrfToken;
        if (!csrf) csrf = (await client.read()).csrfToken;
        await client.logout(csrf);
        if (version === generation) clear();
      } catch (error) {
        if (version !== generation) return;
        const code = errorCode(error);
        if (code === 'unauthenticated') clear();
        else {
          if (code === 'csrf_rejected') await restoreAfterCsrf(version);
          if (version === generation) update({ busy: false, error: code });
        }
      }
    },
    dispose() {
      generation++;
      clearTimeout(timer);
      listeners.clear();
    },
  };
  async function restoreAfterCsrf(version: number) {
    try {
      const session = await client.read();
      if (version === generation) {
        setSession(session);
      }
    } catch {
      /* Keep the explicit retry path. */
    }
  }
}
export type SessionStore = ReturnType<typeof createSessionStore>;

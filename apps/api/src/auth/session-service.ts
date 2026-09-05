import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  ApiErrorCode,
  AuthScheme,
  SessionExchange,
  SessionResponse,
  SubsonicTokenProof,
} from '@musiclatte/contracts';
import { createSubsonicClient } from '../subsonic/client.js';
import { SubsonicError } from '../subsonic/errors.js';
import type { createSessionRepository } from '../storage/session-repository.js';
import type { createInstanceRepository } from '../storage/instance-repository.js';

export interface AuthOptions {
  sessions: ReturnType<typeof createSessionRepository>;
  instances: ReturnType<typeof createInstanceRepository>;
  signingKey: Uint8Array;
  origin: string;
  upstream: string;
  timeoutMs: number;
  secureCookies: boolean;
  allowScan: boolean;
}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
  }
}
export function upstreamError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof SubsonicError) {
    if (error.kind === 'authentication' || error.httpStatus === 401)
      return new ApiError(401, 'unauthenticated');
    if (error.kind === 'forbidden' || error.httpStatus === 403)
      return new ApiError(403, 'forbidden');
    if (error.kind === 'token_auth_unsupported') return new ApiError(422, 'token_auth_unsupported');
  }
  return new ApiError(503, 'upstream_unavailable');
}
export function createSessionService(input: AuthOptions) {
  const options = { ...input };
  const key = Buffer.from(options.signingKey);
  if (key.length !== 32) throw new Error('Invalid authentication configuration');
  const origin = new URL(options.origin);
  if (
    origin.origin !== options.origin ||
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    (origin.protocol === 'https:' && !options.secureCookies)
  )
    throw new Error('Invalid authentication configuration');
  // Validate trusted upstream configuration at startup, before accepting credentials.
  createSubsonicClient({
    upstream: options.upstream,
    timeoutMs: options.timeoutMs,
    proof: { username: 'configuration-check', t: '0'.repeat(32), s: 'configuration-check' },
  });
  // Bounded advisory observations only; eviction/restart returns unknown, never false.
  const randomSupport = new Set<string>();
  const sign = (purpose: string, value: string) =>
    createHmac('sha256', key)
      .update(JSON.stringify(['musiclatte-auth', 1, purpose, value]))
      .digest('base64url');
  const matches = (a: string, b: string) => {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  };
  function unwrap(value: string, scheme: AuthScheme): string {
    const parts = value.split('.');
    const raw = parts[1];
    const mac = parts[2];
    if (
      parts.length !== 3 ||
      parts[0] !== scheme ||
      !raw ||
      !/^[A-Za-z0-9_-]{43}$/.test(raw) ||
      !mac ||
      !matches(mac, sign(scheme, raw))
    )
      throw new ApiError(401, 'unauthenticated');
    return raw;
  }
  function find(value: string, scheme: AuthScheme) {
    const raw = unwrap(value, scheme);
    const session = options.sessions.find(raw);
    if (!session) throw new ApiError(401, 'unauthenticated');
    return { ...session, raw, token: value, scheme };
  }
  const client = (proof: SubsonicTokenProof) =>
    createSubsonicClient({ upstream: options.upstream, timeoutMs: options.timeoutMs, proof });
  function rejectUpstream(error: unknown, raw?: string): never {
    const mapped = upstreamError(error);
    if (mapped.status === 401 && raw) {
      options.sessions.revoke(raw);
      randomSupport.delete(sign('random-support', raw));
    }
    throw mapped;
  }
  async function verify(
    value: string,
    scheme: AuthScheme,
    requestOptions: { signal?: AbortSignal } = {},
  ) {
    const session = find(value, scheme);
    const upstream = client(session.proof);
    try {
      const identity = await upstream.currentUser(requestOptions);
      if (identity.username !== session.username) throw new ApiError(401, 'unauthenticated');
      // A logout/policy change during network I/O cannot resurrect a session.
      find(value, scheme);
      return { session, identity, upstream };
    } catch (error) {
      return rejectUpstream(error, session.raw);
    }
  }
  function response(session: ReturnType<typeof find>, includeBearer = false): SessionResponse {
    return {
      schemaVersion: 1,
      username: session.username,
      authScheme: session.scheme,
      expiresAt: session.expiresAt,
      ...(session.scheme === 'cookie'
        ? { csrfToken: sign('csrf', session.token) }
        : includeBearer
          ? { accessToken: session.token }
          : {}),
    };
  }
  return {
    options,
    find,
    verify,
    response,
    sign,
    matches,
    rejectUpstream,
    knownRandom(raw: string) {
      return randomSupport.has(sign('random-support', raw));
    },
    rememberRandom(raw: string) {
      randomSupport.add(sign('random-support', raw));
      if (randomSupport.size > 256) randomSupport.delete(randomSupport.values().next().value!);
    },
    cookieName: options.secureCookies ? '__Host-musiclatte-session' : 'musiclatte-session',
    cookie(value: string, expiresAt?: number) {
      return `${options.secureCookies ? '__Host-musiclatte-session' : 'musiclatte-session'}=${value}; Path=/; HttpOnly; SameSite=Strict${options.secureCookies ? '; Secure' : ''}${expiresAt === undefined ? '; Max-Age=0' : `; Expires=${new Date(expiresAt).toUTCString()}`}`;
    },
    async login(exchange: SessionExchange, scheme: AuthScheme, previous?: string) {
      const salt = exchange.kind === 'password' ? randomBytes(16).toString('hex') : exchange.s;
      const proof: SubsonicTokenProof = {
        username: exchange.username,
        s: salt,
        t:
          exchange.kind === 'password'
            ? createHash('md5')
                .update(exchange.password + salt)
                .digest('hex')
            : exchange.t,
      };
      try {
        const identity = await client(proof).currentUser();
        if (identity.username !== proof.username) throw new ApiError(401, 'unauthenticated');
      } catch (error) {
        return rejectUpstream(error);
      }
      // No async boundary between checking the old session, creation and revocation.
      const old = previous ? find(previous, scheme) : undefined;
      const created = options.sessions.create(proof);
      try {
        if (old) {
          options.sessions.revoke(old.raw);
          randomSupport.delete(sign('random-support', old.raw));
        }
      } catch (error) {
        options.sessions.revoke(created.token);
        throw error;
      }
      const token = `${scheme}.${created.token}.${sign(scheme, created.token)}`;
      const session = find(token, scheme);
      return { session, body: response(session, true) };
    },
    logout(value: string, scheme: AuthScheme) {
      const session = find(value, scheme);
      options.sessions.revoke(session.raw);
      randomSupport.delete(sign('random-support', session.raw));
    },
  };
}
export type SessionService = ReturnType<typeof createSessionService>;

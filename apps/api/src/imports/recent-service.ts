import { lstatSync } from 'node:fs';
import { posix } from 'node:path';
import {
  recentInstantSchema,
  type FeatureCapability,
  type RecentDownloadItem,
  type RecentDownloadQuery,
  type RecentDownloadResponse,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { createImportRepository } from '../storage/import-repository.js';
import { createMediaLinkRepository } from '../storage/media-link-repository.js';
import { SubsonicError } from '../subsonic/errors.js';
import { resolveFileKey } from './file-keys.js';
import { validateRelativeKey } from './policy.js';
import type { ImportOptions } from './import-service.js';

type Verified = Awaited<ReturnType<SessionService['verify']>>;
interface Snapshot {
  from: number;
  to: number;
  asOf: number;
  highWater: number;
  before?: { at: number; id: string };
}
const week = 7 * 24 * 60 * 60 * 1000;
const invalid = (): never => {
  throw new ApiError(400, 'invalid_request');
};
const iso = (value: number) => new Date(value).toISOString();
function instant(value: string): number {
  if (!new RegExp(recentInstantSchema.pattern).test(value)) return invalid();
  const milliseconds = Date.parse(value);
  // Date.parse normalizes February 30; reject that alias instead of silently changing the range.
  const canonical = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`,
  );
  if (!Number.isFinite(milliseconds) || iso(milliseconds) !== canonical) return invalid();
  return milliseconds;
}
function matchingPath(path: string | null, key: string): boolean {
  if (
    !path ||
    posix.isAbsolute(path) ||
    /[\\:\x00-\x1f\x7f]/.test(path) ||
    path.split('/').includes('..')
  )
    return false;
  try {
    return validateRelativeKey(posix.normalize(path)) === key;
  } catch {
    return false;
  }
}
export function recentCapability(
  options: ImportOptions | undefined,
  username: string,
): FeatureCapability {
  const supported = options?.policy.enabled === true;
  return {
    supported,
    permission:
      supported && options.policy.libraries.some((l) => l.allowedUsers.includes(username))
        ? 'allowed'
        : 'denied',
    availability: 'available',
  };
}

/** Event membership is snapshotted; file and account availability are rechecked on every page. */
export function createRecentService(service: SessionService) {
  const options = service.options.imports;
  const repository = options ? createImportRepository(options) : undefined;
  const links = options ? createMediaLinkRepository(options) : undefined;
  const identity = (v: Verified) =>
    Buffer.from(
      service.sign('import-identity', JSON.stringify([v.session.instanceId, v.identity.username])),
      'base64url',
    ).toString('hex');
  const scope = (v: Verified) =>
    options!.policy.libraries
      .filter((l) => l.allowedUsers.includes(v.identity.username))
      .map(({ id, musicFolderId, relativeRoot }) => ({ id, musicFolderId, relativeRoot }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const signCursor = (v: Verified, raw: string) =>
    service.sign('recent-cursor', JSON.stringify([identity(v), scope(v), raw]));
  const encode = (v: Verified, snapshot: Snapshot) => {
    const raw = Buffer.from(JSON.stringify(snapshot)).toString('base64url');
    return `${raw}.${signCursor(v, raw)}`;
  };
  function decode(v: Verified, cursor: string): Snapshot {
    try {
      const [raw, mac, extra] = cursor.split('.');
      if (!raw || !mac || extra !== undefined || !service.matches(signCursor(v, raw), mac))
        return invalid();
      const parsed: Snapshot = JSON.parse(Buffer.from(raw, 'base64url').toString());
      if (
        ![parsed.from, parsed.to, parsed.asOf, parsed.highWater, parsed.before?.at].every((n) =>
          Number.isSafeInteger(n),
        ) ||
        parsed.from >= parsed.to ||
        parsed.asOf < 0 ||
        parsed.highWater < 0 ||
        !parsed.before?.id ||
        typeof parsed.before.id !== 'string'
      )
        return invalid();
      return parsed;
    } catch {
      return invalid();
    }
  }
  return {
    async list(
      v: Verified,
      query: RecentDownloadQuery,
      signal?: AbortSignal,
    ): Promise<RecentDownloadResponse> {
      if (
        recentCapability(options, v.identity.username).permission !== 'allowed' ||
        !options ||
        !repository ||
        !links
      )
        throw new ApiError(403, 'forbidden');
      const now = options.clock();
      if (!Number.isSafeInteger(now) || now < 0) throw new ApiError(503, 'storage_unavailable');
      if ((query.from === undefined) !== (query.to === undefined)) return invalid();
      const explicit =
        query.from === undefined
          ? undefined
          : { from: instant(query.from), to: instant(query.to!) };
      if (explicit && explicit.from >= explicit.to) return invalid();
      const snapshot = query.cursor
        ? decode(v, query.cursor)
        : {
            from: explicit?.from ?? now - week,
            to: explicit?.to ?? now,
            asOf: now,
            highWater: repository.recentHighWater(),
          };
      if (explicit && (snapshot.from !== explicit.from || snapshot.to !== explicit.to))
        return invalid();
      const limit = Number(query.limit ?? 50);
      const libraries = scope(v);
      const rows = repository.listRecent({
        identityKey: identity(v),
        libraries: libraries.map((l) => l.id),
        ...snapshot,
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const items: RecentDownloadItem[] = [];
      // One whole-page deadline, at most four requests in flight and one getSong per ready candidate.
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), service.options.timeoutMs);
      const cancel = () => abort.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      let next = 0;
      let failed = false;
      let failure: unknown;
      async function project(index: number): Promise<RecentDownloadItem> {
        const row = page[index]!;
        const base = {
          eventId: `${Buffer.from(row.id).toString('base64url')}.${service.sign('recent-event', JSON.stringify([identity(v), row.libraryId, row.id]))}`,
          downloadCompletedAt: iso(row.downloadCompletedAt),
          ...(row.registeredAt === null ? {} : { registeredAt: iso(row.registeredAt) }),
        };
        if (row.registeredAt === null) return { ...base, state: 'registering' };
        const missing = { ...base, state: 'missing' as const };
        const link = row.mediaLinkId ? links!.get(row.mediaLinkId) : null;
        const library = libraries.find((l) => l.id === row.libraryId)!;
        if (
          !link ||
          !link.gonicSongId ||
          link.libraryId !== row.libraryId ||
          !link.relativeFileKey.startsWith(`${library.relativeRoot}/`)
        )
          return missing;
        const root = service.options.recent?.musicRoot;
        if (!root) throw new ApiError(503, 'storage_unavailable');
        const filePresent = () => {
          try {
            return lstatSync(resolveFileKey(root, link.relativeFileKey)).isFile();
          } catch {
            return false;
          }
        };
        if (!filePresent()) return missing;
        try {
          const result = await v.upstream.recentSong(link.gonicSongId, { signal: abort.signal });
          if (
            result.song.id !== link.gonicSongId ||
            !matchingPath(result.path, link.relativeFileKey) ||
            !filePresent()
          )
            return missing;
          return { ...base, state: 'ready', song: result.song };
        } catch (error) {
          if (error instanceof SubsonicError && error.kind === 'not_found') return missing;
          return service.rejectUpstream(error, v.session.raw);
        }
      }
      try {
        await Promise.all(
          Array.from({ length: Math.min(4, page.length) }, async () => {
            while (!failed && next < page.length) {
              const index = next++;
              try {
                items[index] = await project(index);
              } catch (error) {
                if (!failed) {
                  failed = true;
                  failure = error;
                  abort.abort();
                }
              }
            }
          }),
        );
        if (failed) throw failure;
        service.find(v.session.token, v.session.scheme);
        const last = page.at(-1);
        return {
          schemaVersion: 1,
          filter: { from: iso(snapshot.from), to: iso(snapshot.to) },
          asOf: iso(snapshot.asOf),
          items,
          nextCursor:
            rows.length > limit && last
              ? encode(v, { ...snapshot, before: { at: last.downloadCompletedAt, id: last.id } })
              : null,
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}

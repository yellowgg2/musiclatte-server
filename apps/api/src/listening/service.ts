import { decodeListeningEvent, type MusicEntry } from '@musiclatte/contracts';
import { ApiError, upstreamError, type SessionService } from '../auth/session-service.js';
import { SubsonicError } from '../subsonic/errors.js';
import type { ListeningTopAnchor, StoredListeningEvent } from '../storage/listening-repository.js';
type Verified = Awaited<ReturnType<SessionService['verify']>>;
export interface ListeningQuery {
  from?: string;
  to?: string;
  limit?: string;
  cursor?: string;
}
function utc(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')
  )
    throw new ApiError(400, 'invalid_request');
  return Date.parse(value);
}
const wire = (event: StoredListeningEvent) => ({
  id: event.eventIdHash,
  songId: event.songId,
  startedAt: new Date(event.startedAt).toISOString(),
  qualifiedAt: new Date(event.qualifiedAt).toISOString(),
  receivedAt: new Date(event.receivedAt).toISOString(),
  source: 'web' as const,
});
export function createListeningService(service: SessionService) {
  const options = service.options.listening;
  const hash = (purpose: string, value: string) =>
    Buffer.from(service.sign(purpose, value), 'base64url').toString('hex');
  const identity = (v: Verified) =>
    hash('listening-identity', JSON.stringify([v.session.instanceId, v.identity.username]));
  function ready() {
    if (!options) throw new ApiError(404, 'not_found');
    return options;
  }
  function current(v: Verified, signal: AbortSignal) {
    if (signal.aborted) throw new ApiError(503, 'upstream_unavailable');
    service.find(v.session.token, v.session.scheme);
  }
  return {
    async record(v: Verified, body: unknown, signal: AbortSignal) {
      const { repository, clock, scrobble } = ready();
      let input;
      try {
        input = decodeListeningEvent(body);
      } catch {
        throw new ApiError(400, 'invalid_request');
      }
      const identityKey = identity(v);
      const eventIdHash = hash('listening-event', JSON.stringify([identityKey, input.eventId]));
      const requestHash = hash('listening-request', JSON.stringify(input));
      const response = (event: StoredListeningEvent) => ({
        schemaVersion: 1,
        eventId: input.eventId,
        event: wire(event),
        delivery: { status: event.status },
      });
      const replay = repository.receipt(identityKey, eventIdHash);
      if (replay) {
        if (replay.requestHash !== requestHash) throw new ApiError(409, 'conflict');
        return response(replay);
      }
      const startedAt = Date.parse(input.startedAt);
      const qualifiedAt = Date.parse(input.qualifiedAt);
      const now = clock();
      if (startedAt < now - 86400000 || qualifiedAt > now + 300000)
        throw new ApiError(400, 'invalid_request');
      const song = await v.upstream.getSong(input.songId, { signal });
      if (song.isDir || song.id !== input.songId) throw new ApiError(400, 'invalid_request');
      const threshold =
        typeof song.duration === 'number' && Number.isFinite(song.duration) && song.duration > 0
          ? Math.min(song.duration * 500, 240000)
          : 240000;
      if (input.listenedMs < threshold) throw new ApiError(400, 'invalid_request');
      current(v, signal);
      let stored;
      try {
        stored = repository.insert(
          { identityKey, eventIdHash, requestHash, songId: input.songId, startedAt, qualifiedAt },
          !scrobble,
        );
      } catch (error) {
        if (error instanceof Error && error.message === 'Listening conflict')
          throw new ApiError(409, 'conflict');
        throw error;
      }
      current(v, signal);
      if (scrobble && repository.claim(stored.sequence)) {
        try {
          await v.upstream.scrobble(input.songId, startedAt, { signal });
          repository.finish(stored.sequence, 'submitted');
        } catch (error) {
          repository.finish(stored.sequence, 'uncertain');
          if (upstreamError(error).status === 401) service.rejectUpstream(error, v.session.raw);
        }
      }
      return response(repository.receipt(identityKey, eventIdHash)!);
    },
    async list(
      v: Verified,
      purpose: 'history' | 'top',
      query: ListeningQuery,
      signal: AbortSignal,
    ) {
      const { repository, clock } = ready();
      const owner = identity(v);
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (query.from === undefined) !== (query.to === undefined)
      )
        throw new ApiError(400, 'invalid_request');
      const from = query.from === undefined ? 0 : utc(query.from);
      const requestedTo = query.to === undefined ? null : utc(query.to);
      if (from < 0 || (requestedTo !== null && from >= requestedTo))
        throw new ApiError(400, 'invalid_request');
      const binding = {
        purpose,
        owner,
        policy: v.session.policyRevision,
        scope: 'web',
        limit,
        from,
        requestedTo,
      };
      let asOf = clock();
      let highWater: number | undefined;
      let anchor: number | ListeningTopAnchor | undefined;
      if (query.cursor !== undefined) {
        try {
          const [payload, signature, extra] = query.cursor.split('.');
          if (
            !payload ||
            !signature ||
            extra ||
            !service.matches(signature, service.sign('listening-cursor', payload))
          )
            throw new Error();
          const cursor = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
          if (
            JSON.stringify(cursor.binding) !== JSON.stringify(binding) ||
            !Number.isSafeInteger(cursor.asOf) ||
            cursor.asOf < 0 ||
            !Number.isSafeInteger(cursor.highWater) ||
            cursor.highWater < 0
          )
            throw new Error();
          asOf = cursor.asOf;
          highWater = cursor.highWater;
          anchor = cursor.anchor;
        } catch {
          throw new ApiError(400, 'invalid_request');
        }
      }
      const filters = {
        limit,
        from,
        to: requestedTo ?? asOf + 1,
        ...(highWater === undefined ? {} : { highWater }),
      };
      let page;
      try {
        page =
          purpose === 'history'
            ? repository.history(owner, {
                ...filters,
                ...(anchor === undefined ? {} : { anchor: anchor as number }),
              })
            : repository.top(owner, {
                ...filters,
                ...(anchor === undefined ? {} : { anchor: anchor as ListeningTopAnchor }),
              });
      } catch (error) {
        if (
          error instanceof Error &&
          ['Invalid listening query', 'Invalid listening cursor'].includes(error.message)
        )
          throw new ApiError(400, 'invalid_request');
        throw error;
      }
      const ids = [...new Set(page.items.map((item) => item.songId))];
      const songs = new Map<string, MusicEntry | null>();
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
          while (index < ids.length) {
            const id = ids[index++]!;
            try {
              const song = await v.upstream.getSong(id, { signal });
              if (song.id !== id || song.isDir) throw new ApiError(503, 'upstream_unavailable');
              songs.set(id, song);
            } catch (error) {
              if (
                error instanceof SubsonicError &&
                (error.kind === 'not_found' || error.httpStatus === 404)
              )
                songs.set(id, null);
              else throw error;
            }
          }
        }),
      );
      current(v, signal);
      const items = page.items.map((item) => ({
        ...('sequence' in item
          ? wire(item)
          : {
              songId: item.songId,
              count: item.count,
              lastQualifiedAt: new Date(item.lastQualifiedAt).toISOString(),
            }),
        song: songs.get(item.songId) ?? null,
      }));
      const payload = page.next
        ? Buffer.from(
            JSON.stringify({ binding, asOf, highWater: page.highWater, anchor: page.next }),
          ).toString('base64url')
        : null;
      return {
        schemaVersion: 1,
        source: 'web',
        asOf: new Date(asOf).toISOString(),
        items,
        nextCursor: payload ? `${payload}.${service.sign('listening-cursor', payload)}` : null,
      };
    },
  };
}

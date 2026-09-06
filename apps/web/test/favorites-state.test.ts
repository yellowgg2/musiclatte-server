import type { MusicEntry } from '@musiclatte/contracts';
import { describe, expect, it, vi } from 'vitest';

const song = {
  id: 'song-a',
  title: 'First song',
  artist: 'Fixture artist',
  isDir: false,
} satisfies MusicEntry;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function makeSUT() {
  const modulePath = '../src/favorites/state';
  const module = await import(modulePath).catch(() => null);
  expect(module, 'favorites state module should exist').not.toBeNull();
  return module!;
}

describe('favorites state', () => {
  /** A mutation is optimistic, single-flight, and retryable from its rolled-back value. */
  it('should block duplicate intent and rollback a failed write before retry', async () => {
    const { createFavoritesStore } = await makeSUT();
    const firstWrite = deferred<{
      schemaVersion: 1;
      id: string;
      starred: true;
      song: MusicEntry;
    }>();
    const set = vi
      .fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce({ schemaVersion: 1, id: song.id, starred: true, song });
    const store = createFavoritesStore({
      client: { read: vi.fn().mockResolvedValue({ schemaVersion: 1, songs: [] }), set },
      onUnauthenticated: vi.fn(),
    });
    await store.setScope({ accountId: 'listener-a', csrfToken: 'csrf-a', enabled: true });

    expect(store.toggle(song)).toBe(true);
    expect(store.isStarred(song)).toBe(true);
    expect(store.getSongState(song.id)).toMatchObject({ pending: true });
    expect(store.toggle(song)).toBe(false);
    expect(set).toHaveBeenCalledOnce();

    firstWrite.reject(Object.assign(new Error('unavailable'), { code: 'upstream_unavailable' }));
    await vi.waitFor(() => expect(store.getSongState(song.id).pending).toBe(false));
    expect(store.isStarred(song)).toBe(false);
    expect(store.getSongState(song.id).error).toBe('upstream_unavailable');

    expect(store.retry(song.id)).toBe(true);
    await vi.waitFor(() => expect(store.isStarred(song)).toBe(true));
    expect(set).toHaveBeenCalledTimes(2);
    store.dispose();
  });

  /** Refresh order stays authoritative while a pending intent remains visible until it settles. */
  it('should preserve authoritative order and overlay only the current pending song', async () => {
    const { createFavoritesStore } = await makeSUT();
    const other = { ...song, id: 'song-b', title: 'Second song' };
    const write = deferred<{ schemaVersion: 1; id: string; starred: false }>();
    const store = createFavoritesStore({
      client: {
        read: vi.fn().mockResolvedValue({ schemaVersion: 1, songs: [other, song] }),
        set: vi.fn(() => write.promise),
      },
      onUnauthenticated: vi.fn(),
    });
    await store.setScope({ accountId: 'listener-a', csrfToken: 'csrf-a', enabled: true });
    expect(store.getSnapshot().songs.map((entry: MusicEntry) => entry.id)).toEqual([
      'song-b',
      'song-a',
    ]);

    store.toggle(song);
    expect(store.isStarred(song)).toBe(false);
    expect(store.getSnapshot().songs.map((entry: MusicEntry) => entry.id)).toEqual([
      'song-b',
      'song-a',
    ]);
    write.resolve({ schemaVersion: 1, id: song.id, starred: false });
    await vi.waitFor(() =>
      expect(store.getSnapshot().songs.map((entry: MusicEntry) => entry.id)).toEqual(['song-b']),
    );
    store.dispose();
  });

  /** Late old-account reads and writes never populate the newly scoped account. */
  it('should discard obsolete account generations and abort their requests', async () => {
    const { createFavoritesStore } = await makeSUT();
    const firstRead = deferred<{ schemaVersion: 1; songs: MusicEntry[] }>();
    const read = vi
      .fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockResolvedValueOnce({ schemaVersion: 1, songs: [] });
    const store = createFavoritesStore({
      client: { read, set: vi.fn() },
      onUnauthenticated: vi.fn(),
    });
    const obsolete = store.setScope({
      accountId: 'listener-a',
      csrfToken: 'csrf-a',
      enabled: true,
    });
    await store.setScope({ accountId: 'listener-b', csrfToken: 'csrf-b', enabled: true });
    firstRead.resolve({ schemaVersion: 1, songs: [song] });
    await obsolete;

    expect(store.getSnapshot().accountId).toBe('listener-b');
    expect(store.isStarred(song)).toBe(false);
    expect(read.mock.calls[0]?.[0].aborted).toBe(true);
    store.dispose();
  });
});

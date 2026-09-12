import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetadataChange, MetadataChangesPage, MusicEntry } from '@musiclatte/contracts';
import { initialPlayerState, reducePlayerState, type PlayerAction } from '../src/player/state';
import { setRepeat, setShuffle } from '../src/player/queue';
import { ApiError } from '../src/auth/client';

afterEach(() => vi.useRealTimers());

export const change: MetadataChange = {
  sequence: 1,
  libraryId: 'music',
  oldTrackId: 'one',
  newTrackId: 'one',
  identityResolution: 'unchanged',
  oldRevision: 'revision-0',
  newRevision: 'revision-1',
  coverGeneration: 'revision-1',
  relatedIds: {
    trackIds: ['one'],
    albumIds: ['album'],
    artistIds: ['artist'],
    coverIds: ['cover'],
  },
  changedFields: ['title', 'cover'],
  fileSavedAt: 1,
  reflectedAt: 2,
  reflection: 'verified',
};
const page = (changes: MetadataChange[]): MetadataChangesPage => ({
  schemaVersion: 1,
  changes,
  hasMore: false,
  nextCursor: 'cursor-1',
});
async function makeSUT() {
  const path = resolve('apps/web/src/metadata/state.ts');
  expect(existsSync(path), 'metadata sync state exists').toBe(true);
  return import(path);
}
describe('metadata synchronization state', () => {
  /** Cursor polling pauses while hidden and a disposed request cannot publish a late event. */
  it('should poll at three seconds with cursor continuity and cancel hidden or obsolete work', async () => {
    vi.useFakeTimers();
    const module = await makeSUT();
    expect(typeof module.createMetadataSyncStore).toBe('function');
    let resolveLate!: (value: MetadataChangesPage) => void;
    const changes = vi
      .fn()
      .mockResolvedValueOnce(page([change]))
      .mockResolvedValueOnce(page([]))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLate = resolve;
          }),
      );
    const invalidate = vi.fn();
    const store = module.createMetadataSyncStore({
      client: { changes, invalidate },
      onUnauthenticated: vi.fn(),
    });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().version).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(changes.mock.calls[1]![0]).toBe('cursor-1');
    store.setVisible(false);
    await vi.advanceTimersByTimeAsync(30000);
    expect(changes).toHaveBeenCalledTimes(2);
    store.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    store.stop();
    resolveLate(page([{ ...change, sequence: 2, newRevision: 'revision-2' }]));
    await vi.advanceTimersByTimeAsync(10000);
    expect(store.getSnapshot().coverVersions.get('cover')).toBe('revision-1');
    expect(invalidate).toHaveBeenCalled();
    expect(changes).toHaveBeenCalledTimes(3);
  });
  /** Offline failures use bounded backoff; cursor invalidation restarts only the feed snapshot. */
  it('should back off at three six twelve and thirty seconds without clearing visible metadata', async () => {
    vi.useFakeTimers();
    const module = await makeSUT();
    expect(typeof module.createMetadataSyncStore).toBe('function');
    const changes = vi.fn().mockRejectedValue(new ApiError('upstream_unavailable'));
    const store = module.createMetadataSyncStore({
      client: { changes, invalidate: vi.fn() },
      onUnauthenticated: vi.fn(),
    });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(changes).toHaveBeenCalledTimes(1);
    for (const [index, ms] of [3000, 6000, 12000, 30000].entries()) {
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(changes).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(changes).toHaveBeenCalledTimes(index + 2);
    }
    store.stop();
  });
  /** Duplicate queue occurrences retain their physical slots, playback state and stream identity. */
  it('should refresh display fields without replacing queue order or playback state', () => {
    const one: MusicEntry = {
      id: 'one',
      title: 'Before',
      artist: 'Artist',
      coverArt: 'cover',
      duration: 180,
      isDir: false,
    };
    const two: MusicEntry = { id: 'two', title: 'Second', isDir: false };
    let state = reducePlayerState(initialPlayerState, {
      type: 'activate',
      song: one,
      songs: [one, two, one],
      source: 'playlist:one@revision',
      position: 2,
    });
    state = {
      ...state,
      queue: setRepeat(
        setShuffle(state.queue!, true, () => 0),
        'all',
      ),
      currentTime: 73,
      volume: 0.4,
      status: 'playing',
    };
    const action = {
      type: 'refreshMetadata',
      songs: [{ ...one, title: 'After', artist: undefined, coverArt: 'new-cover', duration: 999 }],
    } as unknown as PlayerAction;
    const next = reducePlayerState(state, action);
    expect(next?.current?.title).toBe('After');
    expect(next.current?.artist).toBeUndefined();
    expect(next.queue?.items.map((item) => item.title)).toEqual(['After', 'Second', 'After']);
    expect(next.queue?.order).toBe(state.queue?.order);
    expect(next.queue?.source).toBe(state.queue?.source);
    expect(next.queue?.position).toBe(state.queue?.position);
    expect(next.queue?.repeat).toBe('all');
    expect(next.queue?.shuffled).toBe(true);
    expect(next.currentTime).toBe(73);
    expect(next.duration).toBe(state.duration);
    expect(next.volume).toBe(0.4);
    expect(next.status).toBe('playing');
    expect(next.current?.duration).toBe(180);
  });
  /** Pending/status-only events cannot publish cover generations or refetch browsed metadata. */
  it('should publish verified revisions once and keep identity conflicts out of refreshes', async () => {
    const { initialMetadataState, applyMetadataChanges } = await makeSUT();
    const pending = {
      ...change,
      reflection: 'reflection_mismatch',
      reflectedAt: null,
    } as MetadataChange;
    const first = applyMetadataChanges(initialMetadataState, page([pending]));
    expect(first.version).toBe(0);
    expect(first.coverVersions.size).toBe(0);
    expect(first.statusVersion).toBe(1);
    const verified = applyMetadataChanges(first, page([{ ...change, sequence: 2 }]));
    expect(verified.version).toBe(1);
    expect(verified.coverVersions.get('cover')).toBe('revision-1');
    expect(applyMetadataChanges(verified, page([{ ...change, sequence: 2 }]))).toBe(verified);
    const conflict = applyMetadataChanges(
      verified,
      page([
        {
          ...change,
          sequence: 3,
          newTrackId: 'replacement',
          identityResolution: 'replacement_unresolved',
          reflection: 'reference_conflict',
          reflectedAt: null,
        },
      ]),
    );
    expect(conflict.version).toBe(1);
    expect(conflict.coverVersions.get('cover')).toBe('revision-1');
    expect(conflict.trackVersions.has('replacement')).toBe(false);
  });
});

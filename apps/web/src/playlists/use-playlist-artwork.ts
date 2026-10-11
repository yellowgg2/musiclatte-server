import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { PlaylistSummary } from '@musiclatte/contracts';
import { errorCode } from '../auth/client';
import { createPlaylistClient } from './client';

type ArtworkState = { loading: boolean; coverArt?: string };
const missing: ArtworkState = { loading: false };

/** One page-local request slot; only intersecting, unresolved cards enter it. */
export function usePlaylistArtwork({
  playlists,
  client,
  generation,
  onUnauthenticated,
}: {
  playlists: readonly PlaylistSummary[];
  client: ReturnType<typeof createPlaylistClient>;
  generation: string;
  onUnauthenticated: () => void;
}) {
  const root = useRef<HTMLUListElement>(null);
  const cache = useMemo(() => new Map<string, ArtworkState>(), [client, generation]);
  const [, changed] = useReducer((value: number) => value + 1, 0);
  const signature = JSON.stringify(playlists.map(({ id, revision }) => [id, revision]));
  useEffect(() => {
    const entries = new Map(
      playlists.map((playlist) => [playlist.id, JSON.stringify([playlist.id, playlist.revision])]),
    );
    const keys = new Set(entries.values());
    for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key);
    let active = true;
    let busy = false;
    let controller: AbortController | undefined;
    let pendingKey: string | undefined;
    const visible = new Set<string>();
    const elements = new Map(
      Array.from(root.current?.querySelectorAll<HTMLElement>('[data-playlist-id]') ?? []).map(
        (element) => [element.dataset.playlistId!, element],
      ),
    );
    let observer: IntersectionObserver | undefined;
    const pump = () => {
      if (!active || busy) return;
      const id = Array.from(visible).find((id) => entries.has(id) && !cache.has(entries.get(id)!));
      if (!id) return;
      const key = entries.get(id)!;
      busy = true;
      pendingKey = key;
      controller = new AbortController();
      const signal = controller.signal;
      cache.set(key, { loading: true });
      changed();
      void client
        .artwork(id, signal)
        .then((result) => {
          if (!active || signal.aborted) return;
          cache.set(key, {
            loading: false,
            ...(result.coverState === 'available' ? { coverArt: result.coverArt } : {}),
          });
        })
        .catch((error) => {
          if (!active || signal.aborted) return;
          cache.set(key, missing);
          if (errorCode(error) === 'unauthenticated') {
            active = false;
            onUnauthenticated();
          }
        })
        .finally(() => {
          if (!active || signal.aborted) return;
          const element = elements.get(id);
          if (element) observer?.unobserve(element);
          pendingKey = undefined;
          busy = false;
          changed();
          pump();
        });
    };
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((changes) => {
        for (const entry of changes) {
          const id = (entry.target as HTMLElement).dataset.playlistId;
          if (!id) continue;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        pump();
      });
      for (const [id, element] of elements)
        if (!cache.has(entries.get(id)!)) observer.observe(element);
    } else {
      elements.forEach((_element, id) => visible.add(id));
      pump();
    }
    return () => {
      active = false;
      observer?.disconnect();
      controller?.abort();
      if (pendingKey && cache.get(pendingKey)?.loading) cache.delete(pendingKey);
      visible.clear();
    };
  }, [cache, client, signature, onUnauthenticated]);
  return {
    root,
    get: (playlist: PlaylistSummary) =>
      cache.get(JSON.stringify([playlist.id, playlist.revision])) ?? missing,
  };
}

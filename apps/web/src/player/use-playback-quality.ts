import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackQuality } from '@musiclatte/contracts';
import {
  decodeQuality,
  memoryQuality,
  qualityScope,
  qualityStorageKey,
  rememberQuality,
} from './quality';
export interface PlaybackPreference {
  scope: string;
  value: PlaybackQuality | null;
  set(value: PlaybackQuality): void;
}
export function usePlaybackQuality(
  apiOrigin: string,
  instanceId?: string,
  username?: string,
): PlaybackPreference {
  const scope =
    instanceId && username
      ? qualityScope(apiOrigin, instanceId, username, window.location.origin)
      : '';
  const current = useRef(scope);
  current.current = scope;
  const revision = useRef(0);
  const [selection, setSelection] = useState<{ scope: string; value: PlaybackQuality | null }>({
    scope,
    value: memoryQuality(scope),
  });
  useEffect(() => {
    let active = true;
    const version = revision.current;
    if (!scope) return;
    const memory = memoryQuality(scope);
    setSelection({ scope, value: memory });
    if (memory) return;
    void qualityStorageKey(scope)
      .then((key) => {
        if (!active || current.current !== scope || revision.current !== version) return;
        let value: PlaybackQuality | null = null;
        try {
          value = decodeQuality(window.localStorage.getItem(key));
        } catch {
          /* Memory-only preference. */
        }
        if (value) {
          rememberQuality(scope, value);
          setSelection({ scope, value });
        }
      })
      .catch(() => {
        /* Storage unavailable without Web Crypto. */
      });
    return () => {
      active = false;
    };
  }, [scope]);
  const set = useCallback(
    (value: PlaybackQuality) => {
      if (!scope || !decodeQuality(value)) return;
      revision.current++;
      rememberQuality(scope, value);
      setSelection({ scope, value });
      const version = revision.current;
      void qualityStorageKey(scope)
        .then((key) => {
          if (current.current !== scope || version !== revision.current) return;
          try {
            window.localStorage.setItem(key, value);
          } catch {
            /* Keep memory selection. */
          }
        })
        .catch(() => {});
    },
    [scope],
  );
  return { scope, value: selection.scope === scope ? selection.value : memoryQuality(scope), set };
}

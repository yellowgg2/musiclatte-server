import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Locale } from '../i18n';
import { createMusicClient } from '../music/client';
import { DesktopPlayer } from './DesktopPlayer';
import { MiniPlayer } from './MiniPlayer';
import { usePlayer } from './PlayerProvider';
import { TrackDetailsDialog } from './TrackDetailsDialog';

type Presentation = 'queue' | 'expanded' | 'details';
export function PlayerSurface({
  locale,
  fetcher,
  apiOrigin,
  scope,
  onUnauthenticated,
}: {
  locale: Locale;
  fetcher: typeof fetch;
  apiOrigin: string;
  scope: string;
  onUnauthenticated: () => void;
}) {
  const { state, coverUrl } = usePlayer();
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [presentation, setPresentation] = useState<{ kind: Presentation; scope: string } | null>(
    null,
  );
  useEffect(() => setPresentation(null), [scope]);
  const active = presentation?.scope === scope ? presentation.kind : null;
  const client = useMemo(() => createMusicClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const closeDetails = useCallback(() => {
    setPresentation(null);
    requestAnimationFrame(() => {
      const triggers = Array.from(
        root.current?.querySelectorAll<HTMLButtonElement>('[data-track-details-trigger]') ?? [],
      );
      const visible = (button: HTMLButtonElement) =>
        button.isConnected && button.getClientRects().length > 0;
      const target =
        opener.current && visible(opener.current) ? opener.current : triggers.find(visible);
      target?.focus();
    });
  }, []);
  const onExpandedChange = useCallback(
    (expanded: boolean) => setPresentation(expanded ? { kind: 'expanded', scope } : null),
    [scope],
  );
  const openDetails = (button: HTMLButtonElement) => {
    opener.current = button;
    setPresentation({ kind: 'details', scope });
  };
  return (
    <div ref={root}>
      <DesktopPlayer
        locale={locale}
        queueOpen={active === 'queue'}
        onToggleQueue={() => setPresentation(active === 'queue' ? null : { kind: 'queue', scope })}
        onDetails={openDetails}
      />
      <MiniPlayer
        locale={locale}
        expanded={active === 'expanded'}
        onExpandedChange={onExpandedChange}
        onDetails={openDetails}
      />
      {active === 'details' && state.current && (
        <TrackDetailsDialog
          current={state.current}
          client={client}
          coverUrl={coverUrl}
          locale={locale}
          onClose={closeDetails}
          onUnauthenticated={onUnauthenticated}
        />
      )}
    </div>
  );
}

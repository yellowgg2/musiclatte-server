import { useCallback, useRef } from 'react';
import { Artwork } from '../design/components/Artwork';
import { IconAction } from '../design/components/IconAction';
import { messages, type Locale } from '../i18n';
import { ExpandedPlayer } from './ExpandedPlayer';
import { usePlayer } from './PlayerProvider';
import { playLabel } from './view-helpers';
import styles from './Player.module.css';
import { FavoriteAction } from '../favorites/components/FavoriteAction';

export function MiniPlayer({
  locale,
  expanded,
  onExpandedChange,
  onDetails,
}: {
  locale: Locale;
  expanded: boolean;
  onExpandedChange: (value: boolean) => void;
  onDetails: (button: HTMLButtonElement) => void;
}) {
  const player = usePlayer();
  const opener = useRef<HTMLButtonElement>(null);
  const copy = messages[locale];
  const closeExpanded = useCallback(() => {
    onExpandedChange(false);
    requestAnimationFrame(() => opener.current?.focus());
  }, [onExpandedChange]);
  if (!player.state.current) return null;
  const current = player.state.current;
  return (
    <>
      <aside className={styles.mini} aria-label={copy['player.nowPlaying']} data-persistent-player>
        <button
          type="button"
          className={styles.coverButton}
          data-track-details-trigger
          aria-haspopup="dialog"
          aria-label={`${copy['player.details.open']}: ${current.title}`}
          onClick={(event) => onDetails(event.currentTarget)}
        >
          <Artwork
            alt=""
            {...(current.coverArt ? { src: player.coverUrl(current.coverArt) } : {})}
          />
        </button>
        <button
          ref={opener}
          type="button"
          className={styles.miniTrack}
          aria-label={`${copy['player.expand']}: ${current.title}`}
          aria-expanded={expanded}
          onClick={() => onExpandedChange(true)}
        >
          <strong>{current.title}</strong>
          <small>{current.artist || copy['music.unknownArtist']}</small>
        </button>
        <IconAction
          label={playLabel(locale, current.title, player.state.status)}
          onClick={player.state.status === 'playing' ? player.pause : player.resume}
        >
          {player.state.status === 'playing' ? 'Ⅱ' : '▶'}
        </IconAction>
        <FavoriteAction song={current} locale={locale} compact />
        <IconAction label={copy['player.next']} onClick={player.next}>
          |▶
        </IconAction>
      </aside>
      {expanded && <ExpandedPlayer locale={locale} onClose={closeExpanded} />}
    </>
  );
}

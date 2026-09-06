import { useCallback, useRef, useState } from 'react';
import { Artwork } from '../design/components/Artwork';
import { IconAction } from '../design/components/IconAction';
import { messages, type Locale } from '../i18n';
import { ExpandedPlayer } from './ExpandedPlayer';
import { usePlayer } from './PlayerProvider';
import { playLabel } from './view-helpers';
import styles from './Player.module.css';
import { FavoriteAction } from '../favorites/components/FavoriteAction';

export function MiniPlayer({ locale }: { locale: Locale }) {
  const player = usePlayer();
  const [expanded, setExpanded] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const copy = messages[locale];
  const closeExpanded = useCallback(() => {
    setExpanded(false);
    requestAnimationFrame(() => opener.current?.focus());
  }, []);
  if (!player.state.current) return null;
  const current = player.state.current;
  return (
    <>
      <aside className={styles.mini} aria-label={copy['player.nowPlaying']} data-persistent-player>
        <Artwork alt="" {...(current.coverArt ? { src: player.coverUrl(current.coverArt) } : {})} />
        <button
          ref={opener}
          type="button"
          className={styles.miniTrack}
          aria-label={`${copy['player.expand']}: ${current.title}`}
          aria-expanded={expanded}
          onClick={() => setExpanded(true)}
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

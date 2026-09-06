import { useState } from 'react';
import { Artwork } from '../design/components/Artwork';
import { IconAction } from '../design/components/IconAction';
import { messages, type Locale } from '../i18n';
import { usePlayer } from './PlayerProvider';
import { QueueView } from './QueueView';
import { formatTime, playLabel } from './view-helpers';
import styles from './Player.module.css';
import { FavoriteAction } from '../favorites/components/FavoriteAction';

export function DesktopPlayer({ locale }: { locale: Locale }) {
  const player = usePlayer();
  const [queueOpen, setQueueOpen] = useState(false);
  const { state } = player;
  const copy = messages[locale];
  if (!state.current || !state.queue) return null;
  const repeat = copy[`player.repeat.${state.queue.repeat}`];
  return (
    <aside className={styles.desktop} aria-label={copy['player.nowPlaying']} data-persistent-player>
      <div className={styles.track}>
        <Artwork
          alt=""
          {...(state.current.coverArt ? { src: player.coverUrl(state.current.coverArt) } : {})}
        />
        <span>
          <strong>{state.current.title}</strong>
          <small>{state.current.artist || copy['music.unknownArtist']}</small>
        </span>
      </div>
      <div className={styles.transport}>
        <IconAction label={copy['player.previous']} onClick={player.previous}>
          ◀|
        </IconAction>
        <IconAction
          label={playLabel(locale, state.current.title, state.status)}
          onClick={state.status === 'playing' ? player.pause : player.resume}
        >
          {state.status === 'playing' ? 'Ⅱ' : '▶'}
        </IconAction>
        <IconAction label={copy['player.next']} onClick={player.next}>
          |▶
        </IconAction>
      </div>
      <label className={styles.seek}>
        <span>{copy['player.seek']}</span>
        <span aria-hidden="true">{formatTime(state.currentTime)}</span>
        <input
          aria-label={copy['player.seek']}
          type="range"
          min="0"
          max={Math.max(1, state.duration)}
          step="1"
          value={Math.min(state.currentTime, Math.max(1, state.duration))}
          onChange={(event) => player.seek(Number(event.currentTarget.value))}
        />
        <span aria-hidden="true">{formatTime(state.duration)}</span>
      </label>
      <div className={styles.options}>
        <FavoriteAction song={state.current} locale={locale} compact />
        <IconAction
          label={copy['player.shuffle']}
          pressed={state.queue.shuffled}
          onClick={player.toggleShuffle}
        >
          ⇄
        </IconAction>
        <IconAction label={`${copy['player.repeat']}: ${repeat}`} onClick={player.cycleRepeat}>
          ↻
        </IconAction>
        <label className={styles.volume}>
          <span>{copy['player.volume']}</span>
          <input
            aria-label={copy['player.volume']}
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={state.volume}
            onChange={(event) => player.setVolume(Number(event.currentTarget.value))}
          />
        </label>
        <IconAction
          label={queueOpen ? copy['player.hideQueue'] : copy['player.showQueue']}
          pressed={queueOpen}
          aria-expanded={queueOpen}
          onClick={() => setQueueOpen((value) => !value)}
        >
          ≡
        </IconAction>
      </div>
      {state.status === 'loading' && <p role="status">{copy['player.loading']}</p>}
      {state.error && <p role="alert">{copy[`player.error.${state.error}`]}</p>}
      {queueOpen && (
        <div className={styles.desktopQueue}>
          <QueueView locale={locale} />
        </div>
      )}
    </aside>
  );
}

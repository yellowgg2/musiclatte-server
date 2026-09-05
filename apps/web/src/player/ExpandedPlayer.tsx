import { useEffect, useRef } from 'react';
import { Artwork } from '../design/components/Artwork';
import { IconAction } from '../design/components/IconAction';
import { messages, type Locale } from '../i18n';
import { QueueView } from './QueueView';
import { usePlayer } from './PlayerProvider';
import { formatTime, playLabel } from './view-helpers';
import styles from './Player.module.css';

export function ExpandedPlayer({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const player = usePlayer();
  const dialog = useRef<HTMLElement>(null);
  const copy = messages[locale];
  useEffect(() => {
    dialog.current?.querySelector('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const controls = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [onClose]);
  if (!player.state.current || !player.state.queue) return null;
  const { current, queue } = player.state;
  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={copy['player.nowPlaying']}
      >
        <header>
          <h2>{copy['player.nowPlaying']}</h2>
          <IconAction label={copy['player.close']} onClick={onClose}>
            ×
          </IconAction>
        </header>
        <div className={styles.heroArtwork}>
          <Artwork
            alt=""
            {...(current.coverArt ? { src: player.coverUrl(current.coverArt) } : {})}
          />
        </div>
        <div className={styles.sheetTitle}>
          <strong>{current.title}</strong>
          <span>{current.artist || copy['music.unknownArtist']}</span>
        </div>
        <label className={styles.sheetSeek}>
          <span>{copy['player.seek']}</span>
          <input
            aria-label={copy['player.seek']}
            type="range"
            min="0"
            max={Math.max(1, player.state.duration)}
            value={Math.min(player.state.currentTime, Math.max(1, player.state.duration))}
            onChange={(event) => player.seek(Number(event.currentTarget.value))}
          />
          <span>
            {formatTime(player.state.currentTime)} / {formatTime(player.state.duration)}
          </span>
        </label>
        <div className={styles.sheetTransport}>
          <IconAction label={copy['player.previous']} onClick={player.previous}>
            ◀|
          </IconAction>
          <IconAction
            label={playLabel(locale, current.title, player.state.status)}
            onClick={player.state.status === 'playing' ? player.pause : player.resume}
          >
            {player.state.status === 'playing' ? 'Ⅱ' : '▶'}
          </IconAction>
          <IconAction label={copy['player.next']} onClick={player.next}>
            |▶
          </IconAction>
          <IconAction
            label={copy['player.shuffle']}
            pressed={queue.shuffled}
            onClick={player.toggleShuffle}
          >
            ⇄
          </IconAction>
          <IconAction
            label={`${copy['player.repeat']}: ${copy[`player.repeat.${queue.repeat}`]}`}
            onClick={player.cycleRepeat}
          >
            ↻
          </IconAction>
        </div>
        <QueueView locale={locale} />
      </section>
    </div>
  );
}

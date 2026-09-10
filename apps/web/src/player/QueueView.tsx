import { useEffect, useRef } from 'react';
import { messages, type Locale } from '../i18n';
import { usePlayer } from './PlayerProvider';
import styles from './Player.module.css';

export function QueueView({ locale }: { locale: Locale }) {
  const { state, selectQueueSong } = usePlayer();
  const copy = messages[locale];
  const currentRow = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    currentRow.current?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, []);

  if (!state.queue) return null;
  return (
    <section className={styles.queue}>
      <h2>{copy['player.queue']}</h2>
      <ol aria-label={copy['player.queue']} role="region" tabIndex={0}>
        {state.queue.order.map((itemIndex, position) => {
          const song = state.queue!.items[itemIndex]!;
          const active = position === state.queue!.position;
          return (
            <li key={`${song.id}:${position}`}>
              <button
                ref={active ? currentRow : undefined}
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => selectQueueSong(position)}
              >
                <span>{song.title}</span>
                <small>{song.artist || copy['music.unknownArtist']}</small>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

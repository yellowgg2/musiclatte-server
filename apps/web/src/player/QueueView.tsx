import { messages, type Locale } from '../i18n';
import { currentSong } from './queue';
import { usePlayer } from './PlayerProvider';
import styles from './Player.module.css';

export function QueueView({ locale }: { locale: Locale }) {
  const { state, selectQueueSong } = usePlayer();
  const copy = messages[locale];
  const current = currentSong(state.queue);
  if (!state.queue) return null;
  return (
    <section className={styles.queue}>
      <h2>{copy['player.queue']}</h2>
      <ol aria-label={copy['player.queue']} role="region" tabIndex={0}>
        {state.queue.order.map((itemIndex, position) => {
          const song = state.queue!.items[itemIndex]!;
          const active = song.id === current?.id;
          return (
            <li key={`${song.id}:${position}`}>
              <button
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

import type { MusicEntry } from '@musiclatte/contracts';
import { Action } from '../../design/components/Action';
import { IconAction } from '../../design/components/IconAction';
import { messages, type Locale } from '../../i18n';
import { useFavorites } from '../FavoritesProvider';
import styles from './FavoriteAction.module.css';

export function FavoriteAction({
  song,
  locale,
  compact = false,
}: {
  song: MusicEntry;
  locale: Locale;
  compact?: boolean;
}) {
  const { store, state } = useFavorites();
  if (!state.enabled) return null;
  const copy = messages[locale];
  const starred = store.isStarred(song);
  const songState = store.getSongState(song.id);
  const label = copy[starred ? 'favorites.remove' : 'favorites.add'].replace('{title}', song.title);
  return (
    <div className={styles.group} data-compact={compact || undefined}>
      <IconAction
        label={label}
        pressed={starred}
        disabled={songState.pending}
        aria-busy={songState.pending || undefined}
        onClick={() => store.toggle(song)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill={starred ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" />
        </svg>
      </IconAction>
      {songState.error && (
        <div className={styles.feedback}>
          <span className={styles.error} role="alert">
            {copy['favorites.updateError']} {copy[`error.${songState.error}`]}
          </span>
          <Action variant="quiet" onClick={() => store.retry(song.id)}>
            {copy[starred ? 'favorites.retryRemove' : 'favorites.retryAdd'].replace(
              '{title}',
              song.title,
            )}
          </Action>
        </div>
      )}
    </div>
  );
}

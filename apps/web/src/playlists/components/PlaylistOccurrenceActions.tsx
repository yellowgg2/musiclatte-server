import { useState, type Ref } from 'react';
import type { PlaylistOccurrence } from '@musiclatte/contracts';
import { Action } from '../../design/components/Action';
import { IconAction } from '../../design/components/IconAction';
import { messages, type Locale } from '../../i18n';
import styles from './PlaylistOccurrenceActions.module.css';

function label(template: string, entry: PlaylistOccurrence) {
  return template
    .replace('{title}', entry.song.title)
    .replace('{position}', String(entry.position + 1));
}

export function PlaylistOccurrenceActions({
  entry,
  count,
  locale,
  pending,
  groupRef,
  onMove,
  onRemove,
}: {
  entry: PlaylistOccurrence;
  count: number;
  locale: Locale;
  pending: boolean;
  groupRef?: Ref<HTMLDivElement>;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const copy = messages[locale];
  const first = entry.position === 0;
  const last = entry.position === count - 1;
  const groupLabel = label(copy['playlists.editActions'], entry);

  return (
    <div
      className={styles.actions}
      role="group"
      aria-label={groupLabel}
      ref={groupRef}
      tabIndex={-1}
      data-confirming={confirming ? 'true' : undefined}
    >
      <IconAction
        label={label(first ? copy['playlists.moveUpFirst'] : copy['playlists.moveUp'], entry)}
        disabled={pending || first}
        onClick={() => onMove('up')}
      >
        ↑
      </IconAction>
      <IconAction
        label={label(last ? copy['playlists.moveDownLast'] : copy['playlists.moveDown'], entry)}
        disabled={pending || last}
        onClick={() => onMove('down')}
      >
        ↓
      </IconAction>
      <IconAction
        className={styles.remove}
        label={label(copy['playlists.removeOccurrence'], entry)}
        disabled={pending}
        onClick={() => setConfirming(true)}
      >
        ×
      </IconAction>
      {confirming && (
        <div
          className={styles.confirmation}
          role="group"
          aria-label={label(copy['playlists.removeQuestion'], entry)}
        >
          <p>{label(copy['playlists.removeContext'], entry)}</p>
          <Action variant="destructive" busy={pending} onClick={onRemove}>
            {copy['playlists.removeSong']}
          </Action>
          <Action variant="quiet" disabled={pending} onClick={() => setConfirming(false)}>
            {copy['playlists.cancel']}
          </Action>
        </div>
      )}
    </div>
  );
}

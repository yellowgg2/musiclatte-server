import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MusicEntry } from '@musiclatte/contracts';
import { errorCode } from '../auth/client';
import { Artwork } from '../design/components/Artwork';
import { messages, type Locale } from '../i18n';
import { useMetadataSync } from '../metadata/MetadataSyncProvider';
import { createMusicClient } from '../music/client';
import { formatTime } from './view-helpers';
import styles from './TrackDetailsDialog.module.css';

export function TrackDetailsDialog({
  current,
  client,
  coverUrl,
  locale,
  onClose,
  onUnauthenticated,
}: {
  current: MusicEntry;
  client: ReturnType<typeof createMusicClient>;
  coverUrl: (id: string) => string;
  locale: Locale;
  onClose: () => void;
  onUnauthenticated: () => void;
}) {
  const copy = messages[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const metadata = useMetadataSync();
  const version = metadata.state.trackVersions.get(current.id) ?? 0;
  const requestKey = JSON.stringify([current.id, version]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; song?: MusicEntry; failed?: boolean } | null>(
    null,
  );
  useEffect(() => {
    const node = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      node.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void client
      .song(current.id, controller.signal)
      .then((song) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, song });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (errorCode(error) === 'unauthenticated') onUnauthenticated();
        else setResult({ key: requestKey, failed: true });
      });
    return () => controller.abort();
  }, [client, current.id, requestKey, attempt, onUnauthenticated]);
  const resolved = result?.key === requestKey ? result : null;
  const song = resolved?.song ?? current;
  const fields: [string, string][] = [];
  if (song.album?.trim()) fields.push([copy['player.details.album'], song.album]);
  if (song.year && Number.isInteger(song.year) && song.year > 0)
    fields.push([copy['player.details.year'], String(song.year)]);
  if (song.genre?.trim()) fields.push([copy['player.details.genre'], song.genre]);
  if (song.track && Number.isInteger(song.track) && song.track > 0)
    fields.push([copy['player.details.track'], String(song.track)]);
  if (song.duration && Number.isFinite(song.duration) && song.duration > 0)
    fields.push([copy['player.details.duration'], formatTime(song.duration)]);
  return createPortal(
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id={titleId}>{copy['player.details.title']}</h2>
        <button type="button" autoFocus onClick={onClose} aria-label={copy['player.details.close']}>
          ×
        </button>
      </header>
      <div className={styles.body}>
        <div className={styles.cover}>
          <Artwork
            alt=""
            fit="contain"
            {...(song.coverArt ? { src: coverUrl(song.coverArt) } : {})}
          />
        </div>
        <div className={styles.information}>
          <h3>{song.title}</h3>
          <p className={styles.artist}>{song.artist?.trim() || copy['music.unknownArtist']}</p>
          {fields.length > 0 && (
            <dl>
              {fields.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {!resolved && <p role="status">{copy['player.details.loading']}</p>}
          {resolved?.failed && (
            <div className={styles.error}>
              <p role="alert">{copy['player.details.error']}</p>
              <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                {copy['status.retry']}
              </button>
            </div>
          )}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

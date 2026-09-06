import { useState } from 'react';
import type { MusicEntry } from '@musiclatte/contracts';
import { Artwork } from '../../design/components/Artwork';
import { IconAction } from '../../design/components/IconAction';
import { messages, type Locale } from '../../i18n';
import type { PlaybackStatus } from '../../player/state';
import { playLabel } from '../../player/view-helpers';
import type { SongActivation } from '../activation';
import { musicHref } from '../queries';
import styles from './MusicRow.module.css';

export function MusicRow({
  song,
  locale,
  base = '/',
  scope = new URLSearchParams(),
  songs = [],
  onActivate,
  onPause,
  onResume,
  current = false,
  playbackStatus = 'idle',
  coverUrl,
  selected,
  onSelect,
}: {
  song: MusicEntry;
  locale: Locale;
  base?: string;
  scope?: URLSearchParams;
  songs?: readonly MusicEntry[];
  onActivate?: SongActivation;
  onPause?: () => void;
  onResume?: () => void;
  current?: boolean;
  playbackStatus?: PlaybackStatus;
  coverUrl?: (id: string) => string;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const copy = messages[locale];
  const seconds = song.duration === undefined ? null : Math.floor(song.duration);
  return (
    <li className={styles.row}>
      <div className={styles.rowMain} data-selectable={onSelect ? 'true' : undefined}>
        {onSelect && (
          <label className={styles.selection}>
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelect(event.currentTarget.checked)}
            />
            <span className={styles.srOnly}>
              {copy[selected ? 'selection.deselectSong' : 'selection.selectSong'].replace(
                '{title}',
                song.title,
              )}
            </span>
          </label>
        )}
        <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary
            className={styles.summary}
            aria-label={`${copy['music.details']}: ${song.title}`}
          >
            <span className={styles.cover}>
              <Artwork
                alt=""
                {...(song.coverArt && coverUrl ? { src: coverUrl(song.coverArt) } : {})}
              />
            </span>
            <span className={styles.information}>
              <span className={styles.title}>{song.title}</span>
              {!expanded && (
                <span className={styles.metadata}>
                  <span>{song.artist || copy['music.unknownArtist']}</span>
                  {song.album && <span>{song.album}</span>}
                </span>
              )}
            </span>
            {seconds !== null && (
              <span
                className={styles.duration}
                aria-label={`${copy['music.duration']}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
              >
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
              </span>
            )}
            <svg
              className={styles.disclosure}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          {expanded && (
            <div className={styles.expanded}>
              {song.artistId && (
                <a
                  className={styles.detailLink}
                  href={musicHref(base, 'artist', song.artistId, scope)}
                  aria-label={`${copy['music.viewArtist']}: ${song.artist || copy['music.unknownArtist']}`}
                >
                  <svg
                    className={styles.detailIcon}
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
                  </svg>
                  <span>
                    <span className={styles.detailLabel}>{copy['music.artist']}</span>
                    <span className={styles.detailValue}>
                      {song.artist || copy['music.unknownArtist']}
                    </span>
                  </span>
                  <span aria-hidden="true">›</span>
                </a>
              )}
              {song.albumId && (
                <a
                  className={styles.detailLink}
                  href={musicHref(base, 'album', song.albumId, scope)}
                  aria-label={`${copy['music.viewAlbum']}: ${song.album || copy['music.unknownAlbum']}`}
                >
                  <svg
                    className={styles.detailIcon}
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <circle cx="12" cy="12" r="4" />
                  </svg>
                  <span>
                    <span className={styles.detailLabel}>{copy['music.album']}</span>
                    <span className={styles.detailValue}>
                      {song.album || copy['music.unknownAlbum']}
                    </span>
                  </span>
                  <span aria-hidden="true">›</span>
                </a>
              )}
              {!song.artistId && !song.albumId && (
                <p className={styles.noDetails}>{copy['music.noDetails']}</p>
              )}
            </div>
          )}
        </details>
        {onActivate && (
          <IconAction
            className={styles.play}
            label={playLabel(locale, song.title, current ? playbackStatus : 'paused')}
            onClick={() => {
              if (current && playbackStatus === 'playing') onPause?.();
              else if (current && playbackStatus !== 'ended' && playbackStatus !== 'error')
                onResume?.();
              else
                onActivate({
                  song,
                  songs,
                  source: window.location.pathname + window.location.search,
                });
            }}
          >
            {current && playbackStatus === 'playing' ? 'Ⅱ' : '▶'}
          </IconAction>
        )}
      </div>
    </li>
  );
}

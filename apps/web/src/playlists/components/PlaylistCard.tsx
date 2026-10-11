import type { PlaylistSummary } from '@musiclatte/contracts';
import { Artwork } from '../../design/components/Artwork';
import { playlistHref } from '../routes';
import styles from './PlaylistCard.module.css';

export function PlaylistCard({
  playlist,
  base,
  songCount,
  coverSrc,
  coverLoading = false,
}: {
  playlist: PlaylistSummary;
  base: string;
  songCount: string;
  coverSrc?: string;
  coverLoading?: boolean;
}) {
  return (
    <li className={styles.item} data-playlist-id={playlist.id}>
      <a className={styles.card} href={playlistHref(base, playlist.id)}>
        <span className={styles.artwork}>
          <Artwork alt="" loading={coverLoading} {...(coverSrc ? { src: coverSrc } : {})} />
        </span>
        <span className={styles.information}>
          <span className={styles.name}>{playlist.name}</span>
          <span className={styles.count}>{songCount}</span>
        </span>
        <span className={styles.disclosure} aria-hidden="true">
          ›
        </span>
      </a>
    </li>
  );
}

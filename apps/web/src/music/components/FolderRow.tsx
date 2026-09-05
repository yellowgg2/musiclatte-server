import styles from '../../pages/music/Music.module.css';
export function FolderRow({
  title,
  href,
  kind = 'folder',
}: {
  title: string;
  href: string;
  kind?: 'folder' | 'artist' | 'album';
}) {
  return (
    <li>
      <a className={styles.folderRow} href={href}>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          {kind === 'folder' ? (
            <path d="M3 7V5h7l2 2h9v12H3Z" />
          ) : kind === 'album' ? (
            <>
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="12" cy="12" r="4" />
            </>
          ) : (
            <>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
            </>
          )}
        </svg>
        <span>{title}</span>
        <span aria-hidden="true">›</span>
      </a>
    </li>
  );
}

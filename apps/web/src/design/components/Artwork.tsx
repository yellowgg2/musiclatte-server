import { useState } from 'react';
import styles from './Artwork.module.css';
export interface ArtworkProps {
  src?: string;
  alt: string;
  loading?: boolean;
}
export function Artwork(props: ArtworkProps) {
  return <ArtworkImage key={props.src ?? ''} {...props} />;
}
function ArtworkImage({ src, alt, loading = false }: ArtworkProps) {
  const [state, setState] = useState<'loading' | 'available' | 'failure'>('loading');
  const visibleState = loading ? 'loading' : !src ? 'missing' : state;
  return (
    <div
      className={styles.artwork}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={!alt || undefined}
      data-state={visibleState}
    >
      <svg viewBox="0 0 64 64" aria-hidden="true" className={styles.placeholder}>
        <path d="M27 43V20l22-4v23M27 25l22-4" />
        <ellipse cx="20" cy="44" rx="7" ry="5" />
        <ellipse cx="42" cy="40" rx="7" ry="5" />
      </svg>
      {!loading && src && state !== 'failure' && (
        <img
          src={src}
          alt=""
          onLoad={() => setState('available')}
          onError={() => setState('failure')}
          className={styles.image}
        />
      )}
    </div>
  );
}

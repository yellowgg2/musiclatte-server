import type { ReactNode } from 'react';
import styles from './StatusSurface.module.css';
export interface StatusSurfaceProps {
  state: 'loading' | 'empty' | 'error';
  title: string;
  description: string;
  action?: ReactNode;
}
export function StatusSurface({ state, title, description, action }: StatusSurfaceProps) {
  return (
    <div className={styles.surface} data-state={state}>
      <div
        role={state === 'error' ? 'alert' : 'status'}
        aria-atomic="true"
        className={styles.message}
      >
        <span className={styles.symbol} aria-hidden="true">
          {state === 'error' ? '!' : state === 'loading' ? '···' : '—'}
        </span>
        <div>
          <p className={styles.title}>{title}</p>
          <p className={styles.description}>{description}</p>
        </div>
      </div>
      {action && <div className={styles.recovery}>{action}</div>}
    </div>
  );
}

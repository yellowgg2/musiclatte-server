import type { ButtonHTMLAttributes } from 'react';
import styles from './Action.module.css';

export interface ActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'destructive';
  busy?: boolean;
}
export function Action({
  variant = 'primary',
  busy = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ActionProps) {
  return (
    <button
      {...props}
      type={type}
      className={[styles.action, styles[variant], className].filter(Boolean).join(' ')}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && (
        <span className={styles.busy} aria-hidden="true">
          ···
        </span>
      )}
      {children}
    </button>
  );
}

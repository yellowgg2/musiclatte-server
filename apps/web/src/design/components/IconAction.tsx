import type { ButtonHTMLAttributes } from 'react';
import styles from './IconAction.module.css';
export interface IconActionProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'aria-pressed'
> {
  label: string;
  pressed?: boolean;
}
export function IconAction({
  label,
  pressed,
  children,
  className,
  type = 'button',
  ...props
}: IconActionProps) {
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={[styles.action, className].filter(Boolean).join(' ')}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

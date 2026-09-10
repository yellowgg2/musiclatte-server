import type { HTMLAttributes } from 'react';
import styles from './SectionNav.module.css';

export interface SectionNavItem {
  label: string;
  href?: string;
  current?: boolean;
}

export interface SectionNavProps extends Omit<HTMLAttributes<HTMLElement>, 'aria-label'> {
  label: string;
  items: readonly SectionNavItem[];
}

export function SectionNav({ label, items, className, ...props }: SectionNavProps) {
  return (
    <nav
      {...props}
      className={[styles.navigation, className].filter(Boolean).join(' ')}
      aria-label={label}
    >
      {items.map((item, index) => {
        const content = <span>{item.label}</span>;
        const key = `${item.href ?? 'current'}:${item.label}:${index}`;
        if (item.href)
          return (
            <a key={key} href={item.href} aria-current={item.current ? 'page' : undefined}>
              {content}
            </a>
          );
        return (
          <span key={key} className={styles.item} aria-current={item.current ? 'page' : undefined}>
            {content}
          </span>
        );
      })}
    </nav>
  );
}

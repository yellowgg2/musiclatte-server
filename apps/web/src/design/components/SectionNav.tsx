import { Fragment, type HTMLAttributes } from 'react';
import styles from './SectionNav.module.css';

export interface SectionNavItem {
  label: string;
  href?: string;
  current?: boolean;
}

export interface SectionNavProps extends Omit<HTMLAttributes<HTMLElement>, 'aria-label'> {
  label: string;
  items: readonly SectionNavItem[];
  variant?: 'tabs' | 'breadcrumb';
}

export function SectionNav({
  label,
  items,
  variant = 'tabs',
  className,
  ...props
}: SectionNavProps) {
  return (
    <nav
      {...props}
      className={[styles.navigation, styles[variant], className].filter(Boolean).join(' ')}
      aria-label={label}
      data-variant={variant}
    >
      {items.map((item, index) => {
        const content = <span>{item.label}</span>;
        const key = `${item.href ?? 'current'}:${item.label}:${index}`;
        const separator =
          variant === 'breadcrumb' && index > 0 ? (
            <span className={styles.separator} aria-hidden="true">
              ›
            </span>
          ) : null;
        const itemContent = item.href ? (
          <a href={item.href} aria-current={item.current ? 'page' : undefined}>
            {content}
          </a>
        ) : (
          <span className={styles.item} aria-current={item.current ? 'page' : undefined}>
            {content}
          </span>
        );
        if (variant === 'breadcrumb')
          return (
            <span className={styles.crumb} key={key}>
              {separator}
              {itemContent}
            </span>
          );
        return <Fragment key={key}>{itemContent}</Fragment>;
      })}
    </nav>
  );
}

import { useState, type ComponentProps, type ReactNode } from 'react';
import { Action } from '../../design/components/Action';
import { messages, type Locale } from '../../i18n';
import styles from './SongView.module.css';

export type SongView = 'list' | 'tiles';

const storageKey = 'musiclatte.songView';

export function useSongView() {
  const [view, setViewState] = useState<SongView>(() =>
    localStorage.getItem(storageKey) === 'tiles' ? 'tiles' : 'list',
  );
  const setView = (next: SongView) => {
    setViewState(next);
    localStorage.setItem(storageKey, next);
  };
  return [view, setView] as const;
}

export function SongViewToggle({
  locale,
  view,
  onChange,
}: {
  locale: Locale;
  view: SongView;
  onChange: (view: SongView) => void;
}) {
  const copy = messages[locale];
  return (
    <div className={styles.toggle} role="group" aria-label={copy['songView.label']}>
      {(['list', 'tiles'] as const).map((next) => (
        <Action
          key={next}
          className={styles.action}
          variant="quiet"
          aria-pressed={view === next}
          onClick={() => onChange(next)}
        >
          {copy[`songView.${next}`]}
        </Action>
      ))}
    </div>
  );
}

export function SongViewHeading({
  locale,
  view,
  onChange,
  actions,
  children,
}: {
  locale: Locale;
  view: SongView;
  onChange: (view: SongView) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.heading}>
      <h2>{children}</h2>
      <div className={styles.tools} data-song-view-tools="true">
        {actions}
        <SongViewToggle locale={locale} view={view} onChange={onChange} />
      </div>
    </div>
  );
}

export function SongList({
  view,
  className,
  children,
  ...props
}: {
  view: SongView;
  className?: string | undefined;
  children: ReactNode;
} & Omit<ComponentProps<'ul'>, 'children' | 'className'>) {
  return (
    <ul
      {...props}
      className={[className, styles.list, view === 'tiles' ? styles.tiles : '']
        .filter(Boolean)
        .join(' ')}
      data-view={view}
    >
      {children}
    </ul>
  );
}

export function songLayout(view: SongView) {
  return view === 'tiles' ? 'tile' : 'list';
}

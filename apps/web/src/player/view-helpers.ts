import { messages, type Locale } from '../i18n';
import type { PlaybackStatus } from './state';

export function playLabel(locale: Locale, title: string, status: PlaybackStatus): string {
  const action = messages[locale][status === 'playing' ? 'player.pause' : 'player.play'];
  return locale === 'ko' ? `${title} ${action}` : `${action} ${title}`;
}

export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

import ko from './ko.json';
import en from './en.json';

export type Locale = 'ko' | 'en';
export type MessageKey = keyof typeof ko;
export const messages = { ko, en } satisfies Record<Locale, Record<MessageKey, string>>;

export function formatCount(count: number, locale: Locale): string {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid count');
  return new Intl.NumberFormat(locale).format(count);
}

export function formatDate(date: Date, locale: Locale, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(date);
}

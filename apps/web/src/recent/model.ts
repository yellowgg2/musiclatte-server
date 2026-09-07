import type { RecentDownloadFilter, RecentDownloadResponse } from '@musiclatte/contracts';
import { ApiError } from '../auth/client';

export function localDateRange(from: string, through: string): RecentDownloadFilter {
  function day(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Invalid date');
    const [year, month, date] = value.split('-').map(Number) as [number, number, number];
    const result = new Date(0);
    result.setFullYear(year, month - 1, date);
    result.setHours(0, 0, 0, 0);
    if (
      result.getFullYear() !== year ||
      result.getMonth() !== month - 1 ||
      result.getDate() !== date
    )
      throw new RangeError('Invalid date');
    return result;
  }
  const start = day(from);
  const end = day(through);
  if (start > end) throw new RangeError('Invalid range');
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function appendRecent(
  previous: RecentDownloadResponse,
  next: RecentDownloadResponse,
): RecentDownloadResponse {
  if (
    previous.asOf !== next.asOf ||
    previous.filter.from !== next.filter.from ||
    previous.filter.to !== next.filter.to
  )
    throw new ApiError('internal_error');
  const seen = new Set(previous.items.map((item) => item.eventId));
  return {
    ...next,
    items: [
      ...previous.items,
      ...next.items.filter((item) => {
        if (seen.has(item.eventId)) return false;
        seen.add(item.eventId);
        return true;
      }),
    ],
  };
}

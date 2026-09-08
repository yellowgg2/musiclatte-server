export interface ScanSettings {
  schemaVersion: 1;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: number | null;
  lastStartedAt: number | null;
  lastError: 'forbidden' | 'upstream_unavailable' | null;
}
export interface ScanSettingsRequest {
  enabled: boolean;
  intervalMinutes: number;
}
export function isScanSettings(value: unknown): value is ScanSettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const time = (x: unknown) =>
    x === null || (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0);
  return (
    Object.keys(v).length === 6 &&
    v.schemaVersion === 1 &&
    typeof v.enabled === 'boolean' &&
    typeof v.intervalMinutes === 'number' &&
    Number.isInteger(v.intervalMinutes) &&
    v.intervalMinutes >= 15 &&
    v.intervalMinutes <= 10080 &&
    time(v.nextRunAt) &&
    time(v.lastStartedAt) &&
    [null, 'forbidden', 'upstream_unavailable'].includes(v.lastError as null)
  );
}

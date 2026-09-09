import type { PlaybackPlan, PlaybackQuality } from '@musiclatte/contracts';
export interface QualityState {
  active: PlaybackPlan | null;
  resolving: boolean;
  reason: PlaybackPlan['reason'] | null;
  error: boolean;
  canRetryOriginal: boolean;
}
export const initialQualityState: QualityState = {
  active: null,
  resolving: false,
  reason: null,
  error: false,
  canRetryOriginal: false,
};
export interface QualitySelection {
  enabled: boolean;
  value: PlaybackQuality;
  scope: string;
}
/** Offset representations use whole seconds; all consumers see the same clamped position. */
export function offsetTarget(seconds: number, duration: number): number {
  return Math.min(Math.max(0, Math.floor(seconds)), Math.max(0, Math.ceil(duration) - 1));
}

const preferences = new Map<string, PlaybackQuality>();
export function qualityScope(
  apiOrigin: string,
  instanceId: string,
  username: string,
  browserOrigin: string,
): string {
  return JSON.stringify([
    new URL(apiOrigin || browserOrigin, browserOrigin).origin,
    instanceId,
    username,
  ]);
}
export async function qualityStorageKey(scope: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
  return (
    'musiclatte:quality:v1:' +
    Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
  );
}
export function memoryQuality(scope: string): PlaybackQuality | null {
  return preferences.get(scope) ?? null;
}
export function rememberQuality(scope: string, value: PlaybackQuality) {
  preferences.set(scope, value);
}
export function decodeQuality(value: unknown): PlaybackQuality | null {
  return value === 'original' || value === 'economy' ? value : null;
}

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

import type { ListeningEventInput } from '@musiclatte/contracts';
export interface ListeningSample {
  time: number;
  duration?: number;
  rate?: number;
  paused?: boolean;
  seeking?: boolean;
}
/** Passive interval accounting. All coordinates are absolute media seconds, including offset sources. */
export function createListeningTracker({
  emit,
  wallClock = Date.now,
  monotonic = () => performance.now(),
  eventId = () => crypto.randomUUID(),
}: {
  emit(event: Readonly<ListeningEventInput>): void;
  wallClock?: () => number;
  monotonic?: () => number;
  eventId?: () => string;
}) {
  let current: {
    songId: string;
    duration: number;
    startedAt: number | null;
    intervals: [number, number][];
    sent: boolean;
  } | null = null;
  let active = false;
  let resumeAfterSeek = false;
  let previous: number | null = null;
  let tick = 0;
  function anchor(sample: ListeningSample) {
    previous = Number.isFinite(sample.time) && sample.time >= 0 ? sample.time : null;
    tick = monotonic();
  }
  function sampleProgress(sample: ListeningSample) {
    if (!current) return;
    const now = monotonic();
    const rate = sample.rate ?? 1;
    const delta = previous === null ? 0 : sample.time - previous;
    if (
      active &&
      previous !== null &&
      Number.isFinite(sample.time) &&
      delta > 0 &&
      Number.isFinite(rate) &&
      rate > 0 &&
      now >= tick &&
      delta * 1000 <= (now - tick) * rate + 100
    ) {
      let start = previous;
      let end = sample.time;
      const merged: [number, number][] = [];
      for (const interval of current.intervals) {
        if (interval[1] < start) merged.push(interval);
        else if (interval[0] > end) {
          merged.push([start, end]);
          start = interval[0];
          end = interval[1];
        } else {
          start = Math.min(start, interval[0]);
          end = Math.max(end, interval[1]);
        }
      }
      merged.push([start, end]);
      current.intervals = merged;
    }
    anchor(sample);
    if (current.startedAt === null || current.sent) return;
    const union = current.intervals.reduce((sum, [start, end]) => sum + (end - start) * 1000, 0);
    const listenedMs = Math.floor(Math.min(union, wallClock() - current.startedAt));
    const threshold = current.duration > 0 ? Math.min(current.duration * 500, 240000) : 240000;
    if (listenedMs >= threshold && listenedMs > 0) {
      current.sent = true;
      emit(
        Object.freeze({
          eventId: eventId(),
          songId: current.songId,
          startedAt: new Date(current.startedAt).toISOString(),
          qualifiedAt: new Date(wallClock()).toISOString(),
          listenedMs,
        }),
      );
    }
  }
  return {
    start(songId: string, duration?: number) {
      current = {
        songId,
        duration: Number.isFinite(duration) && duration! > 0 ? duration! : 0,
        startedAt: null,
        intervals: [],
        sent: false,
      };
      active = false;
      resumeAfterSeek = false;
      previous = null;
    },
    clear() {
      current = null;
      active = false;
      previous = null;
      resumeAfterSeek = false;
    },
    observe(type: string, sample: ListeningSample) {
      if (!current) return;
      if (Number.isFinite(sample.duration) && sample.duration! > 0)
        current.duration = sample.duration!;
      if (type === 'playing') {
        if (current.startedAt === null) current.startedAt = wallClock();
        active = true;
        anchor(sample);
        return;
      }
      if (type === 'seeking') {
        resumeAfterSeek = resumeAfterSeek || active;
        active = false;
        anchor(sample);
        return;
      }
      if (type === 'seeked') {
        active = resumeAfterSeek && !sample.paused;
        resumeAfterSeek = false;
        anchor(sample);
        return;
      }
      if (type === 'timeupdate' || type === 'durationchange') {
        if (!sample.paused && !sample.seeking) sampleProgress(sample);
        else anchor(sample);
        return;
      }
      if (type === 'ratechange') {
        anchor(sample);
        return;
      }
      if (['pause', 'waiting', 'stalled', 'error', 'ended'].includes(type)) {
        sampleProgress(sample);
        active = false;
        anchor(sample);
        return;
      }
      if (type === 'loadstart' || type === 'emptied') {
        active = false;
        anchor(sample);
      }
    },
  };
}

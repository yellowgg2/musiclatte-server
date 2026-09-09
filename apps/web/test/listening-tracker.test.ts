import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
async function setup() {
  const path = resolve('apps/web/src/listening/tracker.ts');
  expect(existsSync(path), 'listening interval tracker is required').toBe(true);
  const { createListeningTracker } = await import(path);
  let now = 0;
  const events: unknown[] = [];
  let ids = 0;
  const tracker = createListeningTracker({
    emit: (event: unknown) => events.push(event),
    wallClock: () => Date.parse('2026-09-09T00:00:00Z') + now,
    monotonic: () => now,
    eventId: () => String(++ids).repeat(22),
  });
  return {
    tracker,
    events,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
/** Moving the cursor and pausing cannot substitute for actually played, distinct intervals. */
it('should reject seeks and union repeated intervals before qualifying', async () => {
  const c = await setup();
  c.tracker.start('tr-1', 120);
  c.tracker.observe('playing', { time: 0, rate: 1 });
  c.advance(10000);
  c.tracker.observe('timeupdate', { time: 10, rate: 1 });
  c.tracker.observe('seeking', { time: 10, rate: 1 });
  c.tracker.observe('seeked', { time: 60, rate: 1, paused: false });
  expect(c.events).toHaveLength(0);
  c.tracker.observe('pause', { time: 60, rate: 1 });
  c.advance(60000);
  c.tracker.observe('timeupdate', { time: 90, rate: 1 });
  expect(c.events).toHaveLength(0);
  c.tracker.observe('playing', { time: 0, rate: 1 });
  c.advance(10000);
  c.tracker.observe('timeupdate', { time: 10, rate: 1 });
  expect(c.events).toHaveLength(0);
  c.advance(50000);
  c.tracker.observe('timeupdate', { time: 60, rate: 1 });
  expect(c.events).toHaveLength(1);
  expect(c.events[0]).toMatchObject({ songId: 'tr-1', listenedMs: 60000 });
  c.advance(10000);
  c.tracker.observe('timeupdate', { time: 70, rate: 1 });
  expect(c.events).toHaveLength(1);
});
/** Monotonic elapsed supports delayed updates but excludes artificial currentTime jumps. */
it('should accept delayed continuous progress and create another event for a new occurrence', async () => {
  const c = await setup();
  c.tracker.start('tr-1', 120);
  c.tracker.observe('playing', { time: 0, rate: 1 });
  c.advance(10);
  c.tracker.observe('timeupdate', { time: 60, rate: 1 });
  expect(c.events).toHaveLength(0);
  c.tracker.start('tr-1', 120);
  c.tracker.observe('playing', { time: 0, rate: 1 });
  c.advance(60000);
  c.tracker.observe('timeupdate', { time: 60, rate: 1 });
  expect(c.events).toHaveLength(1);
  c.tracker.start('tr-1', 120);
  c.tracker.observe('playing', { time: 0, rate: 1 });
  c.advance(60000);
  c.tracker.observe('timeupdate', { time: 60, rate: 1 });
  expect(c.events).toHaveLength(2);
  expect(c.events[0]).not.toEqual(c.events[1]);
});
/** Buffering/source reload pauses sampling but keeps one occurrence and already heard intervals. */
it('should preserve intervals across pause buffering and offset source changes', async () => {
  const c = await setup();
  c.tracker.start('tr-1', 120);
  c.tracker.observe('playing', { time: 0 });
  c.advance(30000);
  c.tracker.observe('timeupdate', { time: 30 });
  c.tracker.observe('waiting', { time: 30 });
  c.advance(60000);
  c.tracker.observe('timeupdate', { time: 60 });
  expect(c.events).toHaveLength(0);
  c.tracker.observe('emptied', { time: 0 });
  c.tracker.observe('playing', { time: 30 });
  c.advance(30000);
  c.tracker.observe('timeupdate', { time: 60 });
  expect(c.events).toHaveLength(1);
});
/** Unknown duration and short tracks use the same qualification policy as the server. */
it('should handle unknown duration and short tracks without position shortcuts', async () => {
  const c = await setup();
  c.tracker.start('unknown');
  c.tracker.observe('playing', { time: 0 });
  c.advance(239000);
  c.tracker.observe('timeupdate', { time: 239 });
  expect(c.events).toHaveLength(0);
  c.advance(1000);
  c.tracker.observe('timeupdate', { time: 240 });
  expect(c.events).toHaveLength(1);
  c.tracker.start('short', 4);
  c.tracker.observe('playing', { time: 0 });
  c.advance(2000);
  c.tracker.observe('timeupdate', { time: 2 });
  expect(c.events).toHaveLength(2);
});

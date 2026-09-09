import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
/** The event wire DTO has exact fields and UTC timestamps, without private metadata. */
it('should strictly decode web listening events', async () => {
  const path = resolve('packages/contracts/src/listening.ts');
  expect(existsSync(path), 'listening contract is required').toBe(true);
  const { decodeListeningEvent } = await import(path);
  const event = {
    eventId: 'A'.repeat(22),
    listenedMs: 60000,
    songId: 'tr-1',
    startedAt: '2026-09-09T00:00:00.000Z',
    qualifiedAt: '2026-09-09T00:01:00.000Z',
  };
  expect(decodeListeningEvent(event)).toEqual(event);
  for (const bad of [
    { ...event, owner: 'other' },
    { ...event, source: 'native' },
    { ...event, songId: '' },
    { ...event, qualifiedAt: '2026-09-08T00:00:00Z' },
    { ...event, startedAt: 1 },
  ])
    expect(() => decodeListeningEvent(bad)).toThrow();
});

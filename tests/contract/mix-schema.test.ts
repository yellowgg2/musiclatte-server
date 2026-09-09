import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
async function makeSUT(): Promise<{ decodeMixInput(value: unknown): unknown }> {
  const path = resolve('packages/contracts/src/mixes.ts');
  expect(existsSync(path), 'strict saved mix contract must exist').toBe(true);
  return import(path);
}
/** Valid mix names normalize but exact genre tags retain their original bytes. */
it('should normalize names and default size while preserving genre', async () => {
  const sut = await makeSUT();
  expect(sut.decodeMixInput({ name: '  Mix 🎵 ', conditions: { genre: ' Jazz ' } })).toEqual({
    name: 'Mix 🎵',
    conditions: { genre: ' Jazz ', size: 50 },
  });
});
/** Unknown fields, ambiguous selections, invalid years, names and limits are rejected. */
it.each([
  { name: '', conditions: {} },
  { name: 'x\n', conditions: {} },
  { name: 'x'.repeat(101), conditions: {} },
  { name: 'x', owner: 'other', conditions: {} },
  { name: 'x', conditions: { genre: ['Jazz', 'Pop'] } },
  { name: 'x', conditions: { genre: '  ' } },
  { name: 'x', conditions: { size: 0 } },
  { name: 'x', conditions: { size: 501 } },
  { name: 'x', conditions: { fromYear: 2001, toYear: 2000 } },
  { name: 'x', conditions: { fromYear: 1.5 } },
  { name: 'x', conditions: { toYear: 10000 } },
  { name: 'x', conditions: { path: '/library' } },
])('should reject invalid mix %j', async (input) => {
  const sut = await makeSUT();
  expect(() => sut.decodeMixInput(input)).toThrow();
});
/** JSON duplicate keys must be rejected before ordinary parsing loses their ambiguity. */
it('should reject duplicate and escaped duplicate condition fields', async () => {
  const module = await import(resolve('packages/contracts/src/mixes.ts'));
  expect(module.parseMixJson).toBeTypeOf('function');
  expect(() => module.parseMixJson('{"name":"Mix","conditions":{"size":2,"size":3}}')).toThrow();
  expect(() =>
    module.parseMixJson('{"name":"Mix","conditions":{"genre":"Jazz","gen\\u0072e":"Pop"}}'),
  ).toThrow();
  expect(module.parseMixJson('{"name":"Mix","conditions":{"genre":"Jazz"}}')).toEqual({
    name: 'Mix',
    conditions: { genre: 'Jazz' },
  });
});

import { expect, it } from 'vitest';
import { createExactPathLookup } from '../src/subsonic/exact-path-lookup.js';

it('resolves an existing POSIX path whose directory ends in whitespace', async () => {
  const lookup = createExactPathLookup(
    {
      indexes: async () => ({
        index: [{ name: 'L', artist: [{ id: 'root', name: 'library', album: [] }] }],
      }),
      registrationDirectory: async (id) => {
        if (id === 'root')
          return {
            id,
            child: [{ id: 'legacy', name: 'Legacy Artist ', isDir: true }],
          };
        return {
          id,
          child: [
            {
              id: 'song',
              name: 'source.mp3',
              isDir: false,
              path: './library//Legacy Artist /source.mp3',
            },
          ],
        };
      },
    },
    { signal: new AbortController().signal, assertOwned() {} },
  );

  await expect(
    lookup(
      { relativeRoot: 'library', musicFolderId: 'music' },
      'library/Legacy Artist /source.mp3',
    ),
  ).resolves.toBe('song');
});

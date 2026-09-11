import type { DatabaseSync } from 'node:sqlite';
import type { MusicEntry } from '@musiclatte/contracts';

export function createOrganizationCandidates(options: {
  database: DatabaseSync;
  libraries: readonly { id: string; musicFolderId: string }[];
  search(title: string, musicFolderId: string, limit: number): Promise<readonly MusicEntry[]>;
  resolve(trackId: string): Promise<{ libraryId: string; fileRevision: string }>;
}) {
  return {
    async list(input: {
      title: string;
      libraryId?: string;
      limit: number;
      allowedLibraryIds: readonly string[];
    }) {
      const libraries = options.libraries.filter(
        (library) =>
          input.allowedLibraryIds.includes(library.id) &&
          (!input.libraryId || library.id === input.libraryId),
      );
      const candidates = [];
      const seen = new Set<string>();
      for (const library of libraries) {
        const songs = await options.search(input.title, library.musicFolderId, input.limit);
        for (const song of songs) {
          if (song.isDir || seen.has(song.id)) continue;
          const resolved = await options.resolve(song.id);
          if (resolved.libraryId !== library.id) continue;
          const source = options.database
            .prepare(
              "SELECT source_id FROM import_items WHERE media_link_id=(SELECT id FROM media_links WHERE library_id=? AND gonic_song_id=?) AND stage IN ('ready','duplicate') ORDER BY stage_changed_at DESC,id DESC LIMIT 1",
            )
            .get(library.id, song.id);
          candidates.push({
            trackId: song.id,
            libraryId: library.id,
            title: song.title,
            artist: song.artist ? [song.artist] : [],
            album: song.album ?? null,
            currentRevision: resolved.fileRevision,
            importSourceId: source ? String(source.source_id) : null,
          });
          seen.add(song.id);
          if (candidates.length === input.limit)
            return { schemaVersion: 1 as const, candidates, total: candidates.length };
        }
      }
      return { schemaVersion: 1 as const, candidates, total: candidates.length };
    },
  };
}

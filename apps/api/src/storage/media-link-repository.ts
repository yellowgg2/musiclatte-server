import { posix } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { ManagementDatabase } from './database.js';

export interface MediaLink {
  id: string;
  libraryId: string;
  relativeFileKey: string;
  gonicSongId: string;
  revision: number;
  availability: 'available' | 'missing' | 'unavailable';
  createdAt: number;
  validatedAt: number | null;
}

const availability = new Set<MediaLink['availability']>(['available', 'missing', 'unavailable']);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const time = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validKey = (key: string) =>
  text(key) &&
  !posix.isAbsolute(key) &&
  posix.normalize(key) === key &&
  !key.split('/').some((part) => !part || part === '.' || part === '..') &&
  !key.includes('\\') &&
  !/^[A-Za-z]:/.test(key) &&
  !key.includes('\0');

function decode(row: Record<string, unknown> | undefined): MediaLink | null {
  if (!row) return null;
  const link = {
    id: row.id,
    libraryId: row.library_id,
    relativeFileKey: row.relative_file_key,
    gonicSongId: row.gonic_song_id,
    revision: row.revision,
    availability: row.availability,
    createdAt: row.created_at,
    validatedAt: row.validated_at,
  };
  if (
    !text(link.id) ||
    !text(link.libraryId) ||
    typeof link.relativeFileKey !== 'string' ||
    !validKey(link.relativeFileKey) ||
    !text(link.gonicSongId) ||
    !time(link.revision) ||
    link.revision < 1 ||
    typeof link.availability !== 'string' ||
    !availability.has(link.availability as MediaLink['availability']) ||
    !time(link.createdAt) ||
    !(link.validatedAt === null || time(link.validatedAt))
  )
    throw new Error('Storage unavailable');
  return link as MediaLink;
}

export function validateMediaLinks(database: DatabaseSync): void {
  for (const row of database.prepare('SELECT * FROM media_links').iterate()) decode(row);
}

export function createMediaLinkRepository(options: {
  database: ManagementDatabase;
  clock: () => number;
}) {
  const { database, clock } = options;
  const db = database.connection;
  const now = () => {
    const value = clock();
    if (!time(value)) throw new Error('Invalid media link');
    return value;
  };
  const get = (id: string) => decode(db.prepare('SELECT * FROM media_links WHERE id=?').get(id));
  return {
    create(input: { id: string; libraryId: string; relativeFileKey: string; gonicSongId: string }) {
      if (
        !text(input.id) ||
        !text(input.libraryId) ||
        !validKey(input.relativeFileKey) ||
        !text(input.gonicSongId)
      )
        throw new Error('Invalid media link');
      const createdAt = now();
      try {
        db.prepare(
          "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at,validated_at) VALUES(?,?,?,?,1,'available',?,?)",
        ).run(
          input.id,
          input.libraryId,
          input.relativeFileKey,
          input.gonicSongId,
          createdAt,
          createdAt,
        );
      } catch {
        throw new Error('Media link conflict');
      }
      return get(input.id)!;
    },
    get,
    findByFileKey(libraryId: string, relativeFileKey: string) {
      if (!text(libraryId) || !validKey(relativeFileKey)) throw new Error('Invalid media link');
      return decode(
        db
          .prepare('SELECT * FROM media_links WHERE library_id=? AND relative_file_key=?')
          .get(libraryId, relativeFileKey),
      );
    },
    setAvailability(id: string, value: MediaLink['availability']) {
      if (!text(id) || !availability.has(value)) throw new Error('Invalid media link');
      const validatedAt = now();
      const result = db
        .prepare(
          'UPDATE media_links SET availability=?,revision=revision+1,validated_at=? WHERE id=?',
        )
        .run(value, validatedAt, id);
      if (result.changes !== 1) throw new Error('Media link not found');
      return get(id)!;
    },
  };
}

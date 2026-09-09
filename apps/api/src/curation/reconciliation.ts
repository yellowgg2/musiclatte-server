import { createHash, randomUUID } from 'node:crypto';
import { curationFields, type CurationField } from '@musiclatte/contracts';
import type { ManagementDatabase } from '../storage/database.js';
import type { CurationObservation, CurationRepository } from '../storage/curation-repository.js';
import type { SubsonicClient } from '../subsonic/client.js';
import { createMetadataRevision } from '../metadata/revision.js';
import { requiredFingerprint } from './policy.js';
import type { createMetadataHelper, MetadataTagSnapshot } from '../metadata/helper-client.js';
import type { createMetadataFileAccess } from '../metadata/file-access.js';
import { createMediaPublicationLedger, type createMediaFence } from '../metadata/media-fence.js';
import { createMediaLinkRepository } from '../storage/media-link-repository.js';
import { validateRelativeKey } from '../imports/policy.js';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function curationSnapshot(snapshot: MetadataTagSnapshot) {
  const title = snapshot.values.title?.normalize('NFC').trim() || null;
  const artist = snapshot.values.artist
    .map((value) => value.normalize('NFC').trim())
    .filter(Boolean);
  const values = {
    title,
    artist,
    album: snapshot.values.album?.trim() || null,
    cover: snapshot.coverFrames.map((frame) => frame.digest),
    lyrics: snapshot.lyricsFrames.filter((frame) => frame.text.trim()),
  };
  const fields = {
    title: title !== null,
    artist: artist.length > 0,
    album: values.album !== null,
    cover: values.cover.length > 0,
    lyrics: values.lyrics.length > 0,
  };
  const fingerprints = Object.fromEntries(
    curationFields.map((field) => [field, hash(values[field])]),
  ) as Record<CurationField, string>;
  const audio = snapshot.audio;
  return {
    title,
    artist,
    fields,
    fingerprints,
    requiredFingerprint: requiredFingerprint(title, artist),
    audioIdentity: hash([
      audio.codec,
      audio.packetHash,
      audio.packetCount,
      audio.sampleRate,
      audio.channels,
    ]),
  };
}
export function reconcileVerifiedSnapshot(
  repository: CurationRepository,
  trackRef: string,
  snapshot: MetadataTagSnapshot,
  revision: string,
  changedFields: readonly CurationField[],
) {
  const projected = curationSnapshot(snapshot);
  const observation: CurationObservation = {
    ...projected,
    revision,
    policyVersion: 'required-v1',
    trusted: true,
    changedFields,
  };
  return repository.observe(trackRef, observation);
}
export interface CurationReconcilerOptions {
  database: ManagementDatabase;
  repository: CurationRepository;
  clock(): number;
  signingKey: Uint8Array;
  libraries: readonly { id: string; relativeRoot: string }[];
  source: Pick<SubsonicClient, 'recentSong'>;
  helper: Pick<ReturnType<typeof createMetadataHelper>, 'read'>;
  fileAccess: ReturnType<typeof createMetadataFileAccess>;
  fence: ReturnType<typeof createMediaFence>;
}
/** Worker-only adapter. Reuses P4 path policy, descriptor inspection, packet identity and revision HMAC. */
export function createCurationReconciler(options: CurationReconcilerOptions) {
  const { database, repository, source, helper, fileAccess, fence } = options;
  const db = database.connection;
  const revisions = createMetadataRevision(options.signingKey);
  const links = createMediaLinkRepository(options);
  const publications = createMediaPublicationLedger(database, options.clock);
  return {
    async reconcile(trackRef: string, signal?: AbortSignal): Promise<void> {
      const row = repository.rowFor(trackRef);
      if (!row) throw new Error('not_found');
      try {
        const library = options.libraries.find((library) => library.id === row.library_id);
        if (!library) throw new Error('inventory_pending');
        const current = await source.recentSong(String(row.track_id), signal ? { signal } : {});
        if (current.song.id !== row.track_id || current.song.isDir || !current.path)
          throw new Error('inventory_pending');
        const key = validateRelativeKey(current.path);
        if (
          !key.startsWith(library.relativeRoot + '/') ||
          options.libraries.filter((entry) => key.startsWith(entry.relativeRoot + '/')).length !== 1
        )
          throw new Error('inventory_pending');
        if (!/\.mp3$/i.test(key)) {
          db.prepare(
            "UPDATE curation_tracks SET format='unsupported',validation=CASE WHEN revision IS NULL THEN 'unknown' ELSE 'stale' END WHERE id=?",
          ).run(trackRef);
          throw new Error('unsupported_format');
        }
        const fileIdentity = revisions.fileIdentity({
          libraryId: library.id,
          relativeFileKey: key,
        });
        await fence.withMediaFence(fileIdentity, 'verify', async (held) => {
          const publication = publications.begin(fileIdentity, held.nonce);
          if (
            db
              .prepare(
                "SELECT 1 FROM metadata_items WHERE file_identity=? AND stage IN ('preparing','backed_up','prepared','file_saved','reflecting','recovery_required') LIMIT 1",
              )
              .get(fileIdentity)
          ) {
            repository.transition(trackRef, { type: 'pending' });
            throw new Error('inventory_pending');
          }
          const before = await fileAccess.inspect(key, signal);
          const snapshot = await helper.read({ key, ...(signal ? { signal } : {}) });
          const after = await fileAccess.inspect(key, signal);
          const upstream = await source.recentSong(String(row.track_id), signal ? { signal } : {});
          if (
            before.digest !== snapshot.fullDigest ||
            before.digest !== after.digest ||
            before.inode !== after.inode ||
            before.ctimeNs !== after.ctimeNs ||
            upstream.song.id !== row.track_id ||
            upstream.path !== key
          )
            throw new Error('revision_conflict');
          const oldLink = links.findBySongId(library.id, String(row.track_id));
          if (oldLink && oldLink.relativeFileKey !== key) {
            // A moved path requires the old path to be absent; never join two files by title or audio.
            let absent = false;
            try {
              await fileAccess.inspect(oldLink.relativeFileKey, signal);
            } catch (error) {
              absent = error instanceof Error && error.message === 'file_unavailable';
            }
            if (!absent || links.findByFileKey(library.id, key))
              throw new Error('revision_conflict');
          }
          signal?.throwIfAborted();
          await held.validate();
          database.transaction(() => {
            held.assertHeld();
            publications.validate(publication);
            let byFile = links.findByFileKey(library.id, key);
            const fresh = repository.rowFor(trackRef)!;
            if (fresh.track_id !== row.track_id || fresh.library_id !== row.library_id)
              throw new Error('revision_conflict');
            if (oldLink && oldLink.relativeFileKey !== key) {
              db.prepare(
                'UPDATE media_links SET relative_file_key=?,revision=revision+1,validated_at=? WHERE id=? AND revision=?',
              ).run(key, options.clock(), oldLink.id, oldLink.revision);
              repository.transition(trackRef, { type: 'reopened' });
            }
            if (byFile?.gonicSongId && byFile.gonicSongId !== row.track_id) {
              const run = db
                .prepare('SELECT generation FROM curation_inventory_runs WHERE library_id=?')
                .get(library.id);
              const oldStillDiscovered =
                !run ||
                db
                  .prepare(
                    "SELECT 1 FROM curation_inventory_queue WHERE library_id=? AND generation=? AND (kind='directory' AND status!='done' OR kind='track' AND opaque_id=?) LIMIT 1",
                  )
                  .get(library.id, run.generation!, byFile.gonicSongId);
              if (oldStillDiscovered) throw new Error('revision_conflict');
              // A completed directory traversal plus exact current path establishes a new binding.
              db.prepare(
                "UPDATE curation_tracks SET tombstoned=1,file_identity=NULL,validation='stale',base_status=CASE base_status WHEN 'completed' THEN 'needs_review' ELSE base_status END WHERE library_id=? AND track_id=?",
              ).run(library.id, byFile.gonicSongId);
              db.prepare(
                'UPDATE media_links SET gonic_song_id=?,revision=revision+1,validated_at=? WHERE id=? AND revision=?',
              ).run(row.track_id!, options.clock(), byFile.id, byFile.revision);
              db.prepare(
                "INSERT INTO curation_source_events(library_id,media_link_id,track_id,kind,source_key,created_at) VALUES(?,?,?,'verified_rebinding',?,?)",
              ).run(
                library.id,
                byFile.id,
                row.track_id!,
                `rebind:${byFile.id}:${byFile.revision + 1}`,
                options.clock(),
              );
            }
            byFile = links.bindVerified({
              id: randomUUID(),
              libraryId: library.id,
              relativeFileKey: key,
              gonicSongId: String(row.track_id),
            });
            if (fresh.file_identity && fresh.file_identity !== fileIdentity)
              repository.transition(trackRef, { type: 'reopened' });
            db.prepare(
              "UPDATE curation_tracks SET media_link_id=?,file_identity=?,binding_revision=?,format='mp3',tombstoned=0 WHERE id=?",
            ).run(byFile.id, fileIdentity, byFile.revision, trackRef);
            const projection = curationSnapshot(snapshot);
            const changed = curationFields.filter(
              (field) =>
                db
                  .prepare(
                    'SELECT value_fingerprint FROM curation_field_states WHERE track_ref=? AND field=?',
                  )
                  .get(trackRef, field)?.value_fingerprint !== projection.fingerprints[field],
            );
            const changes = db
              .prepare(
                "SELECT e.sequence,i.changed_fields_json FROM curation_source_events e JOIN metadata_items i ON e.source_key IN ('metadata:'||i.id||':file_saved','metadata:'||i.id||':succeeded') WHERE e.media_link_id=? AND e.sequence>? AND i.result_digest=?",
              )
              .all(byFile.id, fresh.source_sequence ?? 0, snapshot.fullDigest);
            for (const change of changes)
              for (const field of JSON.parse(String(change.changed_fields_json)) as string[])
                if (
                  curationFields.includes(field as CurationField) &&
                  !changed.includes(field as CurationField)
                )
                  changed.push(field as CurationField);
            db.prepare('UPDATE curation_tracks SET source_sequence=? WHERE id=?').run(
              Number(
                db
                  .prepare(
                    'SELECT COALESCE(max(sequence),0) AS n FROM curation_source_events WHERE media_link_id=?',
                  )
                  .get(byFile.id)!.n,
              ),
              trackRef,
            );
            reconcileVerifiedSnapshot(
              repository,
              trackRef,
              snapshot,
              revisions.fileRevision({
                libraryId: library.id,
                relativeFileKey: key,
                digest: snapshot.fullDigest,
              }),
              changed,
            );
            for (const field of curationFields)
              db.prepare(
                'UPDATE curation_field_states SET value_fingerprint=? WHERE track_ref=? AND field=?',
              ).run(projection.fingerprints[field], trackRef, field);
            publications.recordMediaPublication(publication, snapshot.fullDigest);
            publications.reconcile(publication);
          });
        });
      } catch (error) {
        if (
          repository.rowFor(trackRef)?.revision &&
          !(error instanceof Error && error.message === 'inventory_pending')
        )
          repository.transition(trackRef, { type: 'stale' });
        throw error;
      }
    },
  };
}

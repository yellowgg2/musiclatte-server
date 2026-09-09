import type { DatabaseSync } from 'node:sqlite';
import type { MetadataPatch } from '@musiclatte/contracts';
import type { ManagementDatabase } from '../storage/database.js';
import type { CredentialVault } from '../security/credential-vault.js';
import type { MetadataWork } from '../metadata/worker.js';
import type { verifyAccessTokenPrincipal } from './metadata-principal.js';

interface GrantIntent {
  id: string;
  identityKey: string;
  libraryId: string;
  mediaLinkId: string;
  fileIdentity: string;
  bindingRevision: number;
  trackId: string;
  expectedRevision: string;
  expectedDigest: string;
  policyRevision: number;
  patch: MetadataPatch;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
function grantContext(
  db: DatabaseSync,
  tokenId: string,
  intent: GrantIntent,
  epoch: string,
): { context: string; username: string; instanceId: string } {
  const row = db
    .prepare(
      'SELECT owner_username,instance_id,policy_revision,scopes_json,library_ids_json FROM access_tokens WHERE id=?',
    )
    .get(tokenId);
  if (
    !row ||
    typeof row.owner_username !== 'string' ||
    typeof row.instance_id !== 'string' ||
    row.policy_revision !== intent.policyRevision
  )
    throw new Error('permission_changed');
  return {
    username: row.owner_username,
    instanceId: row.instance_id,
    context: JSON.stringify([
      'musiclatte-accepted-metadata',
      1,
      epoch,
      tokenId,
      row.instance_id,
      row.owner_username,
      row.scopes_json,
      row.library_ids_json,
      canonical(intent),
    ]),
  };
}
function storedIntent(row: Record<string, unknown>): GrantIntent {
  return {
    id: String(row.id),
    identityKey: String(row.identity_key),
    libraryId: String(row.library_id),
    mediaLinkId: String(row.media_link_id),
    fileIdentity: String(row.file_identity),
    bindingRevision: Number(row.binding_revision),
    trackId: String(row.original_track_id),
    expectedRevision: String(row.expected_revision),
    expectedDigest: String(row.expected_digest),
    policyRevision: Number(row.policy_revision),
    patch: JSON.parse(String(row.patch_json)) as MetadataPatch,
  };
}
export function validateMetadataJobGrants(db: DatabaseSync, vault: CredentialVault): void {
  const epoch = db
    .prepare('SELECT credential_epoch FROM automation_state WHERE singleton=1')
    .get()?.credential_epoch;
  for (const row of db
    .prepare(
      'SELECT i.*,j.identity_key,j.library_id FROM metadata_items i JOIN metadata_jobs j ON j.id=i.job_id WHERE i.encrypted_job_grant IS NOT NULL',
    )
    .iterate()) {
    if (
      typeof row.actor_token_id !== 'string' ||
      typeof row.grant_epoch !== 'string' ||
      row.grant_epoch !== epoch
    )
      throw new Error('Storage unavailable');
    const binding = grantContext(db, row.actor_token_id, storedIntent(row), row.grant_epoch);
    if (vault.open(String(row.encrypted_job_grant), binding.context).username !== binding.username)
      throw new Error('Storage unavailable');
  }
}
/** Grants authorize only an already accepted immutable file intent, never a public request. */
export function createMetadataJobAuthorizer(options: {
  database: ManagementDatabase;
  vault: CredentialVault;
}) {
  const db = options.database.connection;
  const epoch = () => {
    const value = db
      .prepare('SELECT credential_epoch FROM automation_state WHERE singleton=1')
      .get()?.credential_epoch;
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
      throw new Error('permission_changed');
    return value;
  };
  return {
    createGrant(
      principal: Awaited<ReturnType<typeof verifyAccessTokenPrincipal>>,
      intent: GrantIntent,
    ) {
      const current = principal.checkCurrent();
      if (intent.identityKey !== principal.actorIdentityKey) throw new Error('permission_changed');
      if (
        !current.accessToken.scopes.includes('metadata:write') ||
        (intent.patch.lyrics && !current.accessToken.scopes.includes('lyrics:write')) ||
        !principal.allowedLibraries.includes(intent.libraryId) ||
        !current.accessToken.libraryIds.includes(intent.libraryId) ||
        current.policyRevision !== intent.policyRevision
      )
        throw new Error('permission_changed');
      const grantEpoch = epoch();
      const binding = grantContext(db, current.accessToken.id, intent, grantEpoch);
      return {
        actorSessionId: null,
        actorTokenId: current.accessToken.id,
        encryptedJobGrant: options.vault.seal(current.proof, binding.context),
        grantEpoch,
      };
    },
    authorizeAcceptedWork(work: MetadataWork) {
      try {
        const row = db
          .prepare(
            'SELECT i.*,j.identity_key,j.library_id FROM metadata_items i JOIN metadata_jobs j ON j.id=i.job_id WHERE i.id=?',
          )
          .get(work.itemId);
        if (
          !row ||
          !work.actorTokenId ||
          row.actor_token_id !== work.actorTokenId ||
          !row.encrypted_job_grant ||
          row.grant_epoch !== epoch()
        )
          throw new Error();
        const intent: GrantIntent = {
          id: work.itemId,
          identityKey: work.identityKey,
          libraryId: work.libraryId,
          mediaLinkId: work.mediaLinkId,
          fileIdentity: work.fileIdentity,
          bindingRevision: work.bindingRevision,
          trackId: work.originalTrackId,
          expectedRevision: work.expectedRevision,
          expectedDigest: work.expectedDigest,
          policyRevision: work.policyRevision,
          patch: work.patch,
        };
        if (JSON.stringify(canonical(intent)) !== JSON.stringify(canonical(storedIntent(row))))
          throw new Error();
        const binding = grantContext(db, work.actorTokenId, intent, String(row.grant_epoch));
        const proof = options.vault.open(String(row.encrypted_job_grant), binding.context);
        if (
          proof.username !== binding.username ||
          db.prepare('SELECT policy_revision FROM instance WHERE singleton=1').get()
            ?.policy_revision !== work.policyRevision
        )
          throw new Error();
        return {
          username: binding.username,
          instanceId: binding.instanceId,
          policyRevision: work.policyRevision,
          proof,
        };
      } catch {
        throw new Error('permission_changed');
      }
    },
  };
}

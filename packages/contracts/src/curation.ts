export const curationFields = ['title', 'artist', 'album', 'cover', 'lyrics'] as const;
export type CurationField = (typeof curationFields)[number];
export type OptionalCurationField = 'album' | 'cover' | 'lyrics';
export type CurationStatus = 'unreviewed' | 'in_progress' | 'needs_review' | 'completed';
export type ClaimPurpose = 'required_review' | 'optional_enrichment';
export type FieldStatus = 'unknown' | 'missing' | 'present' | 'unavailable' | 'not_applicable';
export interface FieldState {
  status: FieldStatus;
  evidenceRevision: string | null;
  lastAttemptAt: number | null;
  lastUpdatedAt: number | null;
  reason: string | null;
  sourceNotes: string | null;
  actorRef: string | null;
}
export interface CompletionReceipt {
  id: string;
  trackId: string;
  completedBy: {
    username: string;
    credentialKind: 'session' | 'access_token';
    tokenId: string | null;
    clientLabel: string | null;
  };
  completedAt: number;
  verifiedRevision: string;
  policyVersion: string;
  sourceNotes: string | null;
}
export interface CurationTrack {
  trackId: string;
  libraryId: string;
  format: 'mp3' | 'unsupported';
  title: string | null;
  artist: string[];
  fileRevision: string | null;
  curationStatus: CurationStatus;
  fieldStates: Record<CurationField, FieldState>;
  lyricsState: FieldStatus;
  validation: 'unknown' | 'verified' | 'pending' | 'stale';
  lastVerifiedAt: number | null;
  receipt: CompletionReceipt | null;
}
export interface CurationPolicy {
  policyVersion: string;
  requiredFields: CurationField[];
  optionalFields: OptionalCurationField[];
  supportedFieldsByFormat: { mp3: CurationField[]; unsupported: CurationField[] };
  allowedAttemptStatusesByField: Record<
    OptionalCurationField,
    ('unavailable' | 'not_applicable')[]
  >;
  claimLeaseMs: number;
  maxTargets: number;
  snapshotMaxAgeMs: number;
}
export function curationRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid curation payload');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    throw new Error('Invalid curation payload');
  return row;
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096;
}
function time(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function nullableText(value: unknown): value is string | null {
  return value === null || text(value);
}
export function decodeFieldState(value: unknown): FieldState {
  const row = curationRecord(value, [
    'status',
    'evidenceRevision',
    'lastAttemptAt',
    'lastUpdatedAt',
    'reason',
    'sourceNotes',
    'actorRef',
  ]);
  if (
    !['unknown', 'missing', 'present', 'unavailable', 'not_applicable'].includes(
      String(row.status),
    ) ||
    !nullableText(row.evidenceRevision) ||
    !(row.lastAttemptAt === null || time(row.lastAttemptAt)) ||
    !(row.lastUpdatedAt === null || time(row.lastUpdatedAt)) ||
    !nullableText(row.reason) ||
    !nullableText(row.sourceNotes) ||
    !nullableText(row.actorRef) ||
    (row.status !== 'unknown' && row.evidenceRevision === null) ||
    (['unavailable', 'not_applicable'].includes(String(row.status)) &&
      (!text(row.reason) || !time(row.lastAttemptAt) || !text(row.actorRef)))
  )
    throw new Error('Invalid curation field');
  return row as unknown as FieldState;
}
export function decodeCompletionReceipt(value: unknown): CompletionReceipt {
  const row = curationRecord(value, [
    'id',
    'trackId',
    'completedBy',
    'completedAt',
    'verifiedRevision',
    'policyVersion',
    'sourceNotes',
  ]);
  const actor = curationRecord(row.completedBy, [
    'username',
    'credentialKind',
    'tokenId',
    'clientLabel',
  ]);
  if (
    !text(row.id) ||
    !text(row.trackId) ||
    !time(row.completedAt) ||
    !text(row.verifiedRevision) ||
    !text(row.policyVersion) ||
    !nullableText(row.sourceNotes) ||
    !text(actor.username) ||
    !['session', 'access_token'].includes(String(actor.credentialKind)) ||
    !nullableText(actor.tokenId) ||
    !nullableText(actor.clientLabel) ||
    (actor.credentialKind === 'access_token') !== (actor.tokenId !== null)
  )
    throw new Error('Invalid completion receipt');
  return row as unknown as CompletionReceipt;
}
export function decodeCurationTrack(value: unknown): CurationTrack {
  const row = curationRecord(value, [
    'trackId',
    'libraryId',
    'format',
    'title',
    'artist',
    'fileRevision',
    'curationStatus',
    'fieldStates',
    'lyricsState',
    'validation',
    'lastVerifiedAt',
    'receipt',
  ]);
  const fields = curationRecord(row.fieldStates, curationFields);
  curationFields.forEach((field) => decodeFieldState(fields[field]));
  if (
    !text(row.trackId) ||
    !text(row.libraryId) ||
    !['mp3', 'unsupported'].includes(String(row.format)) ||
    !nullableText(row.title) ||
    !Array.isArray(row.artist) ||
    !row.artist.every(text) ||
    !nullableText(row.fileRevision) ||
    !['unreviewed', 'in_progress', 'needs_review', 'completed'].includes(
      String(row.curationStatus),
    ) ||
    !['unknown', 'verified', 'pending', 'stale'].includes(String(row.validation)) ||
    row.lyricsState !== (fields.lyrics as FieldState).status ||
    !(row.lastVerifiedAt === null || time(row.lastVerifiedAt))
  )
    throw new Error('Invalid curation track');
  if (row.receipt !== null) decodeCompletionReceipt(row.receipt);
  if (row.curationStatus === 'completed' && row.receipt === null)
    throw new Error('Invalid curation track');
  return row as unknown as CurationTrack;
}
export function decodeCurationPolicy(value: unknown): CurationPolicy {
  const row = curationRecord(value, [
    'policyVersion',
    'requiredFields',
    'optionalFields',
    'supportedFieldsByFormat',
    'allowedAttemptStatusesByField',
    'claimLeaseMs',
    'maxTargets',
    'snapshotMaxAgeMs',
  ]);
  const supported = curationRecord(row.supportedFieldsByFormat, ['mp3', 'unsupported']);
  const attempts = curationRecord(row.allowedAttemptStatusesByField, ['album', 'cover', 'lyrics']);
  const same = (a: unknown, b: readonly string[]) => JSON.stringify(a) === JSON.stringify(b);
  if (
    row.policyVersion !== 'required-v1' ||
    !same(row.requiredFields, ['title', 'artist']) ||
    !same(row.optionalFields, ['album', 'cover', 'lyrics']) ||
    !same(supported.mp3, curationFields) ||
    !same(supported.unsupported, []) ||
    Object.values(attempts).some((v) => !same(v, ['unavailable', 'not_applicable'])) ||
    !time(row.claimLeaseMs) ||
    row.claimLeaseMs < 1 ||
    !time(row.snapshotMaxAgeMs) ||
    row.snapshotMaxAgeMs < 1 ||
    !time(row.maxTargets) ||
    row.maxTargets < 1 ||
    row.maxTargets > 100
  )
    throw new Error('Invalid curation policy');
  return row as unknown as CurationPolicy;
}
export interface CurationCoverage {
  libraryId: string;
  status: 'discovering' | 'partial' | 'ready' | 'stale' | 'error';
  discoveredCount: number;
  verifiedCount: number;
  unknownCount: number;
  lastDiscoveryAt: number | null;
  lastReconciledAt: number | null;
  lastErrorCode: string | null;
}
export interface CurationList {
  schemaVersion: 1;
  snapshotId: string;
  asOf: number;
  expiresAt: number;
  total: number;
  nextCursor: string | null;
  coverage: CurationCoverage[];
  tracks: CurationTrack[];
}
export interface CurationClaimSummary {
  id: string;
  purpose: ClaimPurpose;
  fields: CurationField[];
  generation: number;
  leaseUntil: number;
}
export interface CurationDetail {
  schemaVersion: 1;
  track: CurationTrack;
  coverage: CurationCoverage[];
  activeClaim: CurationClaimSummary | null;
  activeWork: { itemId: string; jobId: string; stage: string }[];
  history: { sequence: number; kind: string; createdAt: number }[];
  nextCursor: string | null;
}
export function decodeCurationCoverage(value: unknown): CurationCoverage {
  const row = curationRecord(value, [
    'libraryId',
    'status',
    'discoveredCount',
    'verifiedCount',
    'unknownCount',
    'lastDiscoveryAt',
    'lastReconciledAt',
    'lastErrorCode',
  ]);
  if (
    !text(row.libraryId) ||
    !['discovering', 'partial', 'ready', 'stale', 'error'].includes(String(row.status)) ||
    !time(row.discoveredCount) ||
    !time(row.verifiedCount) ||
    !time(row.unknownCount) ||
    row.verifiedCount + row.unknownCount > row.discoveredCount ||
    !(row.lastDiscoveryAt === null || time(row.lastDiscoveryAt)) ||
    !(row.lastReconciledAt === null || time(row.lastReconciledAt)) ||
    !nullableText(row.lastErrorCode)
  )
    throw new Error('Invalid curation coverage');
  return row as unknown as CurationCoverage;
}
export function decodeCurationList(value: unknown): CurationList {
  const row = curationRecord(value, [
    'schemaVersion',
    'snapshotId',
    'asOf',
    'expiresAt',
    'total',
    'nextCursor',
    'coverage',
    'tracks',
  ]);
  if (
    row.schemaVersion !== 1 ||
    !text(row.snapshotId) ||
    !time(row.asOf) ||
    !time(row.expiresAt) ||
    row.expiresAt <= row.asOf ||
    !time(row.total) ||
    !nullableText(row.nextCursor) ||
    !Array.isArray(row.coverage) ||
    !Array.isArray(row.tracks) ||
    row.tracks.length > 100 ||
    row.tracks.length > row.total
  )
    throw new Error('Invalid curation list');
  row.coverage.forEach(decodeCurationCoverage);
  row.tracks.forEach(decodeCurationTrack);
  return row as unknown as CurationList;
}
export function decodeCurationDetail(value: unknown): CurationDetail {
  const row = curationRecord(value, [
    'schemaVersion',
    'track',
    'coverage',
    'activeClaim',
    'activeWork',
    'history',
    'nextCursor',
  ]);
  if (
    row.schemaVersion !== 1 ||
    !Array.isArray(row.coverage) ||
    !Array.isArray(row.activeWork) ||
    row.activeWork.length > 100 ||
    !Array.isArray(row.history) ||
    row.history.length > 100 ||
    !nullableText(row.nextCursor)
  )
    throw new Error('Invalid curation detail');
  decodeCurationTrack(row.track);
  row.coverage.forEach(decodeCurationCoverage);
  if (row.activeClaim !== null) {
    const claim = curationRecord(row.activeClaim, [
      'id',
      'purpose',
      'fields',
      'generation',
      'leaseUntil',
    ]);
    if (
      !text(claim.id) ||
      !['required_review', 'optional_enrichment'].includes(String(claim.purpose)) ||
      !Array.isArray(claim.fields) ||
      !claim.fields.length ||
      !claim.fields.every((field) => curationFields.includes(field)) ||
      new Set(claim.fields).size !== claim.fields.length ||
      !time(claim.generation) ||
      claim.generation < 1 ||
      !time(claim.leaseUntil)
    )
      throw new Error('Invalid curation claim');
  }
  for (const value of row.activeWork) {
    const item = curationRecord(value, ['itemId', 'jobId', 'stage']);
    if (
      !text(item.itemId) ||
      !text(item.jobId) ||
      ![
        'queued',
        'preparing',
        'backed_up',
        'prepared',
        'file_saved',
        'reflecting',
        'recovery_required',
      ].includes(String(item.stage))
    )
      throw new Error('Invalid active work');
  }
  let previous = -1;
  for (const value of row.history) {
    const event = curationRecord(value, ['sequence', 'kind', 'createdAt']);
    if (
      !time(event.sequence) ||
      event.sequence <= previous ||
      !text(event.kind) ||
      !time(event.createdAt)
    )
      throw new Error('Invalid curation history');
    previous = event.sequence;
  }
  return row as unknown as CurationDetail;
}

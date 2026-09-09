import type { CurationStatus, ClaimPurpose } from '@musiclatte/contracts';
export interface CurationState {
  baseStatus: Exclude<CurationStatus, 'in_progress'>;
  revision: string | null;
  requiredFingerprint: string | null;
  audioIdentity: string | null;
  policyVersion: string;
  receiptId: string | null;
  validation: 'unknown' | 'verified' | 'pending' | 'stale';
}
export type CurationEvent =
  | {
      type: 'observed';
      revision: string;
      requiredFingerprint: string | null;
      audioIdentity: string;
      policyVersion: string;
      trusted: boolean;
    }
  | { type: 'completed'; receiptId: string }
  | { type: 'reopened' }
  | { type: 'pending' }
  | { type: 'stale' };
export function initialCuration(): CurationState {
  return {
    baseStatus: 'unreviewed',
    revision: null,
    requiredFingerprint: null,
    audioIdentity: null,
    policyVersion: 'required-v1',
    receiptId: null,
    validation: 'unknown',
  };
}
export function reduceCuration(state: CurationState, event: CurationEvent): CurationState {
  if (event.type === 'completed') {
    if (
      state.validation !== 'verified' ||
      !state.revision ||
      !state.requiredFingerprint ||
      !state.audioIdentity
    )
      throw new Error('curation_not_verified');
    return { ...state, baseStatus: 'completed', receiptId: event.receiptId };
  }
  if (event.type === 'reopened') return { ...state, baseStatus: 'needs_review' };
  if (event.type === 'pending' || event.type === 'stale')
    return { ...state, validation: event.type };
  const preserved =
    event.trusted &&
    event.requiredFingerprint === state.requiredFingerprint &&
    event.audioIdentity === state.audioIdentity &&
    event.policyVersion === state.policyVersion;
  return {
    ...state,
    revision: event.revision,
    requiredFingerprint: event.requiredFingerprint,
    audioIdentity: event.audioIdentity,
    policyVersion: event.policyVersion,
    validation: event.trusted ? 'verified' : 'stale',
    baseStatus: state.baseStatus === 'completed' && !preserved ? 'needs_review' : state.baseStatus,
  };
}
export function effectiveCurationStatus(
  state: CurationState,
  claim: { purpose: ClaimPurpose; leaseUntil: number } | null,
  now: number,
): CurationStatus {
  return claim?.purpose === 'required_review' && now < claim.leaseUntil
    ? 'in_progress'
    : state.baseStatus;
}

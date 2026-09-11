export const organizationStages = [
  'queued',
  'validating',
  'references_captured',
  'moving',
  'moved',
  'scanning',
  'rebound',
  'migrating_references',
  'verifying',
  'succeeded',
  'failed',
  'conflict',
  'recovery_required',
] as const;
export type OrganizationStage = (typeof organizationStages)[number];
export type OrganizationRecoveryOwner = 'filesystem' | 'gonic' | 'references' | 'verification';
export interface OrganizationState {
  stage: OrganizationStage;
  errorCode?: string | null;
  nextOwner?: OrganizationRecoveryOwner | null;
}

const next: Partial<Record<OrganizationStage, OrganizationStage>> = {
  queued: 'validating',
  validating: 'references_captured',
  references_captured: 'moving',
  moving: 'moved',
  moved: 'scanning',
  scanning: 'rebound',
  rebound: 'migrating_references',
  migrating_references: 'verifying',
  verifying: 'succeeded',
};

export function initialOrganizationState(): OrganizationState {
  return { stage: 'queued', errorCode: null, nextOwner: null };
}

export function advanceOrganizationState(
  state: OrganizationState,
  stage: OrganizationStage,
): OrganizationState {
  if (next[state.stage] !== stage) throw new Error('invalid_transition');
  return { stage, errorCode: null, nextOwner: null };
}

export function failOrganizationState(
  state: OrganizationState,
  errorCode: string,
): Required<OrganizationState> {
  if (!errorCode || ['succeeded', 'failed', 'conflict'].includes(state.stage))
    throw new Error('invalid_transition');
  if (['queued', 'validating', 'references_captured'].includes(state.stage))
    return { stage: 'failed', errorCode, nextOwner: null };
  const nextOwner: OrganizationRecoveryOwner =
    state.stage === 'moving' || state.stage === 'moved'
      ? 'filesystem'
      : state.stage === 'scanning'
        ? 'gonic'
        : state.stage === 'rebound' || state.stage === 'migrating_references'
          ? 'references'
          : 'verification';
  return { stage: 'recovery_required', errorCode, nextOwner };
}

export function conflictOrganizationState(
  state: OrganizationState,
  errorCode: string,
): Required<OrganizationState> {
  if (!errorCode || ['succeeded', 'failed', 'conflict'].includes(state.stage))
    throw new Error('invalid_transition');
  if (['queued', 'validating', 'references_captured'].includes(state.stage))
    return { stage: 'conflict', errorCode, nextOwner: null };
  return failOrganizationState(state, errorCode);
}

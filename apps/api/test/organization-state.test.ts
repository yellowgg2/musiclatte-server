import { describe, expect, it } from 'vitest';
import {
  advanceOrganizationState,
  conflictOrganizationState,
  failOrganizationState,
  initialOrganizationState,
  organizationStages,
} from '../src/metadata/organization-state.js';

describe('organization state machine', () => {
  it('accepts only the ordered happy path', () => {
    const path = organizationStages.slice(1, -3);
    let state = initialOrganizationState();
    for (const stage of path) state = advanceOrganizationState(state, stage);
    expect(state.stage).toBe('succeeded');
    expect(() => advanceOrganizationState(state, 'verifying')).toThrow('invalid_transition');
  });

  it('classifies failure before and after the rename boundary', () => {
    expect(failOrganizationState({ stage: 'validating' }, 'metadata_incomplete')).toEqual({
      stage: 'failed',
      errorCode: 'metadata_incomplete',
      nextOwner: null,
    });
    expect(failOrganizationState({ stage: 'moving' }, 'move_uncertain')).toEqual({
      stage: 'recovery_required',
      errorCode: 'move_uncertain',
      nextOwner: 'filesystem',
    });
    expect(failOrganizationState({ stage: 'scanning' }, 'scan_timeout')).toEqual({
      stage: 'recovery_required',
      errorCode: 'scan_timeout',
      nextOwner: 'gonic',
    });
    expect(failOrganizationState({ stage: 'migrating_references' }, 'reference_conflict')).toEqual({
      stage: 'recovery_required',
      errorCode: 'reference_conflict',
      nextOwner: 'references',
    });
    expect(conflictOrganizationState({ stage: 'validating' }, 'destination_conflict')).toEqual({
      stage: 'conflict',
      errorCode: 'destination_conflict',
      nextOwner: null,
    });
    expect(conflictOrganizationState({ stage: 'moved' }, 'identity_mismatch')).toMatchObject({
      stage: 'recovery_required',
      nextOwner: 'filesystem',
    });
  });

  it('rejects skipped, reversed, and terminal transitions', () => {
    for (const [from, to] of [
      ['queued', 'moving'],
      ['references_captured', 'validating'],
      ['moved', 'succeeded'],
      ['failed', 'queued'],
      ['conflict', 'validating'],
      ['succeeded', 'recovery_required'],
    ] as const)
      expect(() => advanceOrganizationState({ stage: from }, to)).toThrow('invalid_transition');
  });
});

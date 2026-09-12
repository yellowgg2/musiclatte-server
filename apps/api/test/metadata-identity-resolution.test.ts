import { describe, expect, it } from 'vitest';
import {
  IDENTITY_CHAIN_MAX_HOPS,
  resolveIdentity,
  type OrganizationIdentityEdge,
} from '../src/metadata/identity-resolution.js';

const edge = (
  oldTrackId: string,
  newTrackId: string,
  stage: OrganizationIdentityEdge['stage'],
  mediaLinkId = 'media-1',
): OrganizationIdentityEdge => ({ mediaLinkId, oldTrackId, newTrackId, stage });

const resolve = (
  originalTrackId: string,
  currentTrackId: string,
  organizationEdges: readonly OrganizationIdentityEdge[],
) =>
  resolveIdentity({
    mediaLinkId: 'media-1',
    originalTrackId,
    currentTrackId,
    organizationEdges,
  });

describe('resolveIdentity', () => {
  /** Same-ID metadata changes remain unchanged regardless of organization history. */
  it('returns unchanged before considering organization edges', () => {
    expect(resolve('old', 'old', [edge('old', 'other', 'succeeded')])).toBe('unchanged');
  });

  /** One completed replacement proves the current binding. */
  it('returns verified for a single succeeded edge', () => {
    expect(resolve('old', 'current', [edge('old', 'current', 'succeeded')])).toBe(
      'replacement_verified',
    );
  });

  /** An exact in-flight replacement is pending until reference verification completes. */
  it.each(['scanning', 'rebound', 'migrating_references', 'verifying'] as const)(
    'returns pending for an exact %s edge',
    (stage) => {
      expect(resolve('old', 'current', [edge('old', 'current', stage)])).toBe(
        'replacement_pending',
      );
    },
  );

  /** Failed and recovery-only evidence never proves replacement. */
  it.each(['failed', 'conflict', 'recovery_required'] as const)(
    'returns unresolved for a %s edge',
    (stage) => {
      expect(resolve('old', 'current', [edge('old', 'current', stage)])).toBe(
        'replacement_unresolved',
      );
    },
  );

  /** Edges belonging to another media link cannot influence the result. */
  it('ignores an otherwise matching edge from another media link', () => {
    expect(resolve('old', 'current', [edge('old', 'current', 'succeeded', 'media-2')])).toBe(
      'replacement_unresolved',
    );
  });

  /** An edge starting from a different historical ID is not a replacement proof. */
  it('ignores an edge whose old track does not match the chain', () => {
    expect(resolve('old', 'current', [edge('other', 'current', 'succeeded')])).toBe(
      'replacement_unresolved',
    );
  });

  /** A failed historical attempt does not override a later exact succeeded edge. */
  it('prefers a verified chain over unrelated failed history', () => {
    expect(
      resolve('old', 'current', [
        edge('old', 'abandoned', 'failed'),
        edge('old', 'current', 'succeeded'),
      ]),
    ).toBe('replacement_verified');
  });

  /** Every edge in a multi-move chain must have succeeded. */
  it('follows a succeeded old-to-mid-to-current chain', () => {
    expect(
      resolve('old', 'current', [
        edge('old', 'mid', 'succeeded'),
        edge('mid', 'current', 'succeeded'),
      ]),
    ).toBe('replacement_verified');
    expect(
      resolve('old', 'current', [
        edge('old', 'mid', 'succeeded'),
        edge('mid', 'current', 'failed'),
      ]),
    ).toBe('replacement_unresolved');
  });

  /** A succeeded prefix may end in one exact in-flight edge. */
  it('returns pending for a succeeded prefix followed by an in-flight edge', () => {
    expect(
      resolve('old', 'current', [
        edge('old', 'mid', 'succeeded'),
        edge('mid', 'current', 'verifying'),
      ]),
    ).toBe('replacement_pending');
  });

  /** Reachable branch ambiguity fails closed even if one branch reaches current. */
  it('returns unresolved for an ambiguous succeeded branch', () => {
    expect(
      resolve('old', 'current', [
        edge('old', 'current', 'succeeded'),
        edge('old', 'other', 'succeeded'),
      ]),
    ).toBe('replacement_unresolved');
  });

  /** Cycles fail closed instead of looping or selecting partial evidence. */
  it('returns unresolved for a cycle', () => {
    expect(
      resolve('old', 'current', [edge('old', 'mid', 'succeeded'), edge('mid', 'old', 'succeeded')]),
    ).toBe('replacement_unresolved');
  });

  /** Chains beyond the explicit traversal bound are never auto-verified. */
  it('returns unresolved when the chain exceeds the hop limit', () => {
    const edges = Array.from({ length: IDENTITY_CHAIN_MAX_HOPS + 1 }, (_, index) =>
      edge(`track-${index}`, `track-${index + 1}`, 'succeeded'),
    );
    expect(resolve('track-0', `track-${IDENTITY_CHAIN_MAX_HOPS + 1}`, edges)).toBe(
      'replacement_unresolved',
    );
  });
});

import { describe, expect, it } from 'vitest';

describe('curation review semantics', () => {
  it('keeps existing values unreviewed and optional enrichment independent of review', async () => {
    const { initialCuration, reduceCuration, effectiveCurationStatus } =
      await import('../src/curation/state.js');
    const initial = initialCuration();
    const observed = reduceCuration(initial, {
      type: 'observed',
      revision: 'r1',
      requiredFingerprint: 'required',
      audioIdentity: 'audio',
      policyVersion: 'required-v1',
      trusted: true,
    });
    expect(observed.baseStatus).toBe('unreviewed');
    const completed = reduceCuration(observed, { type: 'completed', receiptId: 'receipt' });
    const enriched = reduceCuration(completed, {
      type: 'observed',
      revision: 'r2',
      requiredFingerprint: 'required',
      audioIdentity: 'audio',
      policyVersion: 'required-v1',
      trusted: true,
    });
    expect(enriched).toMatchObject({
      baseStatus: 'completed',
      receiptId: 'receipt',
      revision: 'r2',
    });
    expect(
      effectiveCurationStatus(enriched, { purpose: 'optional_enrichment', leaseUntil: 200 }, 100),
    ).toBe('completed');
    expect(
      effectiveCurationStatus(enriched, { purpose: 'required_review', leaseUntil: 200 }, 100),
    ).toBe('in_progress');
    expect(
      effectiveCurationStatus(enriched, { purpose: 'required_review', leaseUntil: 200 }, 200),
    ).toBe('completed');
    const changed = reduceCuration(enriched, {
      type: 'observed',
      revision: 'r3',
      requiredFingerprint: 'different',
      audioIdentity: 'audio',
      policyVersion: 'required-v1',
      trusted: true,
    });
    expect(changed).toMatchObject({ baseStatus: 'needs_review', receiptId: 'receipt' });
    expect(
      reduceCuration(changed, {
        type: 'observed',
        revision: 'r4',
        requiredFingerprint: 'required',
        audioIdentity: 'audio',
        policyVersion: 'required-v1',
        trusted: true,
      }).baseStatus,
    ).toBe('needs_review');
    expect(reduceCuration(enriched, { type: 'reopened' }).baseStatus).toBe('needs_review');
    expect(reduceCuration(enriched, { type: 'pending' })).toMatchObject({
      baseStatus: 'completed',
      revision: 'r2',
      validation: 'pending',
    });
    expect(
      reduceCuration(enriched, {
        type: 'observed',
        revision: 'r3',
        requiredFingerprint: 'required',
        audioIdentity: 'audio',
        policyVersion: 'required-v1',
        trusted: false,
      }).baseStatus,
    ).toBe('needs_review');
  });
  it('normalizes required strings without ignoring artist order or case', async () => {
    const { requiredFingerprint } = await import('../src/curation/policy.js');
    expect(requiredFingerprint(' Café ', [' A ', 'B'])).toBe(
      requiredFingerprint('Cafe\u0301', ['A', 'B']),
    );
    expect(requiredFingerprint('title', ['A', 'B'])).not.toBe(
      requiredFingerprint('title', ['B', 'A']),
    );
    expect(requiredFingerprint('Title', ['A'])).not.toBe(requiredFingerprint('title', ['A']));
    expect(requiredFingerprint(' ', ['A'])).toBeNull();
    expect(requiredFingerprint('title', [])).toBeNull();
  });
});

import { createHash } from 'node:crypto';
import {
  curationFields,
  optionalCurationFields,
  requiredCurationFields,
  type CurationPolicy,
} from '@musiclatte/contracts';
export interface CurationLimits {
  claimLeaseMs: number;
  maxTargets: number;
  snapshotMaxAgeMs: number;
  snapshotMaxItems: number;
  snapshotMaxCount: number;
}
export function createCurationPolicy(limits: CurationLimits): CurationPolicy {
  for (const [key, value] of Object.entries(limits)) {
    const max = key.endsWith('Ms') ? 86_400_000 : key === 'maxTargets' ? 100 : 1_000_000;
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error('Invalid curation limits');
  }
  return {
    policyVersion: 'required-v1',
    requiredFields: [...requiredCurationFields],
    optionalFields: [...optionalCurationFields],
    supportedFieldsByFormat: {
      mp3: [...curationFields],
      unsupported: [],
    },
    allowedAttemptStatusesByField: {
      album: ['unavailable', 'not_applicable'],
      albumArtist: ['unavailable', 'not_applicable'],
      trackNumber: ['unavailable', 'not_applicable'],
      year: ['unavailable', 'not_applicable'],
      genre: ['unavailable', 'not_applicable'],
      cover: ['unavailable', 'not_applicable'],
      lyrics: ['unavailable', 'not_applicable'],
    },
    claimLeaseMs: limits.claimLeaseMs,
    maxTargets: limits.maxTargets,
    snapshotMaxAgeMs: limits.snapshotMaxAgeMs,
  };
}
export function requiredFingerprint(title: unknown, artists: unknown): string | null {
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    !Array.isArray(artists) ||
    !artists.length ||
    !artists.every((v): v is string => typeof v === 'string' && !!v.trim())
  )
    return null;
  return createHash('sha256')
    .update(
      JSON.stringify([
        title.normalize('NFC').trim(),
        artists.map((v) => v.normalize('NFC').trim()),
      ]),
    )
    .digest('hex');
}

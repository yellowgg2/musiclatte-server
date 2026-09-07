import { createHmac, timingSafeEqual } from 'node:crypto';
import { validateRelativeKey } from '../imports/policy.js';

export interface MetadataRevisionInput {
  libraryId: string;
  relativeFileKey: string;
  digest: string;
}
/** Stable instance-key signatures survive login changes; raw file digests stay server-only. */
export function createMetadataRevision(input: Uint8Array) {
  if (input.length !== 32) throw new Error('invalid_metadata_key');
  const key = Buffer.from(input);
  const sign = (domain: string, parts: string[]) =>
    createHmac('sha256', key)
      .update(JSON.stringify(['musiclatte-metadata', 1, domain, ...parts]))
      .digest('hex');
  const scope = (input: Pick<MetadataRevisionInput, 'libraryId' | 'relativeFileKey'>) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.libraryId)) throw new Error('invalid_metadata_scope');
    return [input.libraryId, validateRelativeKey(input.relativeFileKey)];
  };
  const fileRevision = (input: MetadataRevisionInput) => {
    if (!/^[a-f0-9]{64}$/.test(input.digest)) throw new Error('invalid_metadata_digest');
    return sign('file-revision', [...scope(input), input.digest]);
  };
  return {
    fileRevision,
    fileIdentity(input: Pick<MetadataRevisionInput, 'libraryId' | 'relativeFileKey'>) {
      return sign('file-identity', scope(input));
    },
    assertExpected(input: MetadataRevisionInput, expected: string) {
      const actual = fileRevision(input);
      if (
        typeof expected !== 'string' ||
        !/^[a-f0-9]{64}$/.test(expected) ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
      )
        throw new Error('revision_conflict');
    },
  };
}

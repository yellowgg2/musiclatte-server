import type { MetadataJob, MetadataPatch, MetadataValues } from '@musiclatte/contracts';
export const bulkFields = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'trackNumber',
  'year',
  'genre',
] as const;
export type BulkValue<T> = { kind: 'common'; value: T } | { kind: 'mixed' };
export function commonValue<T>(values: readonly T[]): BulkValue<T> {
  if (!values.length || values.some((value) => JSON.stringify(value) !== JSON.stringify(values[0])))
    return { kind: 'mixed' };
  return { kind: 'common', value: structuredClone(values[0]!) };
}
export type MetadataDraft = Partial<{
  [K in keyof MetadataValues]:
    { op: 'keep' } | { op: 'clear' } | { op: 'set'; value: NonNullable<MetadataValues[K]> };
}>;
export function buildBulkPatch(draft: MetadataDraft): MetadataPatch {
  return Object.fromEntries(
    Object.entries(draft).filter(([, value]) => value.op !== 'keep'),
  ) as MetadataPatch;
}
export function uniqueTargets(ids: readonly string[]): string[] {
  const targets = [...new Set(ids)];
  if (targets.length > 64) throw new Error('target_limit');
  return targets;
}
export function retryTargets(job: MetadataJob) {
  return job.items.filter(
    (item) =>
      ['failed', 'conflict'].includes(item.stage) &&
      item.fileSavedAt === null &&
      item.recoveryActions.includes('retry'),
  );
}

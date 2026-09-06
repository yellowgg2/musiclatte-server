export type AppendContinuation = { operationId: string; expectedRevision: string };
export const APPEND_BATCH_MAX_BYTES = 8 * 1024;

export function appendRequestBody(
  operationId: string,
  expectedRevision: string,
  songIds: readonly string[],
) {
  return { operationId, expectedRevision, action: 'append' as const, songIds };
}

export function appendRequestBytes(
  operationId: string,
  expectedRevision: string,
  songIds: readonly string[],
) {
  return new TextEncoder().encode(
    JSON.stringify(appendRequestBody(operationId, expectedRevision, songIds)),
  ).byteLength;
}

export function takeAppendBatch(
  songIds: readonly string[],
  expectedRevision: string,
  operationId: string,
  maxBytes = APPEND_BATCH_MAX_BYTES,
) {
  const accepted: string[] = [];
  for (const id of songIds) {
    const candidate = [...accepted, id];
    if (appendRequestBytes(operationId, expectedRevision, candidate) > maxBytes) break;
    accepted.push(id);
  }
  if (songIds.length > 0 && accepted.length === 0)
    throw new RangeError('A song ID exceeds the playlist append body limit');
  return {
    songIds: accepted,
    remaining: songIds.slice(accepted.length),
    encodedBytes: appendRequestBytes(operationId, expectedRevision, accepted),
  };
}

export async function appendSelectedSongs({
  songIds,
  expectedRevision,
  operationId,
  append,
  continuation,
  maxBytes = APPEND_BATCH_MAX_BYTES,
}: {
  songIds: readonly string[];
  expectedRevision: string;
  operationId: () => string;
  append: (request: {
    operationId: string;
    expectedRevision: string;
    songIds: readonly string[];
  }) => Promise<{ revision: string }>;
  continuation?: AppendContinuation;
  maxBytes?: number;
}) {
  let remainingIds = [...songIds];
  const appliedIds: string[] = [];
  let revision = continuation?.expectedRevision ?? expectedRevision;
  let receipt = continuation?.operationId;
  while (remainingIds.length > 0) {
    const nextOperationId = receipt ?? operationId();
    const batch = takeAppendBatch(remainingIds, revision, nextOperationId, maxBytes);
    try {
      const result = await append({
        operationId: nextOperationId,
        expectedRevision: revision,
        songIds: batch.songIds,
      });
      appliedIds.push(...batch.songIds);
      remainingIds = batch.remaining;
      revision = result.revision;
      receipt = undefined;
    } catch (error) {
      return {
        status: 'partial' as const,
        appliedIds,
        remainingIds,
        failedIds: batch.songIds,
        unattemptedIds: batch.remaining,
        revision,
        error,
        continuation: { operationId: nextOperationId, expectedRevision: revision },
      };
    }
  }
  return {
    status: 'complete' as const,
    appliedIds,
    remainingIds,
    revision,
  };
}

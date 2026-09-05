/** No implicit retention policy: the operator must provide positive integer seconds. */
export function readSessionPolicy(env: Record<string, string | undefined>): { maxAgeMs: number } {
  const value = env.SESSION_MAX_AGE_SECONDS;
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value) * 1000)) throw new Error('Invalid SESSION_MAX_AGE_SECONDS');
  return { maxAgeMs: Number(value) * 1000 };
}

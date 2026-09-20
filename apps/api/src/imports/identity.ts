export type ImportSigner = (purpose: string, value: string) => string;

/** Stable account projection shared by import, recent and API startup. */
export function importIdentityKey(
  sign: ImportSigner,
  instanceId: string,
  username: string,
): string {
  return Buffer.from(
    sign('import-identity', JSON.stringify([instanceId, username])),
    'base64url',
  ).toString('hex');
}

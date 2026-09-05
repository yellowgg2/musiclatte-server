import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SubsonicTokenProof } from '@musiclatte/contracts';

export interface CredentialVault {
  readonly keyId: string;
  seal(proof: SubsonicTokenProof, context: string): string;
  open(envelope: string, context: string): SubsonicTokenProof;
}
function projectProof(value: unknown): SubsonicTokenProof {
  if (!value || typeof value !== 'object' || !('username' in value) || typeof value.username !== 'string' || !value.username || !('t' in value) || typeof value.t !== 'string' || !value.t || !('s' in value) || typeof value.s !== 'string' || !value.s) throw new Error('Invalid credential');
  return { username: value.username, t: value.t, s: value.s };
}
/** AES-256-GCM with fresh 96-bit IVs, full 128-bit tags and row-bound AAD. */
export function createCredentialVault(input: Uint8Array): CredentialVault {
  if (input.length !== 32) throw new Error('Invalid key');
  const key = Buffer.from(input);
  const keyId = createHash('sha256').update(key).digest('hex');
  const aad = (context: string) => Buffer.from(JSON.stringify(['musiclatte-credential', 1, keyId, context]));
  return {
    keyId,
    seal(proof, context) {
      const payload = JSON.stringify(projectProof(proof)); const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 }); cipher.setAAD(aad(context));
      const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
      return ['1', keyId, iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
    },
    open(envelope, context) {
      try {
        const parts = envelope.split('.'); const [version, id, ivText, bodyText, tagText] = parts;
        if (parts.length !== 5 || version !== '1' || id !== keyId || !ivText || !bodyText || !tagText) throw new Error();
        const values = [ivText, bodyText, tagText].map(value => { const decoded = Buffer.from(value, 'base64url'); if (decoded.toString('base64url') !== value) throw new Error(); return decoded; });
        const [iv, body, tag] = values; if (!iv || iv.length !== 12 || !body || !tag || tag.length !== 16) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 }); decipher.setAAD(aad(context)); decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(body), decipher.final()]);
        return projectProof(JSON.parse(decrypted.toString('utf8')));
      } catch { throw new Error('Reauthentication required'); }
    },
  };
}

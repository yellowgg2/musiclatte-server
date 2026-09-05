import { chmodSync, existsSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, proof } from '../../../tests/support/session-storage-harness.js';
let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });
async function makeSUT() { ctx = await createTestContext(); return ctx; }
describe('credential vault and persistent key', () => {
  /** Each encryption randomizes the nonce and authenticates the context. */
  it('should round trip synthetic proof with distinct ciphertext', async () => {
    const c = await makeSUT(); const a = c.vault.seal(proof, 'session-a'); const b = c.vault.seal(proof, 'session-a');
    expect(a).not.toBe(b); expect(a).not.toContain(proof.t); expect(a).not.toContain(proof.s);
    expect(c.vault.open(a, 'session-a')).toEqual(proof);
    expect(() => c.vault.open(a, 'session-b')).toThrow('Reauthentication required');
  });
  /** Altered envelopes and wrong keys never return unauthenticated plaintext. */
  it('should reject tampering malformed versions and wrong keys without raw causes', async () => {
    const c = await makeSUT(); const envelope = c.vault.seal(proof, 'ctx');
    for (const value of ['', '{}', envelope.replace(/^1/, '9'), envelope.slice(0, -4) + 'AAAA']) {
      expect(() => c.vault.open(value, 'ctx')).toThrow('Reauthentication required');
    }
    const other = c.createCredentialVault(Buffer.alloc(32, 7));
    try { other.open(envelope, 'ctx'); expect.fail('wrong key accepted'); } catch (error) {
      expect(error).toMatchObject({ message: 'Reauthentication required' }); expect(error).not.toHaveProperty('cause');
      expect(String(error)).not.toContain(proof.t);
    }
  });
  /** Only the explicit reusable proof fields are encrypted. */
  it('should reject malformed proof and exclude extra password and role fields', async () => {
    const c = await makeSUT();
    const extra = { ...proof, password: 'synthetic-never-persist', adminRole: true };
    expect(c.vault.open(c.vault.seal(extra, 'ctx'), 'ctx')).toEqual(proof);
    expect(() => c.vault.seal({ ...proof, t: '' }, 'ctx')).toThrow('Invalid credential');
    expect(() => c.createCredentialVault(Buffer.alloc(31))).toThrow('Invalid key');
  });
  /** Existing key bytes survive startup and accidental repeated creation. */
  it('should persist private key files and refuse overwrite', async () => {
    const c = await makeSUT(); const before = readFileSync(c.keyPath);
    expect(before.length).toBe(32); expect(statSync(c.keyPath).mode & 0o777).toBe(0o600);
    expect(() => c.createKey(c.keyPath)).toThrow('Key creation failed');
    expect(c.loadKey(c.keyPath)).toEqual(before);
  });
  /** Missing or damaged keys are never implicitly replaced during recovery. */
  it('should reject missing truncated permissive and symlink keys', async () => {
    const c = await makeSUT(); const link = join(c.root, 'link.key'); symlinkSync(c.keyPath, link);
    expect(() => c.loadKey(link)).toThrow('Reauthentication required');
    chmodSync(c.keyPath, 0o644); expect(() => c.loadKey(c.keyPath)).toThrow('Reauthentication required');
    chmodSync(c.keyPath, 0o600); writeFileSync(c.keyPath, 'broken');
    expect(() => c.loadKey(c.keyPath)).toThrow('Reauthentication required');
    unlinkSync(c.keyPath); expect(() => c.loadKey(c.keyPath)).toThrow('Reauthentication required'); expect(existsSync(c.keyPath)).toBe(false);
  });
});

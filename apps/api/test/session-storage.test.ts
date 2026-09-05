import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, proof } from '../../../tests/support/session-storage-harness.js';
let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });
async function makeSUT() { ctx = await createTestContext(); return ctx; }
describe('session and instance storage', () => {
  /** Migration establishes only management records and is repeatable on reopen. */
  it('should migrate fresh storage and preserve instance across restart', async () => {
    const c = await makeSUT(); const instance = c.instances.get(); c.db.close();
    const reopened = c.open(); expect(c.createInstanceRepository(reopened, c.vault.keyId).get()).toEqual(instance);
    expect(reopened.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    const tables = reopened.connection.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => row.name);
    expect(tables).toEqual(['instance', 'sessions']);
  });
  /** Persistent sessions contain hashes and encrypted proof, not browser tokens. */
  it('should recover session after restart without storing bearer or plaintext proof', async () => {
    const c = await makeSUT(); const issued = c.sessions.create(proof);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(issued.expiresAt).toBe(2000);
    const row = c.db.connection.prepare('SELECT * FROM sessions').get();
    expect(row?.id_hash).toBe(createHash('sha256').update(issued.token).digest('hex'));
    expect(row).not.toHaveProperty('password'); expect(row).not.toHaveProperty('admin_role');
    for (const name of readdirSync(c.data).filter(name => !name.endsWith('-shm'))) {
      const bytes = readFileSync(join(c.data, name)); for (const secret of [issued.token, proof.t, proof.s]) expect(bytes.includes(Buffer.from(secret))).toBe(false);
    }
    c.db.close(); const reopened = c.open();
    expect(c.sessionsFor(reopened).find(issued.token)).toMatchObject({ username: proof.username, proof, expiresAt: 2000 });
  });
  /** Expiry is inclusive and persisted absolute age cannot be extended by new config. */
  it('should expire exactly at the deadline and reject unknown tokens', async () => {
    const c = await makeSUT(); const issued = c.sessions.create(proof); c.setNow(1999);
    expect(c.sessions.find(issued.token)).not.toBeNull(); c.setNow(2000);
    expect(c.sessionsFor(c.db, 9000).find(issued.token)).toBeNull(); expect(c.sessions.find('unknown')).toBeNull();
    expect(c.db.connection.prepare('SELECT encrypted_proof FROM sessions').get()?.encrypted_proof).toBeNull();
  });
  /** Revocation is idempotent, persists and destroys the live credential envelope. */
  it('should revoke independently across two connections without resurrecting a session', async () => {
    const c = await makeSUT(); const a = c.sessions.create(proof); const b = c.sessions.create(proof); const other = c.open();
    c.sessionsFor(other).revoke(a.token); c.sessions.revoke(a.token);
    expect(c.sessions.find(a.token)).toBeNull(); expect(c.sessions.find(b.token)).not.toBeNull();
    c.db.close(); expect(c.sessionsFor(other).find(a.token)).toBeNull();
    expect(other.connection.prepare('SELECT encrypted_proof FROM sessions WHERE revoked_at IS NOT NULL').get()?.encrypted_proof).toBeNull();
  });
  /** Policy revision atomically invalidates prior authorization state. */
  it('should advance policy revision and require new sessions', async () => {
    const c = await makeSUT(); const a = c.sessions.create(proof); const old = c.instances.get(); const next = c.instances.bumpPolicyRevision();
    expect(next).toEqual({ id: old.id, policyRevision: old.policyRevision + 1 }); expect(c.sessions.find(a.token)).toBeNull();
    expect(c.sessions.find(c.sessions.create(proof).token)?.policyRevision).toBe(next.policyRevision);
  });
  /** Row-bound authenticated data prevents envelope swaps and lifetime edits. */
  it('should reject ciphertext copied across sessions and mutated expiry', async () => {
    const c = await makeSUT(); const a = c.sessions.create(proof); const b = c.sessions.create(proof);
    const hash = (token: string) => createHash('sha256').update(token).digest('hex');
    c.db.connection.prepare('UPDATE sessions SET encrypted_proof=(SELECT encrypted_proof FROM sessions WHERE id_hash=?) WHERE id_hash=?').run(hash(a.token), hash(b.token));
    expect(c.sessions.find(b.token)).toBeNull();
    c.db.connection.prepare('UPDATE sessions SET expires_at=expires_at+1 WHERE id_hash=?').run(hash(a.token)); expect(c.sessions.find(a.token)).toBeNull();
  });
  /** A lost/mismatched key cannot be rebound to an existing instance. */
  it('should fail closed when an existing instance receives a different key', async () => {
    const c = await makeSUT(); const other = c.createCredentialVault(Buffer.alloc(32, 8));
    expect(() => c.createInstanceRepository(c.db, other.keyId)).toThrow('Reauthentication required');
    expect(() => c.createSessionRepository({ database: c.db, vault: other, clock: () => 1000, maxAgeMs: 1000 })).toThrow('Reauthentication required');
  });
  /** Transaction failure rolls back every write and leaves the connection reusable. */
  it('should roll back multi-statement failures and reject asynchronous transactions', async () => {
    const c = await makeSUT(); const old = c.instances.get();
    expect(() => c.db.transaction(() => { c.db.connection.exec('UPDATE instance SET policy_revision=9'); throw new Error('fixture rollback'); })).toThrow('fixture rollback');
    expect(c.instances.get()).toEqual(old);
    expect(() => c.db.transaction(async () => 1)).toThrow('Synchronous transaction required');
    expect(c.instances.bumpPolicyRevision().policyRevision).toBe(old.policyRevision + 1);
  });
  /** Competing writes respect the SQLite writer lock and can retry after rollback. */
  it('should handle writer contention without partial session changes', async () => {
    const c = await makeSUT(); const other = c.open(); const sessions = c.sessionsFor(other);
    c.db.connection.exec('BEGIN IMMEDIATE');
    try { expect(() => sessions.create(proof)).toThrow('Storage unavailable'); } finally { c.db.connection.exec('ROLLBACK'); }
    expect(sessions.find(sessions.create(proof).token)).not.toBeNull();
  });
  /** Unknown schemas and foreign databases are refused without changing their contents. */
  it('should refuse future versions and unrelated databases', async () => {
    const c = await makeSUT(); c.db.connection.exec('PRAGMA user_version=99'); c.db.close();
    expect(() => c.open()).toThrow('Unsupported storage schema');
    const foreign = join(c.root, 'foreign'); mkdirSync(foreign); const path = join(foreign, 'management.sqlite');
    const raw = new DatabaseSync(path); raw.exec('CREATE TABLE music(id TEXT)'); raw.close(); const before = readFileSync(path);
    expect(() => c.open(foreign)).toThrow('Unsupported storage schema'); expect(readFileSync(path)).toEqual(before);
  });
  /** Session age must be explicitly configured as positive safe integer seconds. */
  it('should validate runtime session max age with no invented retention default', async () => {
    const c = await makeSUT(); expect(c.readSessionPolicy({ SESSION_MAX_AGE_SECONDS: '3600' })).toEqual({ maxAgeMs: 3600000 });
    for (const value of [undefined, '', '0', '-1', '1.5', ' 1', '1e3', 'Infinity', '9007199254740991']) {
      expect(() => c.readSessionPolicy({ SESSION_MAX_AGE_SECONDS: value })).toThrow('Invalid SESSION_MAX_AGE_SECONDS');
    }
    for (const age of [0, -1, NaN, Infinity, 1.5]) expect(() => c.sessionsFor(c.db, age)).toThrow('Invalid session max age');
  });
  /** Invalid clocks and overflowing expiry never create an unbounded session. */
  it('should reject invalid time and fail closed on backward clock values', async () => {
    const c = await makeSUT(); const issued = c.sessions.create(proof); c.setNow(999); expect(c.sessions.find(issued.token)).toBeNull();
    for (const value of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) { c.setNow(value); expect(() => c.sessions.create(proof)).toThrow('Invalid session time'); }
  });
});

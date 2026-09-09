import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { ManagementDatabase } from '../storage/database.js';

export interface MediaFenceOptions {
  root: string;
  python: string;
  helperPath: string;
  timeoutMs: number;
}
export interface HeldMediaFence {
  fileIdentity: string;
  nonce: string;
  pid: number;
  validate(): Promise<void>;
  assertHeld(): void;
  release(): Promise<void>;
  kill(): void;
  closed: Promise<void>;
}
export function mediaFenceRoot(root: string) {
  if (!isAbsolute(root) || root === '/' || realpathSync(root) !== root)
    throw new Error('invalid_fence');
  const stat = lstatSync(root, { bigint: true });
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    Number(stat.mode) & 0o077 ||
    Number(stat.uid) !== process.getuid?.()
  )
    throw new Error('invalid_fence');
  return { device: String(stat.dev), inode: String(stat.ino) };
}
export function createMediaFence(options: MediaFenceOptions) {
  const rootIdentity = mediaFenceRoot(options.root);
  if (
    ![options.python, options.helperPath].every(isAbsolute) ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 60000
  )
    throw new Error('invalid_fence');
  async function acquire(
    fileIdentity: string,
    purpose: 'verify' | 'publish' | 'recover',
  ): Promise<HeldMediaFence> {
    if (!/^[a-f0-9]{64}$/.test(fileIdentity)) throw new Error('invalid_fence');
    const nonce = randomUUID();
    const child = spawn(options.python, ['-I', '-B', options.helperPath], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let failed: Error | undefined;
    let held = false;
    let released = false;
    let count = 0;
    let buffer = '';
    let pending: { stage: string; resolve(): void; reject(error: Error): void } | undefined;
    const kill = () => {
      child.kill('SIGKILL');
    };
    function fail(code: string) {
      failed ??= new Error(code);
      held = false;
      pending?.reject(failed);
      pending = undefined;
      kill();
    }
    const timer = setTimeout(() => fail('fence_lost'), options.timeoutMs);
    const closed = new Promise<void>((resolve) => {
      child.on('close', () => {
        clearTimeout(timer);
        held = false;
        if (!released) fail('fence_lost');
        resolve();
      });
    });
    child.on('error', () => fail('fence_lost'));
    child.stdin.on('error', () => fail('fence_lost'));
    child.stderr.on('data', (data: Buffer) => {
      count += data.length;
      if (count > 65536) fail('fence_lost');
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      count += Buffer.byteLength(data);
      buffer += data;
      if (count > 65536 || buffer.length > 4096) {
        fail('fence_lost');
        return;
      }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const value = JSON.parse(line) as { stage?: string; nonce?: string; error?: string };
          if (value.error) {
            fail(
              ['file_busy', 'permission_changed', 'invalid_fence'].includes(value.error)
                ? value.error
                : 'fence_lost',
            );
            return;
          }
          if (!pending || value.stage !== pending.stage || value.nonce !== nonce) throw new Error();
          if (value.stage === 'held') held = true;
          if (value.stage === 'released') {
            released = true;
            held = false;
          }
          pending.resolve();
          pending = undefined;
        } catch {
          fail('fence_lost');
        }
      }
    });
    const wait = (stage: string) =>
      new Promise<void>((resolve, reject) => {
        if (failed) reject(failed);
        else if (pending) reject(new Error('fence_busy'));
        else pending = { stage, resolve, reject };
      });
    const ready = wait('held');
    child.stdin.write(
      JSON.stringify({ root: options.root, rootIdentity, fileIdentity, nonce, purpose }) + '\n',
    );
    try {
      await ready;
    } catch (error) {
      await closed;
      throw error;
    }
    function assertHeld() {
      if (!held || failed || child.exitCode !== null || child.signalCode !== null || !child.pid)
        throw new Error('fence_lost');
      try {
        process.kill(child.pid, 0);
      } catch {
        throw new Error('fence_lost');
      }
    }
    return {
      fileIdentity,
      nonce,
      pid: child.pid!,
      closed,
      kill,
      assertHeld,
      async validate() {
        assertHeld();
        const done = wait('validated');
        child.stdin.write(JSON.stringify({ ack: 'validate', nonce }) + '\n');
        await done;
        assertHeld();
      },
      async release() {
        if (released) return;
        assertHeld();
        const done = wait('released');
        child.stdin.write(JSON.stringify({ ack: 'release', nonce }) + '\n');
        await done;
        child.stdin.end();
        await closed;
      },
    };
  }
  return {
    acquire,
    rootIdentity,
    async withMediaFence<T>(
      identity: string,
      purpose: 'verify' | 'publish' | 'recover',
      work: (held: HeldMediaFence) => Promise<T>,
    ): Promise<T> {
      const held = await acquire(identity, purpose);
      try {
        const result = await work(held);
        await held.validate();
        await held.release();
        return result;
      } finally {
        held.kill();
        await held.closed;
      }
    },
  };
}
export function validateHeldFence(held: HeldMediaFence) {
  held.assertHeld();
}
export interface PublicationFence {
  fileIdentity: string;
  generation: number;
  owner: string;
}
/** Generation checks are transaction-local; OS ownership is acquired before calling begin. */
export function createMediaPublicationLedger(database: ManagementDatabase, clock: () => number) {
  const db = database.connection;
  const atomic = <T>(work: () => T): T => (db.isTransaction ? work() : database.transaction(work));
  function validate(fence: PublicationFence) {
    const row = db
      .prepare('SELECT generation,owner FROM media_publications WHERE file_identity=?')
      .get(fence.fileIdentity);
    if (row?.generation !== fence.generation || row.owner !== fence.owner)
      throw new Error('fence_lost');
  }
  return {
    begin(fileIdentity: string, owner: string): PublicationFence {
      return atomic(() => {
        db.prepare(
          'INSERT INTO media_publications(file_identity,generation,owner,dirty,updated_at) VALUES(?,1,?,0,?) ON CONFLICT(file_identity) DO UPDATE SET generation=generation+1,owner=excluded.owner,updated_at=excluded.updated_at',
        ).run(fileIdentity, owner, clock());
        return {
          fileIdentity,
          owner,
          generation: Number(
            db
              .prepare('SELECT generation FROM media_publications WHERE file_identity=?')
              .get(fileIdentity)!.generation,
          ),
        };
      });
    },
    validate,
    dirty(fence: PublicationFence, publicationId: string) {
      atomic(() => {
        validate(fence);
        db.prepare(
          'UPDATE media_publications SET dirty=1,publication_id=?,updated_at=? WHERE file_identity=?',
        ).run(publicationId, clock(), fence.fileIdentity);
        db.prepare("UPDATE curation_tracks SET validation='pending' WHERE file_identity=?").run(
          fence.fileIdentity,
        );
      });
    },
    recordMediaPublication(fence: PublicationFence, digest: string) {
      atomic(() => {
        validate(fence);
        if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('invalid_metadata_digest');
        db.prepare('UPDATE media_publications SET digest=?,updated_at=? WHERE file_identity=?').run(
          digest,
          clock(),
          fence.fileIdentity,
        );
        // Remain dirty until fresh inventory has verified fields/audio and current binding.
      });
    },
    reconcile(fence: PublicationFence) {
      atomic(() => {
        validate(fence);
        db.prepare('UPDATE media_publications SET dirty=0,updated_at=? WHERE file_identity=?').run(
          clock(),
          fence.fileIdentity,
        );
      });
    },
    assertAvailable(fileIdentity: string, actorKey?: string) {
      // Curation must wait for an interrupted P3 publication to classify its journal.
      // The P3 owner itself (no curation actor) must still be able to recover it.
      if (
        actorKey &&
        db
          .prepare(
            "SELECT 1 FROM media_publications p JOIN import_items i ON i.id=p.publication_id WHERE p.file_identity=? AND i.stage='publishing'",
          )
          .get(fileIdentity)
      )
        throw new Error('file_busy');
      if (
        db
          .prepare(
            "SELECT 1 FROM metadata_items WHERE file_identity=? AND stage IN ('queued','preparing','backed_up','prepared','file_saved','reflecting','recovery_required') LIMIT 1",
          )
          .get(fileIdentity)
      )
        throw new Error('file_busy');
      const claim = db
        .prepare(
          'SELECT c.actor_key FROM curation_claims c JOIN curation_claim_items i ON i.claim_id=c.id JOIN curation_state s ON s.claim_epoch=c.claim_epoch WHERE i.file_identity=? AND c.released_at IS NULL AND c.created_at<=? AND c.lease_until>? LIMIT 1',
        )
        .get(fileIdentity, clock(), clock());
      if (claim && claim.actor_key !== actorKey) throw new Error('file_conflict');
    },
  };
}
export async function verifyLockedSnapshot<T>(
  held: HeldMediaFence,
  inspect: () => Promise<{ digest: string }>,
  verify: () => Promise<T>,
  commit: (result: T) => void,
): Promise<T> {
  await held.validate();
  const before = await inspect();
  const result = await verify();
  const after = await inspect();
  if (before.digest !== after.digest) throw new Error('revision_conflict');
  await held.validate();
  held.assertHeld();
  commit(result);
  return result;
}

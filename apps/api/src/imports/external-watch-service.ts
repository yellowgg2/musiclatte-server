import { randomUUID } from 'node:crypto';
import { constants, lstatSync } from 'node:fs';
import { open } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import type { ManagementDatabase } from '../storage/database.js';
import {
  createExternalWatchRepository,
  type ExternalFileFingerprint,
} from '../storage/external-watch-repository.js';
import { resolveFileKey } from './file-keys.js';
import { createMp3Inspector } from './mp3-inspector.js';

interface ExpectedOwner {
  libraryId: string;
  accountDirectory: string;
  username: string;
}

function fingerprint(stat: BigIntStats): ExternalFileFingerprint {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    linkCount: Number(stat.nlink),
  };
}

function sameFingerprint(stat: BigIntStats, expected: ExternalFileFingerprint | null): boolean {
  return expected !== null && JSON.stringify(fingerprint(stat)) === JSON.stringify(expected);
}

export function createExternalWatchService(options: {
  database: ManagementDatabase;
  musicRoot: string;
  ffprobe: string;
  timeoutMs: number;
  clock: () => number;
  workerId: string;
  instanceId: string;
  policyRevision: number;
  expectedOwners: readonly ExpectedOwner[];
  settleMs?: number;
  leaseDurationMs?: number;
  checkpoint?: (stage: string, path: string) => void;
}) {
  const repository = createExternalWatchRepository({
    database: options.database,
    clock: options.clock,
  });
  const inspector = createMp3Inspector({
    ffprobe: options.ffprobe,
    cwd: options.musicRoot,
    timeoutMs: options.timeoutMs,
  });
  const settleMs = options.settleMs ?? 10_000;
  const leaseDurationMs = options.leaseDurationMs ?? 30_000;
  const finish = (
    observation: ReturnType<typeof repository.getObservation> & {},
    failureCode: string | null,
    delay: number,
    state: 'settling' | 'rejected' = 'settling',
  ) =>
    repository.finishClaim({
      libraryId: observation.libraryId,
      relativeFileKey: observation.relativeFileKey,
      workerId: options.workerId,
      generation: observation.generation,
      state,
      failureCode,
      nextAttemptAt: options.clock() + delay,
    });
  return {
    async runOnce(signal = new AbortController().signal) {
      const owners = repository.readOwners({
        instanceId: options.instanceId,
        policyRevision: options.policyRevision,
        expected: options.expectedOwners,
      });
      if (owners.status !== 'ready') return 'config_mismatch' as const;
      const observation = repository.claimObservations({
        workerId: options.workerId,
        leaseDurationMs,
        states: ['settling'],
        limit: 1,
      })[0];
      if (!observation) return 'idle' as const;
      const stableSince = observation.stableSinceAt;
      if (
        stableSince === null ||
        observation.lastSeenAt <= stableSince ||
        options.clock() - stableSince < settleMs
      ) {
        finish(observation, null, 5_000);
        return 'deferred' as const;
      }
      let path: string | undefined;
      let file;
      try {
        path = resolveFileKey(options.musicRoot, observation.relativeFileKey);
        const before = lstatSync(path, { bigint: true });
        file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const opened = await file.stat({ bigint: true });
        if (
          !opened.isFile() ||
          opened.size === 0n ||
          opened.size > 1_099_511_627_776n ||
          opened.nlink !== 1n ||
          before.dev !== opened.dev ||
          before.ino !== opened.ino ||
          !sameFingerprint(opened, observation.fingerprint)
        )
          throw new Error('file_changed');
        const audio = await inspector.inspect(file, signal);
        if (!audio.valid) throw new Error('invalid_media');
        options.checkpoint?.('before-admission', path);
        const after = await file.stat({ bigint: true });
        const visible = lstatSync(resolveFileKey(options.musicRoot, observation.relativeFileKey), {
          bigint: true,
        });
        if (
          !sameFingerprint(after, observation.fingerprint) ||
          !sameFingerprint(visible, observation.fingerprint) ||
          opened.dev !== after.dev ||
          opened.ino !== after.ino ||
          opened.dev !== visible.dev ||
          opened.ino !== visible.ino
        )
          throw new Error('file_changed');
        const admitted = repository.admitExternal({
          libraryId: observation.libraryId,
          relativeFileKey: observation.relativeFileKey,
          accountDirectory: observation.accountDirectory,
          identityKey: observation.identityKey,
          instanceId: options.instanceId,
          policyRevision: options.policyRevision,
          workerId: options.workerId,
          generation: observation.generation,
          fingerprint: observation.fingerprint!,
          eventId: randomUUID(),
          mediaLinkId: randomUUID(),
        });
        return admitted.status;
      } catch (error) {
        if (signal.aborted) throw error;
        const failureCode =
          error instanceof Error && error.message === 'file_changed'
            ? 'file_changed'
            : 'invalid_media';
        finish(observation, failureCode, failureCode === 'file_changed' ? 5_000 : 30_000);
        return failureCode === 'file_changed' ? ('changed' as const) : ('rejected' as const);
      } finally {
        await file?.close();
      }
    },
  };
}

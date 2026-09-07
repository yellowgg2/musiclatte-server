import type { ManagementDatabase } from '../storage/database.js';
import { createEngineRepository } from '../storage/engine-repository.js';
import { createEngineStore, type EngineFile, type EnginePointer } from './engine-store.js';
import { createEngineUpdater, type EngineRuntime } from './updater.js';
import { createEngineScheduler, engineFailure } from './scheduler.js';

export interface EngineLease {
  readonly version: string;
  readonly executable: string;
  release(): void;
}
export interface EngineProviderOptions extends EngineRuntime {
  database: ManagementDatabase;
  clock: () => number;
  root: string;
  seed: EngineFile & { executable: string };
}
/** Deployment initializes this provider; API/readiness and stored-media playback do not depend on it. */
export function createEngineProvider(options: EngineProviderOptions) {
  const store = createEngineStore(options.root);
  const repository = createEngineRepository(options);
  const updater = createEngineUpdater(store, options);
  const scheduler = createEngineScheduler({ repository, store, updater });
  const leases = new Map<string, number>();
  const pointer = () => {
    const value = store.readPointer();
    if (!value) throw new Error('invalid_engine');
    return value;
  };
  const lease = (): EngineLease => {
    const active = pointer().active;
    const executable = store.executable(active);
    store.inspect(executable, active.hash);
    leases.set(executable, (leases.get(executable) ?? 0) + 1);
    let released = false;
    return Object.freeze({
      version: active.version,
      executable,
      release() {
        if (released) return;
        released = true;
        const remaining = (leases.get(executable) ?? 1) - 1;
        if (remaining) leases.set(executable, remaining);
        else leases.delete(executable);
        // No version GC: another process may still own an executable lease.
      },
    });
  };
  const commit = (token: string, value: EnginePointer) => {
    repository.assertOwned(token);
    store.writePointer(value);
    repository.reconcile(token, value);
  };
  return {
    ...scheduler,
    async initialize() {
      const token = repository.claim('use');
      if (!token) throw new Error('engine_busy');
      const oldCandidate = repository.get().candidateKey;
      try {
        let current = store.readPointer();
        if (!current) {
          // A missing committed pointer is not permission to replace an existing active engine.
          const existing = repository.get().activeVersion;
          if (existing !== null) throw new Error('invalid_executable');
          const seed = store.installSeed(options.seed);
          await updater.basic(store.executable(seed), seed);
          current = { active: seed, previous: null, status: 'never_checked' };
          commit(token, current);
        } else {
          store.inspect(store.executable(current.active), current.active.hash);
          repository.reconcile(token, current);
        }
        if (oldCandidate && repository.get().candidateKey === null)
          store.removeCandidate(oldCandidate);
      } finally {
        repository.unlock(token);
      }
    },
    async acquire(sourceId?: string, signal?: AbortSignal): Promise<EngineLease> {
      if (sourceId !== undefined && !/^[A-Za-z0-9_-]{11}$/.test(sourceId))
        throw new Error('invalid_source');
      signal?.throwIfAborted();
      if (sourceId !== undefined && repository.get().candidateVersion !== null) {
        const token = repository.claim('use');
        if (token) {
          const state = repository.get();
          let committed = false;
          try {
            if (!state.candidateKey || !state.candidateVersion || !state.candidateHash)
              throw new Error('invalid_executable');
            const candidate = {
              key: state.candidateKey,
              version: state.candidateVersion,
              hash: state.candidateHash,
            };
            await updater.validateCandidate(candidate, sourceId, signal);
            signal?.throwIfAborted();
            repository.assertOwned(token);
            const active = store.promote(candidate);
            const previous = pointer().active;
            // Once rename succeeds the manifest is authoritative even if the DB write fails.
            const next: EnginePointer = { active, previous, status: 'active' };
            store.writePointer(next);
            committed = true;
            repository.reconcile(token, next);
          } catch (error) {
            if (committed) throw error;
            repository.assertOwned(token);
            const visible = pointer();
            if (
              visible.active.version === state.candidateVersion &&
              visible.active.hash === state.candidateHash
            ) {
              // Rename can succeed before directory fsync fails. Reconcile the visible commit,
              // but surface uncertainty rather than pretending this item fell back to old active.
              store.inspect(store.executable(visible.active), visible.active.hash);
              repository.reconcile(token, visible);
              throw new Error('activation_failed');
            }
            if (!signal?.aborted)
              repository.fail(
                token,
                'validation_failed',
                engineFailure(error, 'activation_failed'),
              );
          } finally {
            try {
              if (state.candidateKey && repository.get().candidateKey !== state.candidateKey)
                store.removeCandidate(state.candidateKey);
            } finally {
              repository.unlock(token);
            }
          }
        }
      }
      signal?.throwIfAborted();
      return lease();
    },
    async restorePrevious(expected?: { activeVersion: string; previousVersion: string | null }) {
      const token = repository.claim('use');
      if (!token) throw new Error('engine_busy');
      const oldCandidate = repository.get().candidateKey;
      try {
        const current = pointer();
        if (expected) {
          if (
            current.active.version === expected.previousVersion &&
            current.previous?.version === expected.activeVersion &&
            current.status === 'restored'
          ) {
            repository.reconcile(token, current);
            return repository.get();
          }
          if (
            current.active.version !== expected.activeVersion ||
            current.previous?.version !== expected.previousVersion
          )
            throw new Error('engine_selection_changed');
        }
        if (!current.previous) throw new Error('no_previous_engine');
        await updater.basic(store.executable(current.previous), current.previous);
        commit(token, { active: current.previous, previous: current.active, status: 'restored' });
        if (oldCandidate) store.removeCandidate(oldCandidate);
        return repository.get();
      } finally {
        repository.unlock(token);
      }
    },
  };
}

export type EngineProvider = ReturnType<typeof createEngineProvider>;

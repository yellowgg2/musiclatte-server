import type {
  EngineActionRequest,
  EngineStatusResponse,
  FeatureCapability,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { importHeartbeatMaxAgeMs, type ImportOptions } from '../imports/import-service.js';
import { createEngineRepository } from '../storage/engine-repository.js';
import { createEngineRequestRepository } from '../storage/engine-request-repository.js';
import { createWorkerStateRepository } from '../storage/worker-state-repository.js';

type Verified = Awaited<ReturnType<SessionService['verify']>>;
function workerAvailable(options: ImportOptions) {
  const worker = createWorkerStateRepository(options).get();
  const age = worker.heartbeatAt === null ? -1 : options.clock() - worker.heartbeatAt;
  return age >= 0 && age < importHeartbeatMaxAgeMs && ['idle', 'working'].includes(worker.status);
}
function failedRestore(options: ImportOptions) {
  const request = createEngineRequestRepository(options).get();
  const state = createEngineRepository(options).get();
  return (
    request?.action === 'restore_previous' &&
    request.status === 'failed' &&
    request.activeVersion === state.activeVersion &&
    request.previousVersion === state.previousVersion
  );
}
export function engineCapability(
  options: ImportOptions | undefined,
  identity: Verified['identity'],
): FeatureCapability {
  const supported = options?.policy.enabled === true;
  const allowed =
    supported && identity.adminRole && options.policy.engineManagers.includes(identity.username);
  if (!allowed) return { supported, permission: 'denied', availability: 'available' };
  const state = createEngineRepository(options).get();
  const available =
    workerAvailable(options) &&
    state.activeVersion !== null &&
    !['update_failed', 'validation_failed'].includes(state.status) &&
    !failedRestore(options);
  return {
    supported: true,
    permission: 'allowed',
    availability: available ? 'available' : 'temporarily_unavailable',
  };
}
export function createEngineService(service: SessionService) {
  const authorize = (verified: Verified) => {
    const options = service.options.imports;
    if (
      !options?.policy.enabled ||
      !verified.identity.adminRole ||
      !options.policy.engineManagers.includes(verified.identity.username)
    )
      throw new ApiError(403, 'forbidden');
    service.find(verified.session.token, verified.session.scheme);
    return options;
  };
  const project = (options: ImportOptions): EngineStatusResponse => {
    const state = createEngineRepository(options).get();
    return {
      schemaVersion: 1,
      channel: 'nightly',
      activeVersion: state.activeVersion,
      candidateVersion: state.candidateVersion,
      previousVersion: state.previousVersion,
      lastCheckedAt: state.lastCheckedAt,
      lastSuccessfulCheckAt: state.lastCheckSucceededAt,
      status: state.status,
      recoverability: !state.previousVersion
        ? 'no_previous'
        : !failedRestore(options) &&
            workerAvailable(options) &&
            !(state.operationExpiresAt !== null && state.operationExpiresAt > options.clock())
          ? 'available'
          : 'temporarily_unavailable',
    };
  };
  return {
    get(verified: Verified) {
      return project(authorize(verified));
    },
    request(verified: Verified, input: EngineActionRequest) {
      const options = authorize(verified);
      if (!workerAvailable(options) || createEngineRepository(options).get().activeVersion === null)
        throw new ApiError(503, 'upstream_unavailable');
      try {
        createEngineRequestRepository(options).request(input.action);
      } catch (error) {
        if (error instanceof Error && error.message === 'engine_conflict')
          throw new ApiError(409, 'conflict');
        if (error instanceof Error && error.message === 'engine_unavailable')
          throw new ApiError(503, 'upstream_unavailable');
        throw error;
      }
      return project(options);
    },
  };
}

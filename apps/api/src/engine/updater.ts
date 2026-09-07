import { dirname } from 'node:path';
import { decodeSourceMetadata } from '../imports/downloader.js';
import { runProcess } from '../imports/process-runner.js';
import { parseYouTubeSource } from '../imports/source-url.js';
import {
  type EngineCandidate,
  type EngineFile,
  type EngineStore,
  validateEngineVersion,
} from './engine-store.js';

export interface EngineRuntime {
  ffmpeg: string;
  node: string;
  timeoutMs?: number;
}
/** Only a copied standalone binary receives the fixed nightly self-update command. */
export function createEngineUpdater(store: EngineStore, runtime: EngineRuntime) {
  const timeoutMs = runtime.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000)
    throw new Error('invalid_engine_config');
  const execute = async (
    executable: string,
    args: string[],
    cwd: string,
    code: string,
    signal?: AbortSignal,
  ) => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    try {
      const result = await runProcess({
        executable,
        args,
        cwd,
        allowedCwds: [cwd],
        signal: signal ? AbortSignal.any([timeout.signal, signal]) : timeout.signal,
        env: {
          PATH: `${dirname(runtime.ffmpeg)}:${dirname(runtime.node)}:/usr/bin:/bin`,
          LANG: 'C.UTF-8',
        },
        limits: { stdoutBytes: 1024 * 1024, stderrBytes: 128 * 1024, graceMs: 50 },
      });
      if (result.exitCode !== 0 || result.signal !== null) throw new Error();
      return result.stdout;
    } catch {
      throw new Error(code);
    } finally {
      clearTimeout(timer);
    }
  };
  const basic = async (executable: string, expected: EngineFile, signal?: AbortSignal) => {
    store.inspect(executable, expected.hash);
    const cwd = dirname(executable);
    const version = validateEngineVersion(
      (
        await execute(executable, ['--ignore-config', '--version'], cwd, 'invalid_version', signal)
      ).trim(),
    );
    if (version !== expected.version) throw new Error('invalid_version');
    const ffmpeg = await execute(runtime.ffmpeg, ['-version'], cwd, 'dependency_failed', signal);
    const node = await execute(runtime.node, ['--version'], cwd, 'dependency_failed', signal);
    if (!/^ffmpeg version\s+\S+/.test(ffmpeg) || !/^v\d+\.\d+\.\d+\s*$/.test(node))
      throw new Error('dependency_failed');
    store.inspect(executable, expected.hash);
  };
  return {
    basic,
    async prepareCandidate(
      active: EngineFile,
      signal?: AbortSignal,
    ): Promise<EngineCandidate | null> {
      const temporary = store.copyCandidate(active);
      let retained = false;
      try {
        await execute(
          temporary.path,
          ['--ignore-config', '--update-to', 'nightly'],
          dirname(temporary.path),
          'update_failed',
          signal,
        );
        const hash = store.inspect(temporary.path).hash;
        const version = validateEngineVersion(
          (
            await execute(
              temporary.path,
              ['--ignore-config', '--version'],
              dirname(temporary.path),
              'invalid_version',
              signal,
            )
          ).trim(),
        );
        if (version === active.version) return null;
        const candidate = { version, hash, key: temporary.key };
        await basic(temporary.path, candidate, signal);
        store.persistCandidate(candidate);
        retained = true;
        return candidate;
      } finally {
        if (!retained) store.removeCandidate(temporary.key);
      }
    },
    async validateCandidate(candidate: EngineCandidate, sourceId: string, signal?: AbortSignal) {
      const { canonicalUrl } = parseYouTubeSource(`https://www.youtube.com/watch?v=${sourceId}`);
      const executable = store.candidatePath(candidate.key);
      await basic(executable, candidate, signal);
      const raw = await execute(
        executable,
        [
          '--ignore-config',
          '--no-plugin-dirs',
          '--no-playlist',
          '--skip-download',
          '--no-cache-dir',
          '--no-js-runtimes',
          '--js-runtimes',
          `node:${runtime.node}`,
          '--dump-single-json',
          '--',
          canonicalUrl,
        ],
        dirname(executable),
        'source_probe_failed',
        signal,
      );
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error('source_probe_failed');
      }
      if (!data || typeof data !== 'object' || !('id' in data) || data.id !== sourceId)
        throw new Error('source_mismatch');
      try {
        decodeSourceMetadata(raw, sourceId);
      } catch {
        throw new Error('source_probe_failed');
      }
      store.inspect(executable, candidate.hash);
    },
  };
}
export type EngineUpdater = ReturnType<typeof createEngineUpdater>;

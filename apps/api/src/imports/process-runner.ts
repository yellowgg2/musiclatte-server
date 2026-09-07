import { spawn } from 'node:child_process';
import { fstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export interface ProcessOptions {
  executable: string;
  args: readonly string[];
  cwd: string;
  allowedCwds: readonly string[];
  env?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  /** An already opened regular audio file for ffprobe pipe input. */
  stdinFd?: number;
  limits: { stdoutBytes: number; stderrBytes: number; graceMs: number };
  jobId?: string;
  itemId?: string;
  logger?: (event: Record<string, string>) => void;
}
export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/** Operator-owned executable/cwd only; callers supply user text exclusively as argv values. */
export async function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  let cwd: string;
  try {
    if (
      process.platform === 'win32' ||
      !isAbsolute(options.executable) ||
      options.executable.includes('\0') ||
      !isAbsolute(options.cwd)
    )
      throw new Error();
    if (
      options.stdinFd !== undefined &&
      (!Number.isInteger(options.stdinFd) || !fstatSync(options.stdinFd).isFile())
    )
      throw new Error();
    cwd = realpathSync(options.cwd);
    if (
      !statSync(cwd).isDirectory() ||
      !options.allowedCwds.some((path) => isAbsolute(path) && realpathSync(path) === cwd)
    )
      throw new Error();
    if (
      !Array.isArray(options.args) ||
      options.args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))
    )
      throw new Error();
    for (const [key, value] of Object.entries(options.env ?? {}))
      if (
        !['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].includes(key) ||
        typeof value !== 'string' ||
        value.includes('\0')
      )
        throw new Error();
    for (const limit of [options.limits.stdoutBytes, options.limits.stderrBytes])
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16 * 1024 * 1024) throw new Error();
    if (
      !Number.isSafeInteger(options.limits.graceMs) ||
      options.limits.graceMs < 1 ||
      options.limits.graceMs > 10_000
    )
      throw new Error();
    for (const id of [options.jobId, options.itemId])
      if (
        id !== undefined &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      )
        throw new Error();
  } catch {
    throw new Error('invalid_process');
  }
  const emit = (stage: string, failureCode?: string) => {
    const event: Record<string, string> = { stage };
    if (failureCode) event.failureCode = failureCode;
    if (options.jobId) event.jobId = options.jobId;
    if (options.itemId) event.itemId = options.itemId;
    // Observability must not interrupt process ownership or cleanup.
    try {
      options.logger?.(event);
    } catch {
      /* logger isolation */
    }
  };
  if (options.signal?.aborted) throw new Error('process_aborted');
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let failure: string | undefined;
    let closed = false;
    let forced = false;
    let timer: NodeJS.Timeout | undefined;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    const child = spawn(options.executable, [...options.args], {
      cwd,
      env: { ...options.env },
      shell: false,
      detached: true,
      stdio: [options.stdinFd ?? 'ignore', 'pipe', 'pipe'],
    });
    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure = 'process_cleanup_failed';
      }
    };
    const finish = () => {
      if (!closed || (failure && timer && !forced)) return;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) {
        emit('failed', failure);
        reject(new Error(failure));
      } else {
        emit('exited');
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          exitCode,
          signal: exitSignal,
        });
      }
    };
    const stop = (code: string) => {
      if (failure) return;
      failure = code;
      killGroup('SIGTERM');
      // Do not clear on leader exit: descendants can survive TERM or close inherited pipes.
      timer = setTimeout(() => {
        killGroup('SIGKILL');
        forced = true;
        finish();
      }, options.limits.graceMs);
    };
    const abort = () => stop('process_aborted');
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout!.on('data', (chunk: Buffer) => {
      if (failure) return;
      outBytes += chunk.length;
      if (outBytes > options.limits.stdoutBytes) stop('process_output_limit');
      else stdout.push(chunk);
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      if (failure) return;
      errBytes += chunk.length;
      if (errBytes > options.limits.stderrBytes) stop('process_output_limit');
      else stderr.push(chunk);
    });
    child.on('error', () => stop('process_spawn_failed'));
    child.on('exit', () => {
      if (!child.pid || failure) return;
      try {
        process.kill(-child.pid, 0);
        stop('process_cleanup_failed');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') stop('process_cleanup_failed');
      }
    });
    child.on('close', (code, signal) => {
      closed = true;
      exitCode = code;
      exitSignal = signal;
      finish();
    });
    emit('started');
  });
}

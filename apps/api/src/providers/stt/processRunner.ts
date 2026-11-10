import { spawn } from 'node:child_process';

/**
 * Minimal, injectable child-process runner.
 *
 * Commands always run with an argument array and `shell: false`, so paths and
 * values are never interpreted by a shell. Tests replace this with a fake
 * runner; nothing in the test suite needs ffmpeg or whisper.cpp installed.
 */

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

export interface ProcessOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

export type ProcessRunner = (command: string, args: readonly string[], options: ProcessOptions) => Promise<ProcessResult>;

/** The command could not be started at all (e.g. `ENOENT`, `EACCES`). */
export class ProcessSpawnError extends Error {
  override readonly name = 'ProcessSpawnError';

  constructor(
    readonly command: string,
    readonly code: string,
  ) {
    super(`Could not start ${command} (${code})`);
  }
}

/** Keep at most this much output per stream; whisper progress can be chatty. */
const MAX_CAPTURE_BYTES = 1024 * 1024;

export const spawnProcess: ProcessRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({ exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, aborted: true });
      return;
    }

    const child = spawn(command, [...args], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const capture = (current: string, chunk: Buffer) =>
      current.length >= MAX_CAPTURE_BYTES ? current : current + chunk.toString('utf8').slice(0, MAX_CAPTURE_BYTES - current.length);
    child.stdout.on('data', (chunk: Buffer) => (stdout = capture(stdout, chunk)));
    child.stderr.on('data', (chunk: Buffer) => (stderr = capture(stderr, chunk)));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    const onAbort = () => {
      aborted = true;
      child.kill('SIGKILL');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ProcessSpawnError(command, error.code ?? 'UNKNOWN'));
    });
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ exitCode, signal, stdout, stderr, timedOut, aborted });
    });
  });

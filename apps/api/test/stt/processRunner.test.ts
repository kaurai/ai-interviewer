import { describe, expect, it } from 'vitest';
import { ProcessSpawnError, spawnProcess } from '../../src/providers/stt/processRunner';

/**
 * Exercises the real runner with the Node binary that runs the tests, not with
 * ffmpeg or whisper.cpp.
 */
describe('spawnProcess', () => {
  it('passes arguments literally, never through a shell', async () => {
    const hostile = '$(echo pwned); `id` && echo nope';
    const result = await spawnProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', hostile], { timeoutMs: 10_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(hostile);
  });

  it('reports a missing binary as ProcessSpawnError ENOENT', async () => {
    const error = await spawnProcess('/definitely/not/a/real/binary', [], { timeoutMs: 1000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProcessSpawnError);
    expect((error as ProcessSpawnError).code).toBe('ENOENT');
  });

  it('kills a process that exceeds its timeout', async () => {
    const result = await spawnProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('kills a process when the caller aborts', async () => {
    const controller = new AbortController();
    const pending = spawnProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    const result = await pending;
    expect(result.aborted).toBe(true);
  });
});

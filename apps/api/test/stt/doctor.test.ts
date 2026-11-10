import { describe, expect, it } from 'vitest';
import { formatDoctorReport, runSttDoctor } from '../../src/diagnostics/sttDoctor';
import type { FetchLike } from '../../src/providers/stt/elevenlabs';
import { ProcessSpawnError, type ProcessRunner } from '../../src/providers/stt/processRunner';
import type { WhisperFs } from '../../src/providers/stt/whisperLocal';
import { TEST_API_KEY } from './helpers';

const noNetwork: FetchLike = async () => {
  throw new Error('doctor must not call the network');
};

function fakeFs(existing: Set<string>): WhisperFs {
  const unused = async () => {
    throw new Error('not used by readiness');
  };
  return {
    mkdtemp: unused,
    writeFile: unused,
    readFile: unused,
    rm: unused,
    stat: async (file) => {
      if (!existing.has(file)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { isFile: () => true, size: 487_000_000 };
    },
  };
}

/** `missing` lists commands that fail to spawn. */
function runner(missing: string[] = []): ProcessRunner {
  return async (command) => {
    if (missing.includes(command)) throw new ProcessSpawnError(command, 'ENOENT');
    return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, aborted: false };
  };
}

describe('npm run doctor (STT)', () => {
  it('reports readiness per provider without printing the key or calling the network', async () => {
    const report = await runSttDoctor({
      env: { ELEVENLABS_API_KEY: TEST_API_KEY, WHISPER_MODEL_PATH: '/models/ggml-small.en.bin' },
      baseDir: '/repo',
      nodeVersion: '22.12.0',
      deps: { fetch: noNetwork, runProcess: runner(['ffmpeg']), fs: fakeFs(new Set(['/models/ggml-small.en.bin'])) },
    });
    const output = formatDoctorReport(report);

    expect(report.passed).toBe(true);
    expect(output).not.toContain(TEST_API_KEY);
    expect(output).toContain('[OK]   primary elevenlabs - API key set');
    expect(output).toMatch(/\[WARN\] fallback whisper-local - ffmpeg not runnable at "ffmpeg" \(ENOENT\)/);
    expect(output).toContain('[SKIP] ElevenLabs network probe');
    expect(output).toContain('[OK]   Voice answers can be transcribed');
  });

  it('warns, but does not fail, when no provider is ready', async () => {
    const report = await runSttDoctor({
      env: {},
      baseDir: '/repo',
      nodeVersion: '22.12.0',
      deps: { fetch: noNetwork, runProcess: runner(['ffmpeg', 'whisper-cli']), fs: fakeFs(new Set()) },
    });
    const output = formatDoctorReport(report);
    expect(report.passed).toBe(true);
    expect(output).toContain('[WARN] primary elevenlabs - ELEVENLABS_API_KEY is not set');
    expect(output).toContain('WHISPER_MODEL_PATH');
    expect(output).toContain('[WARN] No STT provider is ready - Typed answers still work');
  });

  it('fails on invalid configuration and unsupported Node', async () => {
    const report = await runSttDoctor({ env: { STT_PROVIDER: 'nope' }, nodeVersion: '20.11.0', deps: { fetch: noNetwork } });
    expect(report.passed).toBe(false);
    const output = formatDoctorReport(report);
    expect(output).toContain('[FAIL] Node.js 20.11.0');
    expect(output).toContain('[FAIL] Configuration - STT_PROVIDER must be one of');
  });

  it('flags placeholder keys and English-only model/language mismatches', async () => {
    const report = await runSttDoctor({
      env: { ELEVENLABS_API_KEY: 'your-elevenlabs-key', WHISPER_LANGUAGE: 'de', WHISPER_MODEL_PATH: '/m/ggml-small.en.bin' },
      nodeVersion: '22.12.0',
      deps: { fetch: noNetwork, runProcess: runner(), fs: fakeFs(new Set(['/m/ggml-small.en.bin'])) },
    });
    const output = formatDoctorReport(report);
    expect(output).toContain('looks like a placeholder');
    expect(output).toContain('ggml-small.en.bin is English-only');
    expect(output).not.toContain('your-elevenlabs-key');
  });
});

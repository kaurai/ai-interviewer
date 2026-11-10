import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFfmpegArgs } from '../../src/providers/stt/audioConversion';
import { STTError } from '../../src/providers/stt/errors';
import { ProcessSpawnError, type ProcessResult, type ProcessRunner } from '../../src/providers/stt/processRunner';
import { buildWhisperArgs, createWhisperLocalProvider, parseWhisperJson, type WhisperLocalConfig } from '../../src/providers/stt/whisperLocal';
import { makeRequest } from './helpers';

/**
 * These tests use the real filesystem (in a private temp root) to prove the
 * provider cleans up, but a fake process runner: ffmpeg and whisper.cpp are
 * never required or executed.
 */

const WHISPER_JSON = JSON.stringify({
  result: { language: 'en' },
  transcription: [
    { offsets: { from: 0, to: 2100 }, text: ' Um, I would shard by tenant' },
    { offsets: { from: 2100, to: 3000 }, text: ' [BLANK_AUDIO]' },
    { offsets: { from: 3000, to: 5250 }, text: '  and cache hot keys. ' },
  ],
});

let root: string;
let tmpRoot: string;
let config: WhisperLocalConfig;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'whisper-test-'));
  tmpRoot = path.join(root, 'tmp');
  await mkdir(tmpRoot);
  const modelPath = path.join(root, 'ggml-small.en.bin');
  await writeFile(modelPath, 'fake model');
  config = {
    cliPath: '/opt/whisper/whisper-cli',
    modelPath,
    ffmpegPath: '/opt/ffmpeg/ffmpeg',
    language: 'en',
    threads: undefined,
    timeoutMs: 1000,
    ffmpegTimeoutMs: 500,
    maxDurationSeconds: 60,
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ok = (overrides: Partial<ProcessResult> = {}): ProcessResult => ({
  exitCode: 0,
  signal: null,
  stdout: '',
  stderr: '',
  timedOut: false,
  aborted: false,
  ...overrides,
});

interface Call {
  command: string;
  args: readonly string[];
}

/** Fake runner: ffmpeg "converts" by copying; whisper writes the JSON fixture. */
function fakeRunner(options: { ffmpeg?: ProcessResult | Error; whisper?: ProcessResult | Error; whisperJson?: string | null } = {}) {
  const calls: Call[] = [];
  const inputsSeen: Uint8Array[] = [];
  const runner: ProcessRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === config.ffmpegPath) {
      if (options.ffmpeg instanceof Error) throw options.ffmpeg;
      const input = args[args.indexOf('-i') + 1]!;
      inputsSeen.push(new Uint8Array(await readFile(input)));
      await writeFile(args[args.length - 1]!, 'RIFF....WAVE');
      return options.ffmpeg ?? ok();
    }
    if (options.whisper instanceof Error) throw options.whisper;
    const outputBase = args[args.indexOf('-of') + 1]!;
    if (options.whisperJson !== null) await writeFile(`${outputBase}.json`, options.whisperJson ?? WHISPER_JSON);
    return options.whisper ?? ok();
  };
  return { runner, calls, inputsSeen };
}

const tmpEntries = () => readdir(tmpRoot);

function provider(runner: ProcessRunner, overrides: Partial<WhisperLocalConfig> = {}) {
  return createWhisperLocalProvider({ ...config, ...overrides }, { runProcess: runner, tmpDir: () => tmpRoot });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(STTError);
  expect((error as STTError).code).toBe(code);
}

describe('whisper.cpp invocation', () => {
  it('normalizes through ffmpeg, then runs whisper-cli with argument arrays', async () => {
    const { runner, calls, inputsSeen } = fakeRunner();
    const result = await provider(runner).transcribe(makeRequest({ audio: new Uint8Array([5, 6, 7]), mimeType: 'audio/ogg' }));

    expect(calls.map((c) => c.command)).toEqual([config.ffmpegPath, config.cliPath]);
    const [ffmpeg, whisper] = calls as [Call, Call];

    // ffmpeg: decode the browser container into mono 16 kHz PCM WAV, capped at the limit.
    const input = ffmpeg.args[ffmpeg.args.indexOf('-i') + 1]!;
    const wav = ffmpeg.args[ffmpeg.args.length - 1]!;
    expect(path.basename(input)).toBe('input.ogg');
    expect(ffmpeg.args).toEqual(buildFfmpegArgs(input, wav, 60));
    expect(ffmpeg.args.join(' ')).toContain('-ac 1 -ar 16000 -c:a pcm_s16le -f wav');
    expect(ffmpeg.args.join(' ')).toContain('-t 60');
    expect(inputsSeen[0]).toEqual(new Uint8Array([5, 6, 7]));

    // whisper-cli: model, normalized wav, language, JSON output.
    expect(whisper.args.slice(0, 6)).toEqual(['-m', config.modelPath, '-f', wav, '-l', 'en']);
    expect(whisper.args).toContain('-oj');
    expect(whisper.args).not.toContain('-t');

    expect(result.text).toBe('Um, I would shard by tenant and cache hot keys.');
    expect(result.languageCode).toBe('en');
    expect(result.segments).toEqual([
      { text: 'Um, I would shard by tenant', startSeconds: 0, endSeconds: 2.1 },
      { text: 'and cache hot keys.', startSeconds: 3, endSeconds: 5.25 },
    ]);
  });

  it('passes the optional thread count', () => {
    expect(buildWhisperArgs({ ...config, threads: 4 }, '/t/a.wav', '/t/out')).toEqual(
      ['-m', config.modelPath, '-f', '/t/a.wav', '-l', 'en', '-oj', '-of', '/t/out', '-np', '-t', '4'],
    );
  });

  it('removes the temp directory after success', async () => {
    const { runner } = fakeRunner();
    await provider(runner).transcribe(makeRequest());
    expect(await tmpEntries()).toEqual([]);
  });
});

describe('whisper.cpp failures and cleanup', () => {
  it('reports a missing model as not_configured without spawning anything', async () => {
    const { runner, calls } = fakeRunner();
    await expectCode(provider(runner, { modelPath: path.join(root, 'missing.bin') }).transcribe(makeRequest()), 'not_configured');
    expect(calls).toHaveLength(0);
  });

  it('maps a missing ffmpeg binary to provider_unavailable and cleans up', async () => {
    const { runner } = fakeRunner({ ffmpeg: new ProcessSpawnError(config.ffmpegPath, 'ENOENT') });
    await expectCode(provider(runner).transcribe(makeRequest()), 'provider_unavailable');
    expect(await tmpEntries()).toEqual([]);
  });

  it('maps an ffmpeg decode failure to invalid_audio (no fallback) and cleans up', async () => {
    const { runner, calls } = fakeRunner({ ffmpeg: ok({ exitCode: 1, stderr: 'Invalid data found' }) });
    await expectCode(provider(runner).transcribe(makeRequest()), 'invalid_audio');
    expect(calls).toHaveLength(1);
    expect(await tmpEntries()).toEqual([]);
  });

  it('maps an ffmpeg timeout to timeout', async () => {
    const { runner } = fakeRunner({ ffmpeg: ok({ exitCode: null, timedOut: true, signal: 'SIGKILL' }) });
    await expectCode(provider(runner).transcribe(makeRequest()), 'timeout');
  });

  it('maps a missing whisper-cli to provider_unavailable and cleans up', async () => {
    const { runner } = fakeRunner({ whisper: new ProcessSpawnError(config.cliPath, 'ENOENT') });
    await expectCode(provider(runner).transcribe(makeRequest()), 'provider_unavailable');
    expect(await tmpEntries()).toEqual([]);
  });

  it('maps whisper-cli timeout, crash, and missing output', async () => {
    await expectCode(provider(fakeRunner({ whisper: ok({ exitCode: null, timedOut: true }) }).runner).transcribe(makeRequest()), 'timeout');
    await expectCode(provider(fakeRunner({ whisper: ok({ exitCode: 3 }) }).runner).transcribe(makeRequest()), 'upstream');
    await expectCode(provider(fakeRunner({ whisperJson: null }).runner).transcribe(makeRequest()), 'upstream');
    await expectCode(provider(fakeRunner({ whisperJson: '{not json' }).runner).transcribe(makeRequest()), 'upstream');
    expect(await tmpEntries()).toEqual([]);
  });

  it('maps a cancelled process to aborted', async () => {
    await expectCode(provider(fakeRunner({ whisper: ok({ exitCode: null, aborted: true }) }).runner).transcribe(makeRequest()), 'aborted');
  });
});

describe('whisper JSON parsing', () => {
  it('drops non-speech annotations and yields empty text for silence', () => {
    const silent = parseWhisperJson(JSON.stringify({ result: { language: 'en' }, transcription: [{ text: ' [BLANK_AUDIO]' }] }));
    expect(silent.text).toBe('');
    expect(silent.segments).toEqual([]);
  });

  it('keeps verbal fillers', () => {
    expect(parseWhisperJson(JSON.stringify({ transcription: [{ text: ' Uh, um, yes.' }] })).text).toBe('Uh, um, yes.');
  });
});

describe('whisper readiness', () => {
  it('reports each missing piece', async () => {
    const runner: ProcessRunner = async (command) => {
      throw new ProcessSpawnError(command, 'ENOENT');
    };
    const readiness = await provider(runner, { modelPath: path.join(root, 'nope.bin') }).checkReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.detail).toContain('WHISPER_MODEL_PATH');
    expect(readiness.detail).toContain('ffmpeg not runnable');
    expect(readiness.detail).toContain('whisper-cli not runnable');
  });

  it('is ready when the model exists and both tools start', async () => {
    const readiness = await provider(async () => ok()).checkReadiness();
    expect(readiness).toEqual({ ready: true, detail: 'model ggml-small.en.bin, language en' });
  });
});

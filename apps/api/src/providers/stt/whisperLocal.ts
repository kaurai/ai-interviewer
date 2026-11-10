import * as fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { audioFileExtension } from '@ai-interviewer/shared';
import { convertToWhisperWav } from './audioConversion';
import { STTError } from './errors';
import { ProcessSpawnError, spawnProcess, type ProcessResult, type ProcessRunner } from './processRunner';
import type { ProviderReadiness, STTProvider, TranscriptSegment, TranscriptionRequest, TranscriptionResult } from './types';

/**
 * Local whisper.cpp adapter using the `whisper-cli` binary.
 *
 * Pipeline per request, inside a private temporary directory:
 *   1. write upload bytes to input.<ext>
 *   2. ffmpeg -> audio.wav (mono, 16 kHz, PCM s16le)
 *   3. whisper-cli -m <model> -f audio.wav -oj -of transcript
 *   4. parse transcript.json
 *   5. always delete the directory, on success or failure
 *
 * Nothing is downloaded automatically. Binary and model paths come from
 * configuration; see `npm run doctor`.
 */

export interface WhisperLocalConfig {
  cliPath: string;
  modelPath: string;
  ffmpegPath: string;
  /** Spoken language passed as `-l`. English-only models (`*.en.bin`) need `en`. */
  language: string;
  threads: number | undefined;
  timeoutMs: number;
  ffmpegTimeoutMs: number;
  maxDurationSeconds: number;
}

/** Subset of `node:fs/promises` used here, injectable for tests. */
export interface WhisperFs {
  mkdtemp(prefix: string): Promise<string>;
  writeFile(file: string, data: Uint8Array): Promise<void>;
  readFile(file: string, encoding: 'utf8'): Promise<string>;
  rm(target: string, options: { recursive: true; force: true }): Promise<void>;
  stat(file: string): Promise<{ isFile(): boolean; size: number }>;
}

export interface WhisperLocalDeps {
  runProcess?: ProcessRunner;
  fs?: WhisperFs;
  tmpDir?: () => string;
}

export function buildWhisperArgs(config: WhisperLocalConfig, wavPath: string, outputBase: string): string[] {
  const args = ['-m', config.modelPath, '-f', wavPath, '-l', config.language, '-oj', '-of', outputBase, '-np'];
  if (config.threads !== undefined) args.push('-t', String(config.threads));
  return args;
}

/** whisper.cpp writes these for silence/music; they are not candidate speech. */
const NON_SPEECH_SEGMENT = /^\s*[[(](?:blank_audio|silence|music|noise|inaudible|no speech)[\])]\s*$/i;

interface WhisperJson {
  result?: { language?: unknown };
  transcription?: Array<{ text?: unknown; offsets?: { from?: unknown; to?: unknown } }>;
}

/** Parse whisper-cli `-oj` output. Exported for tests. */
export function parseWhisperJson(raw: string): TranscriptionResult {
  let json: WhisperJson;
  try {
    json = JSON.parse(raw) as WhisperJson;
  } catch {
    throw new STTError('upstream', 'whisper-local', 'whisper-cli produced invalid JSON');
  }
  if (!json || !Array.isArray(json.transcription)) {
    throw new STTError('upstream', 'whisper-local', 'whisper-cli JSON has no transcription array');
  }
  const segments: TranscriptSegment[] = [];
  for (const item of json.transcription) {
    if (typeof item?.text !== 'string') continue;
    const text = item.text.replace(/\s+/g, ' ').trim();
    if (text === '' || NON_SPEECH_SEGMENT.test(text)) continue;
    const fromMs = item.offsets?.from;
    const toMs = item.offsets?.to;
    const from = typeof fromMs === 'number' ? fromMs / 1000 : 0;
    const to = typeof toMs === 'number' ? toMs / 1000 : from;
    segments.push({ text, startSeconds: from, endSeconds: to });
  }
  const language = json.result?.language;
  return {
    text: segments.map((s) => s.text).join(' ').trim(),
    languageCode: typeof language === 'string' && language !== '' ? language : null,
    languageProbability: null,
    words: [],
    segments,
  };
}

export function createWhisperLocalProvider(config: WhisperLocalConfig, deps: WhisperLocalDeps = {}): STTProvider {
  const runProcess = deps.runProcess ?? spawnProcess;
  const fs: WhisperFs = deps.fs ?? fsPromises;
  const tmpDir = deps.tmpDir ?? os.tmpdir;

  async function assertModelPresent(): Promise<void> {
    if (!config.modelPath) throw new STTError('not_configured', 'whisper-local', 'WHISPER_MODEL_PATH is not set');
    try {
      const stat = await fs.stat(config.modelPath);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      throw new STTError('not_configured', 'whisper-local', 'Whisper model file not found; check WHISPER_MODEL_PATH');
    }
  }

  async function transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    await assertModelPresent();
    const dir = await fs.mkdtemp(path.join(tmpDir(), 'ai-interviewer-stt-'));
    try {
      const inputPath = path.join(dir, `input.${audioFileExtension(request.mimeType)}`);
      const wavPath = path.join(dir, 'audio.wav');
      const outputBase = path.join(dir, 'transcript');
      await fs.writeFile(inputPath, request.audio);

      await convertToWhisperWav(runProcess, inputPath, wavPath, {
        ffmpegPath: config.ffmpegPath,
        timeoutMs: config.ffmpegTimeoutMs,
        maxDurationSeconds: config.maxDurationSeconds,
        signal: request.signal,
      });

      let result: ProcessResult;
      try {
        result = await runProcess(config.cliPath, buildWhisperArgs(config, wavPath, outputBase), {
          timeoutMs: config.timeoutMs,
          signal: request.signal,
        });
      } catch (error) {
        if (error instanceof ProcessSpawnError) {
          throw new STTError('provider_unavailable', 'whisper-local', `whisper-cli could not be started (${error.code}); check WHISPER_CLI_PATH`);
        }
        throw error;
      }
      if (result.aborted) throw new STTError('aborted', 'whisper-local', 'Transcription cancelled');
      if (result.timedOut) throw new STTError('timeout', 'whisper-local', `whisper-cli exceeded ${config.timeoutMs} ms`);
      if (result.exitCode !== 0) {
        throw new STTError('upstream', 'whisper-local', 'whisper-cli exited with an error', result.exitCode ?? undefined);
      }

      let json: string;
      try {
        json = await fs.readFile(`${outputBase}.json`, 'utf8');
      } catch {
        throw new STTError('upstream', 'whisper-local', 'whisper-cli did not write transcript.json');
      }
      return parseWhisperJson(json);
    } finally {
      // Raw audio and transcripts must not linger in the temp directory.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Spawn each tool with a harmless flag; any exit code proves it can start. */
  async function probe(command: string, args: string[]): Promise<string | null> {
    try {
      await runProcess(command, args, { timeoutMs: 5000 });
      return null;
    } catch (error) {
      return error instanceof ProcessSpawnError ? error.code : 'UNKNOWN';
    }
  }

  async function checkReadiness(): Promise<ProviderReadiness> {
    const problems: string[] = [];
    try {
      await assertModelPresent();
    } catch (error) {
      problems.push((error as Error).message);
    }
    const ffmpegProblem = await probe(config.ffmpegPath, ['-version']);
    if (ffmpegProblem) problems.push(`ffmpeg not runnable at "${config.ffmpegPath}" (${ffmpegProblem})`);
    const cliProblem = await probe(config.cliPath, ['--help']);
    if (cliProblem) problems.push(`whisper-cli not runnable at "${config.cliPath}" (${cliProblem})`);
    if (problems.length > 0) return { ready: false, detail: problems.join('; ') };
    return { ready: true, detail: `model ${path.basename(config.modelPath)}, language ${config.language}` };
  }

  return { id: 'whisper-local', transcribe, checkReadiness };
}

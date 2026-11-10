import { STTError } from './errors';
import { ProcessSpawnError, type ProcessResult, type ProcessRunner } from './processRunner';

/**
 * whisper.cpp reads 16 kHz mono WAV. Browsers upload WebM/Ogg (Opus) or MP4
 * (AAC), so every upload is normalized through a local ffmpeg binary first,
 * even WAV, which may have the wrong sample rate or channel count.
 */

export interface FfmpegOptions {
  ffmpegPath: string;
  timeoutMs: number;
  /** Hard cap on decoded audio, independent of the client's duration claim. */
  maxDurationSeconds: number;
  signal?: AbortSignal;
}

/** Exported so tests and the workshop can inspect the exact invocation. */
export function buildFfmpegArgs(inputPath: string, outputPath: string, maxDurationSeconds: number): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-i', inputPath,
    '-t', String(maxDurationSeconds),
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'pcm_s16le',
    '-f', 'wav',
    outputPath,
  ];
}

export async function convertToWhisperWav(
  runProcess: ProcessRunner,
  inputPath: string,
  outputPath: string,
  options: FfmpegOptions,
): Promise<void> {
  let result: ProcessResult;
  try {
    result = await runProcess(options.ffmpegPath, buildFfmpegArgs(inputPath, outputPath, options.maxDurationSeconds), {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof ProcessSpawnError) {
      throw new STTError('provider_unavailable', 'whisper-local', `ffmpeg could not be started (${error.code}); check FFMPEG_PATH`);
    }
    throw error;
  }
  if (result.aborted) throw new STTError('aborted', 'whisper-local', 'Audio conversion cancelled');
  if (result.timedOut) throw new STTError('timeout', 'whisper-local', `ffmpeg exceeded ${options.timeoutMs} ms`);
  if (result.exitCode !== 0) {
    // ffmpeg starts fine but cannot decode the input: the upload is the problem.
    throw new STTError('invalid_audio', 'whisper-local', 'ffmpeg could not decode the uploaded audio', result.exitCode ?? undefined);
  }
}

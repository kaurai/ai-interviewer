import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SttConfig } from '../../api/src/config';
import type { SttOrchestrator, TranscriptionOutcome } from '../../api/src/providers/stt/orchestrator';

const AUDIO_TYPES: Readonly<Record<string, string>> = {
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.mp4': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
};

export class AudioAnswerError extends Error {
  override readonly name = 'AudioAnswerError';
}

/** Extension is only a hint; reject files whose container signature disagrees. */
export function hasExpectedAudioSignature(extension: string, data: Uint8Array): boolean {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
  const ascii = (offset: number, length: number) => String.fromCharCode(...data.slice(offset, offset + length));
  switch (extension) {
    case '.wav': return data.byteLength >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
    case '.ogg': return starts(0x4f, 0x67, 0x67, 0x53); // OggS
    case '.webm': return starts(0x1a, 0x45, 0xdf, 0xa3); // EBML
    case '.mp4':
    case '.m4a': return data.byteLength >= 12 && ascii(4, 4) === 'ftyp';
    default: return false;
  }
}

/** Reads PCM WAV duration when the standard RIFF/data headers are present. */
export function wavDurationSeconds(data: Uint8Array): number | null {
  if (data.byteLength < 44) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...data.slice(offset, offset + length));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return null;
  let offset = 12;
  let byteRate: number | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= data.byteLength) {
    const id = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && size >= 16 && offset + 20 <= data.byteLength) byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') { dataBytes = size; break; }
    offset += 8 + size + (size % 2);
  }
  return byteRate && dataBytes !== null ? dataBytes / byteRate : null;
}

export interface TranscribeAudioFileInput {
  filePath: string;
  durationSeconds?: number;
  orchestrator: SttOrchestrator;
  limits: SttConfig['limits'];
  cwd?: string;
}

export async function transcribeAudioFile(input: TranscribeAudioFileInput): Promise<{
  outcome: TranscriptionOutcome;
  durationSeconds: number;
}> {
  const resolved = path.resolve(input.cwd ?? process.cwd(), input.filePath);
  const extension = path.extname(resolved).toLowerCase();
  const mimeType = AUDIO_TYPES[extension];
  if (!mimeType) throw new AudioAnswerError(`Audio must be one of: ${Object.keys(AUDIO_TYPES).join(', ')}.`);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) throw new AudioAnswerError('Audio file was not found.');
  if (info.size === 0) throw new AudioAnswerError('Audio file is empty.');
  if (info.size > input.limits.maxUploadBytes) throw new AudioAnswerError(`Audio exceeds ${input.limits.maxUploadMb} MB.`);
  const bytes = new Uint8Array(await readFile(resolved));
  if (!hasExpectedAudioSignature(extension, bytes)) throw new AudioAnswerError('Audio file content does not match its extension.');
  const measured = extension === '.wav' ? wavDurationSeconds(bytes) : null;
  const durationSeconds = measured ?? input.durationSeconds;
  if (!durationSeconds || durationSeconds <= 0) throw new AudioAnswerError('Provide the recording duration for non-WAV audio.');
  if (durationSeconds > input.limits.maxDurationSeconds) throw new AudioAnswerError(`Audio exceeds ${input.limits.maxDurationSeconds} seconds.`);
  const outcome = await input.orchestrator.transcribe({
    audio: bytes,
    mimeType,
    fileName: `answer${extension === '.m4a' ? '.mp4' : extension}`,
    durationSeconds,
  });
  return { outcome, durationSeconds };
}

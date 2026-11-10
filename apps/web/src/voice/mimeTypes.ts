import { isAllowedAudioMimeType } from '@ai-interviewer/shared';

/**
 * MediaRecorder MIME capability detection.
 *
 * Do not hard-code WebM: Safari records MP4/AAC and may reject WebM. Ask the
 * browser, in preference order, and only offer types the server accepts.
 */
export const PREFERRED_RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/wav',
] as const;

/**
 * First candidate the browser supports, or `undefined` to let the browser pick
 * its default container (the recorder then checks the result is allowed).
 */
export function selectRecordingMimeType(
  isTypeSupported: ((type: string) => boolean) | undefined,
  candidates: readonly string[] = PREFERRED_RECORDING_MIME_TYPES,
): string | undefined {
  if (typeof isTypeSupported !== 'function') return undefined;
  return candidates.find((type) => {
    try {
      return isAllowedAudioMimeType(type) && isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

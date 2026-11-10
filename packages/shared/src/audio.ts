/**
 * Audio upload contract shared by the browser recorder and the API.
 *
 * Browsers disagree about which container MediaRecorder produces: Chrome and
 * Firefox usually record WebM or Ogg (Opus), Safari records MP4 (AAC). The
 * server accepts exactly these base MIME types. Codec parameters such as
 * `;codecs=opus` are stripped before comparison.
 */
export const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
] as const;

export type AllowedAudioMimeType = (typeof ALLOWED_AUDIO_MIME_TYPES)[number];

/** Workshop defaults; the server reads its effective limits from configuration. */
export const DEFAULT_MAX_AUDIO_UPLOAD_MB = 10;
export const DEFAULT_MAX_UTTERANCE_SECONDS = 60;

/** Multipart field names for POST /api/audio/transcribe. */
export const TRANSCRIBE_AUDIO_FIELD = 'audio';
export const TRANSCRIBE_DURATION_FIELD = 'durationSeconds';
export const TRANSCRIBE_ENDPOINT_PATH = '/api/audio/transcribe';

/** `"Audio/WebM; codecs=opus"` -> `"audio/webm"`. Empty input yields `""`. */
export function normalizeAudioMimeType(raw: string | null | undefined): string {
  return (raw ?? '').split(';', 1)[0]!.trim().toLowerCase();
}

export function isAllowedAudioMimeType(raw: string | null | undefined): raw is string {
  return (ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(normalizeAudioMimeType(raw));
}

const EXTENSIONS: Readonly<Record<AllowedAudioMimeType, string>> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

/** File extension for an allowed MIME type, or `"bin"` when unknown. */
export function audioFileExtension(raw: string | null | undefined): string {
  const base = normalizeAudioMimeType(raw);
  return (EXTENSIONS as Record<string, string>)[base] ?? 'bin';
}

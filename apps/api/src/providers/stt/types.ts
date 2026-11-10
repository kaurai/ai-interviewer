/**
 * Speech-to-text provider contract.
 *
 * The voice layer only turns audio into text. Interview logic never imports a
 * concrete provider; it receives normalized text that the candidate can edit
 * before submitting (CONTEXT.md section 3 and 11.1).
 */

export const STT_PROVIDER_IDS = ['elevenlabs', 'whisper-local', 'fake'] as const;
export type SttProviderId = (typeof STT_PROVIDER_IDS)[number];

export interface TranscriptionRequest {
  /** Raw uploaded bytes. Never log or persist these. */
  audio: Uint8Array;
  /** Normalized base MIME type, e.g. `audio/webm` (no codec parameters). */
  mimeType: string;
  /** Safe synthetic filename such as `answer.webm`; never the client's name. */
  fileName: string;
  /** Client-reported duration, already validated against the server limit. */
  durationSeconds: number;
  /** Aborted when the HTTP client disconnects; providers must stop work. */
  signal?: AbortSignal;
}

export interface TranscriptWord {
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
  /** `audio_event` is a non-speech tag such as "(laughter)" when enabled. */
  kind: 'word' | 'audio_event';
  /** Log probability reported by the provider, when available. */
  logprob: number | null;
  speakerId: string | null;
}

export interface TranscriptSegment {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

/** Provider-independent result. Fields a provider cannot supply are null/empty. */
export interface TranscriptionResult {
  text: string;
  languageCode: string | null;
  languageProbability: number | null;
  /** Word timings (ElevenLabs). Empty when the provider has no word data. */
  words: TranscriptWord[];
  /** Segment timings (whisper.cpp). Empty when the provider has no segment data. */
  segments: TranscriptSegment[];
}

export interface ProviderReadiness {
  ready: boolean;
  /** Human-readable and secret-free; safe to print in `npm run doctor`. */
  detail: string;
}

export interface STTProvider {
  readonly id: SttProviderId;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
  /** Local-only checks. Must not spend credits or call a paid API. */
  checkReadiness(): Promise<ProviderReadiness>;
}

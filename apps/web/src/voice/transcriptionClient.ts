import {
  TRANSCRIBE_AUDIO_FIELD,
  TRANSCRIBE_DURATION_FIELD,
  TRANSCRIBE_ENDPOINT_PATH,
  audioFileExtension,
} from '@ai-interviewer/shared';

/**
 * Client for POST /api/audio/transcribe. The endpoint and fetch are
 * injectable: in development Vite proxies `/api` to the API server, and tests
 * pass a fake fetch.
 */

export interface TranscriptionClientOptions {
  /** Full URL or path. Defaults to `/api/audio/transcribe` (same origin). */
  endpoint?: string;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export interface TranscribeInput {
  audio: Blob;
  mimeType: string;
  durationSeconds: number;
  signal?: AbortSignal;
}

export interface TranscriptionSuccess {
  /** Draft text for the candidate to review and edit before submitting. */
  text: string;
  noSpeechDetected: boolean;
  provider: string;
  fallbackUsed: boolean;
  languageCode: string | null;
}

export class TranscriptionClientError extends Error {
  override readonly name = 'TranscriptionClientError';

  constructor(
    /** Server error code (e.g. `stt_quota_exceeded`) or `network` / `timeout` / `aborted` / `bad_response`. */
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** `transcribeEndpoint('http://127.0.0.1:3001')` -> `http://127.0.0.1:3001/api/audio/transcribe`. */
export function transcribeEndpoint(apiBaseUrl = ''): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}${TRANSCRIBE_ENDPOINT_PATH}`;
}

export interface TranscriptionClient {
  transcribe(input: TranscribeInput): Promise<TranscriptionSuccess>;
}

export function createTranscriptionClient(options: TranscriptionClientOptions = {}): TranscriptionClient {
  const endpoint = options.endpoint ?? TRANSCRIBE_ENDPOINT_PATH;
  const fetchImpl = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 60_000;

  return {
    async transcribe({ audio, mimeType, durationSeconds, signal }) {
      const form = new FormData();
      form.append(TRANSCRIBE_AUDIO_FIELD, audio, `answer.${audioFileExtension(mimeType)}`);
      form.append(TRANSCRIBE_DURATION_FIELD, String(durationSeconds));

      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      let response: Response;
      try {
        response = await fetchImpl(endpoint, { method: 'POST', body: form, signal: combined });
      } catch {
        if (signal?.aborted) throw new TranscriptionClientError('aborted', 'Transcription cancelled.', false, null);
        if (timeoutSignal.aborted) throw new TranscriptionClientError('timeout', 'Transcription took too long.', true, null);
        throw new TranscriptionClientError('network', 'Could not reach the server.', true, null);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (!response.ok) {
        const error = (body as { error?: { code?: unknown; message?: unknown; retryable?: unknown } } | null)?.error;
        throw new TranscriptionClientError(
          typeof error?.code === 'string' ? error.code : `http_${response.status}`,
          typeof error?.message === 'string' ? error.message : 'Transcription failed.',
          error?.retryable === true,
          response.status,
        );
      }

      const ok = body as {
        transcript?: { text?: unknown; languageCode?: unknown };
        noSpeechDetected?: unknown;
        provider?: unknown;
        fallback?: { used?: unknown };
      } | null;
      const text = ok?.transcript?.text;
      const provider = ok?.provider;
      const languageCode = ok?.transcript?.languageCode;
      if (typeof text !== 'string' || typeof provider !== 'string') {
        throw new TranscriptionClientError('bad_response', 'The server returned an unexpected response.', true, response.status);
      }
      return {
        text,
        noSpeechDetected: ok?.noSpeechDetected === true,
        provider,
        fallbackUsed: ok?.fallback?.used === true,
        languageCode: typeof languageCode === 'string' ? languageCode : null,
      };
    },
  };
}

import {
  ALLOWED_AUDIO_MIME_TYPES,
  TRANSCRIBE_AUDIO_FIELD,
  TRANSCRIBE_DURATION_FIELD,
  TRANSCRIBE_ENDPOINT_PATH,
  audioFileExtension,
  isAllowedAudioMimeType,
  normalizeAudioMimeType,
} from '@ai-interviewer/shared';
import type { SttConfig } from '../config';
import {
  BodyTooLargeError,
  MULTIPART_OVERHEAD_BYTES,
  MalformedMultipartError,
  UnsupportedContentTypeError,
  parseMultipartForm,
} from '../http/multipart';
import { sendError, sendJson, type ApiErrorBody, type Handler, type Route } from '../http/router';
import { STTError, type SttErrorCode } from '../providers/stt/errors';
import { TranscriptionUnavailableError, type AttemptSummary, type SttOrchestrator } from '../providers/stt/orchestrator';
import type { SttProviderId, TranscriptionResult } from '../providers/stt/types';

/**
 * POST /api/audio/transcribe
 *
 * multipart/form-data:
 *   audio            one recorded utterance (required)
 *   durationSeconds  recorder-measured duration, 0 < d <= MAX_UTTERANCE_SECONDS
 *
 * 200 -> { transcript, noSpeechDetected, provider, fallback }
 * 4xx/5xx -> { error: { code, message, retryable }, fallback? }
 *
 * The transcript is a *draft*: the browser shows it for correction and the
 * candidate submits the edited text as their answer.
 */

export type UploadLimits = SttConfig['limits'];

export interface ValidUpload {
  audio: Uint8Array;
  mimeType: string;
  durationSeconds: number;
}

export interface UploadRejection {
  status: number;
  code: string;
  message: string;
}

/** Pure validation of a parsed form, in the order a student would debug it. */
export async function validateTranscriptionUpload(
  form: FormData,
  limits: UploadLimits,
): Promise<{ ok: true; upload: ValidUpload } | { ok: false; rejection: UploadRejection }> {
  const reject = (status: number, code: string, message: string) => ({ ok: false as const, rejection: { status, code, message } });

  const entries = form.getAll(TRANSCRIBE_AUDIO_FIELD);
  if (entries.length === 0 || typeof entries[0] === 'string') {
    return reject(400, 'audio_missing', `Attach the recording as a file in the "${TRANSCRIBE_AUDIO_FIELD}" field.`);
  }
  if (entries.length > 1) return reject(400, 'too_many_files', 'Upload exactly one recording per request.');
  const file = entries[0] as { size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> };

  if (!isAllowedAudioMimeType(file.type)) {
    return reject(415, 'unsupported_audio_type', `Audio type must be one of: ${ALLOWED_AUDIO_MIME_TYPES.join(', ')}.`);
  }
  if (file.size === 0) return reject(400, 'audio_empty', 'The recording is empty. Try recording again.');
  if (file.size > limits.maxUploadBytes) {
    return reject(413, 'audio_too_large', `Recordings must be at most ${limits.maxUploadMb} MB.`);
  }

  const rawDuration = form.get(TRANSCRIBE_DURATION_FIELD);
  if (rawDuration === null || typeof rawDuration !== 'string' || rawDuration.trim() === '') {
    return reject(400, 'duration_missing', `Include "${TRANSCRIBE_DURATION_FIELD}" with the recording length in seconds.`);
  }
  const durationSeconds = Number(rawDuration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return reject(400, 'duration_invalid', `"${TRANSCRIBE_DURATION_FIELD}" must be a positive number of seconds.`);
  }
  if (durationSeconds > limits.maxDurationSeconds) {
    return reject(422, 'audio_too_long', `Recordings must be at most ${limits.maxDurationSeconds} seconds.`);
  }

  return {
    ok: true,
    upload: { audio: new Uint8Array(await file.arrayBuffer()), mimeType: normalizeAudioMimeType(file.type), durationSeconds },
  };
}

/** Status and user-facing message for a final provider failure code. */
const FAILURE_RESPONSES: Readonly<Record<SttErrorCode, { status: number; message: string }>> = {
  invalid_audio: { status: 422, message: 'The recording could not be transcribed. Try again or type your answer.' },
  not_configured: { status: 503, message: 'Speech-to-text is not configured. Type your answer instead.' },
  provider_unavailable: { status: 503, message: 'Speech-to-text is unavailable right now. Type your answer instead.' },
  auth_failed: { status: 502, message: 'The speech provider rejected the server credentials. Type your answer instead.' },
  quota_exceeded: { status: 429, message: 'Speech-to-text credits are exhausted. Type your answer instead.' },
  rate_limited: { status: 429, message: 'Speech-to-text is busy. Wait a moment and retry, or type your answer.' },
  network: { status: 502, message: 'Could not reach the speech provider. Retry or type your answer.' },
  timeout: { status: 504, message: 'Transcription took too long. Retry with a shorter answer or type it.' },
  upstream: { status: 502, message: 'The speech provider failed. Retry or type your answer.' },
  aborted: { status: 499, message: 'Request cancelled.' },
};

/** One provider attempt as exposed to clients: no latency, no vendor messages. */
export interface PublicAttempt {
  provider: AttemptSummary['provider'];
  outcome: AttemptSummary['outcome'];
  code?: SttErrorCode;
}

/** Which providers were tried and why the fallback ran, if it did. */
export interface TranscribeFallbackSummary {
  used: boolean;
  reason: SttErrorCode | null;
  attempts: PublicAttempt[];
}

/** 200 body of POST /api/audio/transcribe. */
export interface TranscribeSuccessBody {
  transcript: TranscriptionResult;
  noSpeechDetected: boolean;
  provider: SttProviderId;
  fallback: TranscribeFallbackSummary;
}

/**
 * Error body of POST /api/audio/transcribe. `fallback` is present only when
 * the request reached the providers and all of them failed.
 */
export interface TranscribeErrorBody extends ApiErrorBody {
  fallback?: TranscribeFallbackSummary;
}

const publicAttempts = (attempts: readonly AttemptSummary[]): PublicAttempt[] =>
  attempts.map(({ provider, outcome, code }) => (code ? { provider, outcome, code } : { provider, outcome }));

export interface AudioRouteOptions {
  stt: SttOrchestrator;
  limits: UploadLimits;
}

export function createTranscribeHandler({ stt, limits }: AudioRouteOptions): Handler {
  return async (req, res, ctx) => {
    let form: FormData;
    try {
      form = await parseMultipartForm(req, limits.maxUploadBytes + MULTIPART_OVERHEAD_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        res.setHeader('connection', 'close');
        return sendError(res, 413, 'audio_too_large', `Recordings must be at most ${limits.maxUploadMb} MB.`);
      }
      if (error instanceof UnsupportedContentTypeError) {
        return sendError(res, 415, 'unsupported_content_type', 'Send multipart/form-data with an "audio" file field.');
      }
      if (error instanceof MalformedMultipartError) return sendError(res, 400, 'malformed_multipart', 'The upload could not be parsed.');
      throw error;
    }

    const validation = await validateTranscriptionUpload(form, limits);
    if (!validation.ok) {
      const { status, code, message } = validation.rejection;
      ctx.logger.info('stt.upload_rejected', { requestId: ctx.requestId, code });
      return sendError(res, status, code, message);
    }
    const { audio, mimeType, durationSeconds } = validation.upload;

    const started = performance.now();
    try {
      const outcome = await stt.transcribe({
        audio,
        mimeType,
        fileName: `answer.${audioFileExtension(mimeType)}`,
        durationSeconds,
        signal: ctx.signal,
      });
      const text = outcome.result.text;
      // Metadata only: never the audio bytes, transcript text, or credentials.
      ctx.logger.info('stt.transcribed', {
        requestId: ctx.requestId,
        provider: outcome.provider,
        fallbackUsed: outcome.fallbackUsed,
        fallbackReason: outcome.fallbackReason,
        attempts: publicAttempts(outcome.attempts),
        bytes: audio.byteLength,
        mimeType,
        durationSeconds,
        latencyMs: Math.round(performance.now() - started),
      });
      const body: TranscribeSuccessBody = {
        transcript: outcome.result,
        noSpeechDetected: text.trim() === '',
        provider: outcome.provider,
        fallback: {
          used: outcome.fallbackUsed,
          reason: outcome.fallbackReason,
          attempts: publicAttempts(outcome.attempts),
        },
      };
      return sendJson(res, 200, body);
    } catch (error) {
      if (ctx.signal.aborted) return; // client is gone; nothing to answer
      if (error instanceof TranscriptionUnavailableError) {
        const { status, message } = FAILURE_RESPONSES[error.lastError.code];
        ctx.logger.warn('stt.all_providers_failed', { requestId: ctx.requestId, attempts: publicAttempts(error.attempts) });
        const fallback: TranscribeFallbackSummary = {
          used: error.attempts.length > 1,
          reason: error.attempts[0]?.code ?? null,
          attempts: publicAttempts(error.attempts),
        };
        return sendError(res, status, `stt_${error.lastError.code}`, message, error.lastError.retryable, { fallback });
      }
      if (error instanceof STTError) {
        const { status, message } = FAILURE_RESPONSES[error.code];
        ctx.logger.warn('stt.failed', { requestId: ctx.requestId, provider: error.provider, code: error.code });
        return sendError(res, status, `stt_${error.code}`, message, error.retryable);
      }
      throw error;
    }
  };
}

export function createAudioRoutes(options: AudioRouteOptions): Route[] {
  return [{ method: 'POST', path: TRANSCRIBE_ENDPOINT_PATH, handler: createTranscribeHandler(options) }];
}

import { STTError, type SttErrorCode } from './errors';
import type { ProviderReadiness, STTProvider, TranscriptWord, TranscriptionRequest, TranscriptionResult } from './types';

/**
 * ElevenLabs Scribe batch adapter.
 *
 *   POST {baseUrl}/v1/speech-to-text
 *   header  xi-api-key: <server-side key>
 *   body    multipart/form-data: file, model_id=scribe_v2
 *
 * Deliberate defaults:
 * - `no_verbatim` is NOT sent, so verbal fillers ("um", "uh") stay in the
 *   transcript. They are part of what the candidate actually said.
 * - `keyterms` is NOT sent; keyterm prompting is billed as an extra.
 * - `tag_audio_events` is configurable and off by default so "(laughter)"
 *   style tags do not become candidate evidence.
 *
 * The API key lives only in this closure. It is never placed in an error
 * message, log line, or response body.
 */

export interface ElevenLabsSttConfig {
  apiKey: string | undefined;
  /** Origin only, e.g. `https://api.elevenlabs.io`; no trailing slash. */
  baseUrl: string;
  modelId: string;
  timeoutMs: number;
  tagAudioEvents: boolean;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ElevenLabsDeps {
  fetch?: FetchLike;
}

interface ElevenLabsWord {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  type?: unknown;
  logprob?: unknown;
  speaker_id?: unknown;
}

const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const asString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/** Map the vendor JSON into the provider-independent shape. Exported for tests. */
export function normalizeElevenLabsResponse(body: unknown): TranscriptionResult {
  if (body === null || typeof body !== 'object' || typeof (body as { text?: unknown }).text !== 'string') {
    throw new STTError('upstream', 'elevenlabs', 'ElevenLabs response did not include transcript text');
  }
  const raw = body as { text: string; language_code?: unknown; language_probability?: unknown; words?: unknown };
  const words: TranscriptWord[] = [];
  if (Array.isArray(raw.words)) {
    for (const item of raw.words as ElevenLabsWord[]) {
      // `spacing` entries only carry whitespace between words.
      if (item === null || typeof item !== 'object' || item.type === 'spacing') continue;
      const text = asString(item.text);
      if (text === null) continue;
      words.push({
        text,
        startSeconds: asNumber(item.start),
        endSeconds: asNumber(item.end),
        kind: item.type === 'audio_event' ? 'audio_event' : 'word',
        logprob: asNumber(item.logprob),
        speakerId: asString(item.speaker_id),
      });
    }
  }
  return {
    text: raw.text.trim(),
    languageCode: asString(raw.language_code),
    languageProbability: asNumber(raw.language_probability),
    words,
    segments: [],
  };
}

/** Read `detail.status` from an ElevenLabs error body without trusting its shape. */
function errorDetailStatus(body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const status = (detail as { status?: unknown }).status;
    if (typeof status === 'string') return status.toLowerCase();
  }
  return '';
}

/**
 * HTTP status -> taxonomy. ElevenLabs has reported exhausted credits both as
 * 401 and 429 with `detail.status` containing "quota", so check that first.
 */
export function mapElevenLabsHttpError(status: number, body: unknown): SttErrorCode {
  if (errorDetailStatus(body).includes('quota')) return 'quota_exceeded';
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 402) return 'quota_exceeded';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'invalid_audio';
  if (status === 408) return 'timeout';
  return 'upstream';
}

export function createElevenLabsSttProvider(config: ElevenLabsSttConfig, deps: ElevenLabsDeps = {}): STTProvider {
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const endpoint = `${config.baseUrl}/v1/speech-to-text`;

  async function transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) throw new STTError('not_configured', 'elevenlabs', 'ELEVENLABS_API_KEY is not set');

    const form = new FormData();
    form.append('model_id', config.modelId);
    form.append('tag_audio_events', String(config.tagAudioEvents));
    // Copy into a fresh ArrayBuffer-backed view so Blob accepts it on every runtime.
    form.append('file', new Blob([new Uint8Array(request.audio)], { type: request.mimeType }), request.fileName);

    const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
    const signal = request.signal ? AbortSignal.any([timeoutSignal, request.signal]) : timeoutSignal;

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, accept: 'application/json' },
        body: form,
        signal,
      });
    } catch {
      if (request.signal?.aborted) throw new STTError('aborted', 'elevenlabs', 'Request cancelled by caller');
      if (timeoutSignal.aborted) throw new STTError('timeout', 'elevenlabs', `No response within ${config.timeoutMs} ms`);
      throw new STTError('network', 'elevenlabs', 'Network error while calling ElevenLabs');
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const code = mapElevenLabsHttpError(response.status, body);
      throw new STTError(code, 'elevenlabs', `ElevenLabs returned HTTP ${response.status}`, response.status);
    }
    return normalizeElevenLabsResponse(body);
  }

  async function checkReadiness(): Promise<ProviderReadiness> {
    // Deliberately no network probe: verifying a key would spend a request.
    if (!config.apiKey?.trim()) return { ready: false, detail: 'ELEVENLABS_API_KEY is not set' };
    return { ready: true, detail: `API key set; model ${config.modelId}; ${config.baseUrl} (network check skipped)` };
  }

  return { id: 'elevenlabs', transcribe, checkReadiness };
}

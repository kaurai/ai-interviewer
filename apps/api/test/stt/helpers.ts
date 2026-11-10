import { STTError, type SttErrorCode } from '../../src/providers/stt/errors';
import type { STTProvider, SttProviderId, TranscriptionRequest, TranscriptionResult } from '../../src/providers/stt/types';

/** A recognizable fake secret; tests assert it never escapes. */
export const TEST_API_KEY = 'sk_test_DO_NOT_LEAK_1234567890';

export function makeRequest(overrides: Partial<TranscriptionRequest> = {}): TranscriptionRequest {
  return {
    audio: new Uint8Array([1, 2, 3, 4]),
    mimeType: 'audio/webm',
    fileName: 'answer.webm',
    durationSeconds: 4.2,
    ...overrides,
  };
}

export function makeResult(text = 'hello world'): TranscriptionResult {
  return { text, languageCode: 'en', languageProbability: 0.99, words: [], segments: [] };
}

export interface ScriptedProvider extends STTProvider {
  calls: TranscriptionRequest[];
}

/** Provider that returns a result or throws the given error code. */
export function scriptedProvider(id: SttProviderId, behavior: TranscriptionResult | SttErrorCode | Error): ScriptedProvider {
  const calls: TranscriptionRequest[] = [];
  return {
    id,
    calls,
    async transcribe(request) {
      calls.push(request);
      if (behavior instanceof Error) throw behavior;
      if (typeof behavior === 'string') throw new STTError(behavior, id, `scripted ${behavior}`);
      return behavior;
    },
    async checkReadiness() {
      return { ready: true, detail: 'scripted' };
    },
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

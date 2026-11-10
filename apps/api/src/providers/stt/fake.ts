import type { STTProvider, TranscriptionResult } from './types';

/**
 * Deterministic provider for demo mode (`STT_PROVIDER=fake`) and tests. It
 * ignores the audio and returns fixed text, so the full voice flow can be
 * exercised without credentials, credits, or local models.
 */
export const FAKE_TRANSCRIPT_TEXT =
  "Um, I'd track requests per user in Redis and reject requests above the limit.";

export function createFakeSttProvider(text: string = FAKE_TRANSCRIPT_TEXT): STTProvider {
  return {
    id: 'fake',
    async transcribe(): Promise<TranscriptionResult> {
      return { text, languageCode: 'en', languageProbability: 1, words: [], segments: [] };
    },
    async checkReadiness() {
      return { ready: true, detail: 'deterministic demo transcript (audio is ignored)' };
    },
  };
}

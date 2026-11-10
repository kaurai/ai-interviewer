import { describe, expect, it } from 'vitest';
import {
  createElevenLabsSttProvider,
  mapElevenLabsHttpError,
  normalizeElevenLabsResponse,
  type ElevenLabsSttConfig,
  type FetchLike,
} from '../../src/providers/stt/elevenlabs';
import { STTError } from '../../src/providers/stt/errors';
import { TEST_API_KEY, jsonResponse, makeRequest } from './helpers';

const config: ElevenLabsSttConfig = {
  apiKey: TEST_API_KEY,
  baseUrl: 'https://api.elevenlabs.io',
  modelId: 'scribe_v2',
  timeoutMs: 5000,
  tagAudioEvents: false,
};

const SAMPLE_RESPONSE = {
  language_code: 'en',
  language_probability: 0.97,
  text: ' Um, I would use a token bucket. ',
  words: [
    { text: 'Um,', start: 0.1, end: 0.4, type: 'word', logprob: -0.8, speaker_id: 'speaker_0' },
    { text: ' ', start: 0.4, end: 0.45, type: 'spacing' },
    { text: 'I', start: 0.45, end: 0.5, type: 'word', logprob: -0.01 },
    { text: '(laughs)', start: 0.5, end: 0.9, type: 'audio_event' },
  ],
  transcription_id: 'tr_123',
};

function capturingFetch(response: () => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { fetch, calls };
}

async function expectSttError(promise: Promise<unknown>, code: string): Promise<STTError> {
  const error = await promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(STTError);
  expect((error as STTError).code).toBe(code);
  expect((error as STTError).message).not.toContain(TEST_API_KEY);
  return error as STTError;
}

describe('ElevenLabs request contract', () => {
  it('POSTs multipart file + model_id=scribe_v2 with the xi-api-key header', async () => {
    const { fetch, calls } = capturingFetch(() => jsonResponse(200, SAMPLE_RESPONSE));
    const provider = createElevenLabsSttProvider(config, { fetch });
    await provider.transcribe(makeRequest({ audio: new Uint8Array([9, 8, 7]), mimeType: 'audio/mp4', fileName: 'answer.mp4' }));

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe(TEST_API_KEY);

    const form = init.body as FormData;
    expect(form.get('model_id')).toBe('scribe_v2');
    const file = form.get('file') as Blob & { name: string };
    expect(file.name).toBe('answer.mp4');
    expect(file.type).toBe('audio/mp4');
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([9, 8, 7]);
  });

  it('keeps verbatim fillers and does not request paid keyterms', async () => {
    const { fetch, calls } = capturingFetch(() => jsonResponse(200, SAMPLE_RESPONSE));
    await createElevenLabsSttProvider(config, { fetch }).transcribe(makeRequest());
    const form = calls[0]!.init.body as FormData;
    expect(form.has('no_verbatim')).toBe(false);
    expect(form.has('keyterms')).toBe(false);
    expect(form.get('tag_audio_events')).toBe('false');
  });

  it('uses the configured base URL and model', async () => {
    const { fetch, calls } = capturingFetch(() => jsonResponse(200, SAMPLE_RESPONSE));
    await createElevenLabsSttProvider({ ...config, baseUrl: 'http://127.0.0.1:9999', modelId: 'scribe_v1' }, { fetch }).transcribe(makeRequest());
    expect(calls[0]!.url).toBe('http://127.0.0.1:9999/v1/speech-to-text');
    expect((calls[0]!.init.body as FormData).get('model_id')).toBe('scribe_v1');
  });
});

describe('ElevenLabs response normalization', () => {
  it('maps text, language, and word timing/logprob, dropping spacing entries', () => {
    const result = normalizeElevenLabsResponse(SAMPLE_RESPONSE);
    expect(result.text).toBe('Um, I would use a token bucket.');
    expect(result.languageCode).toBe('en');
    expect(result.languageProbability).toBe(0.97);
    expect(result.segments).toEqual([]);
    expect(result.words).toEqual([
      { text: 'Um,', startSeconds: 0.1, endSeconds: 0.4, kind: 'word', logprob: -0.8, speakerId: 'speaker_0' },
      { text: 'I', startSeconds: 0.45, endSeconds: 0.5, kind: 'word', logprob: -0.01, speakerId: null },
      { text: '(laughs)', startSeconds: 0.5, endSeconds: 0.9, kind: 'audio_event', logprob: null, speakerId: null },
    ]);
  });

  it('tolerates missing optional fields', () => {
    expect(normalizeElevenLabsResponse({ text: 'ok' })).toEqual({
      text: 'ok',
      languageCode: null,
      languageProbability: null,
      words: [],
      segments: [],
    });
  });

  it('rejects a body without text as an upstream failure', () => {
    expect(() => normalizeElevenLabsResponse({ words: [] })).toThrow(STTError);
    try {
      normalizeElevenLabsResponse(null);
    } catch (error) {
      expect((error as STTError).code).toBe('upstream');
    }
  });
});

describe('ElevenLabs error mapping', () => {
  it.each([
    [401, { detail: { status: 'invalid_api_key' } }, 'auth_failed'],
    [403, null, 'auth_failed'],
    [401, { detail: { status: 'quota_exceeded', message: 'quota' } }, 'quota_exceeded'],
    [402, null, 'quota_exceeded'],
    [429, { detail: { status: 'too_many_concurrent_requests' } }, 'rate_limited'],
    [429, { detail: { status: 'quota_exceeded' } }, 'quota_exceeded'],
    [400, null, 'invalid_audio'],
    [422, { detail: [{ loc: ['body', 'file'], msg: 'invalid' }] }, 'invalid_audio'],
    [408, null, 'timeout'],
    [500, null, 'upstream'],
    [503, null, 'upstream'],
  ])('HTTP %i %j -> %s', (status, body, code) => {
    expect(mapElevenLabsHttpError(status, body)).toBe(code);
  });

  it('surfaces HTTP failures as typed errors with the upstream status', async () => {
    const { fetch } = capturingFetch(() => jsonResponse(429, { detail: { status: 'quota_exceeded' } }));
    const error = await expectSttError(createElevenLabsSttProvider(config, { fetch }).transcribe(makeRequest()), 'quota_exceeded');
    expect(error.upstreamStatus).toBe(429);
    expect(error.provider).toBe('elevenlabs');
  });

  it('treats a non-JSON success body as upstream failure', async () => {
    const { fetch } = capturingFetch(() => new Response('<html>oops</html>', { status: 200 }));
    await expectSttError(createElevenLabsSttProvider(config, { fetch }).transcribe(makeRequest()), 'upstream');
  });

  it('maps a rejected fetch to network', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    await expectSttError(createElevenLabsSttProvider(config, { fetch }).transcribe(makeRequest()), 'network');
  });

  it('maps its own timeout to timeout', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    await expectSttError(createElevenLabsSttProvider({ ...config, timeoutMs: 20 }, { fetch }).transcribe(makeRequest()), 'timeout');
  });

  it('maps a caller cancellation to aborted', async () => {
    const controller = new AbortController();
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const pending = createElevenLabsSttProvider(config, { fetch }).transcribe(makeRequest({ signal: controller.signal }));
    controller.abort();
    await expectSttError(pending, 'aborted');
  });
});

describe('ElevenLabs missing configuration', () => {
  it('fails with not_configured without calling the network', async () => {
    const { fetch, calls } = capturingFetch(() => jsonResponse(200, SAMPLE_RESPONSE));
    const provider = createElevenLabsSttProvider({ ...config, apiKey: '  ' }, { fetch });
    await expectSttError(provider.transcribe(makeRequest()), 'not_configured');
    expect(calls).toHaveLength(0);
  });

  it('reports readiness from key presence only, without printing the key', async () => {
    const ready = await createElevenLabsSttProvider(config).checkReadiness();
    expect(ready.ready).toBe(true);
    expect(ready.detail).not.toContain(TEST_API_KEY);
    expect((await createElevenLabsSttProvider({ ...config, apiKey: undefined }).checkReadiness()).ready).toBe(false);
  });
});

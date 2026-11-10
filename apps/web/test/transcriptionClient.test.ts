import { describe, expect, it } from 'vitest';
import { TranscriptionClientError, createTranscriptionClient, transcribeEndpoint } from '../src/voice/transcriptionClient';
import { jsonResponse } from './fakes';

const SUCCESS = {
  transcript: { text: 'I would add an index.', languageCode: 'en', languageProbability: 0.9, words: [], segments: [] },
  noSpeechDetected: false,
  provider: 'whisper-local',
  fallback: { used: true, reason: 'quota_exceeded', attempts: [] },
};

const input = () => ({ audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }), mimeType: 'audio/mp4', durationSeconds: 7.25 });

describe('transcribeEndpoint', () => {
  it('builds same-origin and absolute endpoints', () => {
    expect(transcribeEndpoint()).toBe('/api/audio/transcribe');
    expect(transcribeEndpoint('http://127.0.0.1:3001/')).toBe('http://127.0.0.1:3001/api/audio/transcribe');
  });
});

describe('createTranscriptionClient', () => {
  it('posts the recording and duration to the injected endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createTranscriptionClient({
      endpoint: 'http://localhost:3001/api/audio/transcribe',
      fetch: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse(200, SUCCESS);
      },
    });
    const result = await client.transcribe(input());

    expect(calls[0]!.url).toBe('http://localhost:3001/api/audio/transcribe');
    expect(calls[0]!.init.method).toBe('POST');
    const form = calls[0]!.init.body as FormData;
    const audio = form.get('audio') as File;
    expect(audio.name).toBe('answer.mp4');
    expect(audio.type).toBe('audio/mp4');
    expect(form.get('durationSeconds')).toBe('7.25');
    expect(result).toEqual({ text: 'I would add an index.', noSpeechDetected: false, provider: 'whisper-local', fallbackUsed: true, languageCode: 'en' });
  });

  it('defaults to the same-origin path', async () => {
    let seen = '';
    await createTranscriptionClient({
      fetch: async (url) => {
        seen = url;
        return jsonResponse(200, SUCCESS);
      },
    }).transcribe(input());
    expect(seen).toBe('/api/audio/transcribe');
  });

  it('surfaces structured server errors as TranscriptionClientError', async () => {
    const client = createTranscriptionClient({
      fetch: async () => jsonResponse(429, { error: { code: 'stt_quota_exceeded', message: 'Credits are exhausted.', retryable: false } }),
    });
    const error = await client.transcribe(input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranscriptionClientError);
    expect(error).toMatchObject({ code: 'stt_quota_exceeded', status: 429, retryable: false, message: 'Credits are exhausted.' });
  });

  it('handles non-JSON errors, network failures, and malformed success bodies', async () => {
    const htmlError = createTranscriptionClient({ fetch: async () => new Response('<h1>Bad gateway</h1>', { status: 502 }) });
    await expect(htmlError.transcribe(input())).rejects.toMatchObject({ code: 'http_502', status: 502 });

    const offline = createTranscriptionClient({
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(offline.transcribe(input())).rejects.toMatchObject({ code: 'network', retryable: true });

    const weird = createTranscriptionClient({ fetch: async () => jsonResponse(200, { ok: true }) });
    await expect(weird.transcribe(input())).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('distinguishes caller cancellation from timeouts', async () => {
    const hang = async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

    const controller = new AbortController();
    const pending = createTranscriptionClient({ fetch: hang }).transcribe({ ...input(), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });

    await expect(createTranscriptionClient({ fetch: hang, timeoutMs: 20 }).transcribe(input())).rejects.toMatchObject({ code: 'timeout' });
  });
});

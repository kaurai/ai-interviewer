import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer } from '../../src/app';
import { loadConfig, type Env } from '../../src/config';
import type { Logger } from '../../src/http/router';
import type { FetchLike } from '../../src/providers/stt/elevenlabs';
import { FAKE_TRANSCRIPT_TEXT } from '../../src/providers/stt/fake';
import { createSttOrchestrator, type SttOrchestrator } from '../../src/providers/stt/orchestrator';
import type { TranscribeErrorBody, TranscribeSuccessBody } from '../../src/routes/audio';
import { TEST_API_KEY, jsonResponse, makeResult, scriptedProvider } from './helpers';

/**
 * Route tests run the real node:http stack on an ephemeral localhost port and
 * call it with Node's built-in fetch. Providers are injected, so no request
 * ever reaches ElevenLabs and no local binary is spawned.
 *
 * Lifecycle rules, so a broken server fails fast instead of stalling the run:
 * - `listen` rejects on the server's `error` event (EADDRINUSE, EPERM in a
 *   sandbox, ...) instead of waiting forever for a callback that never comes;
 * - every request carries a timeout well under Vitest's test timeout;
 * - every response body is consumed;
 * - every server is closed, with its sockets destroyed, after each test.
 */

const REQUEST_TIMEOUT_MS = 3_000;

interface Harness {
  url: string;
  logs: string[];
  close(): Promise<void>;
}

const open: Harness[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((h) => h.close()));
});

function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address() as AddressInfo);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.closeAllConnections();
    // The callback receives ERR_SERVER_NOT_RUNNING if already closed; either way it is gone.
    server.close(() => resolve());
  });
}

async function startServer(options: { env?: Env; stt?: SttOrchestrator; fetch?: FetchLike } = {}): Promise<Harness> {
  const logs: string[] = [];
  const record = (level: string) => (event: string, fields?: Record<string, unknown>) => logs.push(JSON.stringify({ level, event, ...fields }));
  const logger: Logger = { info: record('info'), warn: record('warn'), error: record('error') };
  const config = loadConfig({ STT_FALLBACK_PROVIDER: 'none', ...options.env });
  const server = createApiServer({ config, stt: options.stt, sttDeps: { fetch: options.fetch }, logger });
  const harness: Harness = { url: '', logs, close: () => closeServer(server) };
  // Register before listening so a half-started server is still cleaned up.
  open.push(harness);
  const { port } = await listen(server);
  harness.url = `http://127.0.0.1:${port}`;
  return harness;
}

/** fetch with a bounded wait, so a stuck request fails this test with a clear error. */
const request = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

function audioForm(
  options: { bytes?: Uint8Array | null; type?: string; duration?: string | null; field?: string; extraFile?: boolean } = {},
): FormData {
  const { bytes = new Uint8Array(2048).fill(7), type = 'audio/webm;codecs=opus', duration = '4.5', field = 'audio' } = options;
  const form = new FormData();
  if (bytes) form.append(field, new Blob([bytes], { type }), 'clip.webm');
  if (options.extraFile) form.append('audio', new Blob([new Uint8Array([1])], { type }), 'second.webm');
  if (duration !== null) form.append('durationSeconds', duration);
  return form;
}

const transcribe = (h: Harness, body: RequestInit['body'], headers?: Record<string, string>) =>
  request(`${h.url}/api/audio/transcribe`, { method: 'POST', body, headers });

async function expectError(response: Response, status: number, code: string): Promise<TranscribeErrorBody> {
  expect(response.status).toBe(status);
  const body = (await response.json()) as TranscribeErrorBody;
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  expect(typeof body.error.retryable).toBe('boolean');
  return body;
}

describe('POST /api/audio/transcribe success', () => {
  it('returns the normalized transcript, provider, and fallback metadata', async () => {
    const provider = scriptedProvider('elevenlabs', makeResult('I would use a token bucket.'));
    const h = await startServer({ stt: createSttOrchestrator({ providers: [provider] }) });

    const response = await transcribe(h, audioForm());
    expect(response.status).toBe(200);
    expect((await response.json()) as TranscribeSuccessBody).toEqual({
      transcript: makeResult('I would use a token bucket.'),
      noSpeechDetected: false,
      provider: 'elevenlabs',
      fallback: { used: false, reason: null, attempts: [{ provider: 'elevenlabs', outcome: 'succeeded' }] },
    });

    const request = provider.calls[0]!;
    expect(request.mimeType).toBe('audio/webm'); // codec parameter stripped
    expect(request.fileName).toBe('answer.webm'); // client filename is never trusted
    expect(request.durationSeconds).toBe(4.5);
    expect(request.audio.byteLength).toBe(2048);
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['audio/mp4', 'audio/ogg;codecs=opus', 'audio/wav'])('accepts %s', async (type) => {
    const h = await startServer({ stt: createSttOrchestrator({ providers: [scriptedProvider('fake', makeResult())] }) });
    const response = await transcribe(h, audioForm({ type }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  });

  it('flags silence as noSpeechDetected instead of failing', async () => {
    const h = await startServer({ stt: createSttOrchestrator({ providers: [scriptedProvider('whisper-local', makeResult(''))] }) });
    const body = (await (await transcribe(h, audioForm())).json()) as TranscribeSuccessBody;
    expect(body.noSpeechDetected).toBe(true);
  });

  it('accepts exactly the maximum duration', async () => {
    const h = await startServer({ stt: createSttOrchestrator({ providers: [scriptedProvider('fake', makeResult())] }) });
    const response = await transcribe(h, audioForm({ duration: '60' }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  });
});

describe('POST /api/audio/transcribe validation', () => {
  const okStt = () => createSttOrchestrator({ providers: [scriptedProvider('fake', makeResult())] });

  it('400 when the audio field is missing or misnamed', async () => {
    const h = await startServer({ stt: okStt() });
    await expectError(await transcribe(h, audioForm({ bytes: null })), 400, 'audio_missing');
    await expectError(await transcribe(h, audioForm({ field: 'file' })), 400, 'audio_missing');
  });

  it('400 when more than one recording is attached', async () => {
    const h = await startServer({ stt: okStt() });
    await expectError(await transcribe(h, audioForm({ extraFile: true })), 400, 'too_many_files');
  });

  it('400 for an empty file', async () => {
    const h = await startServer({ stt: okStt() });
    await expectError(await transcribe(h, audioForm({ bytes: new Uint8Array(0) })), 400, 'audio_empty');
  });

  it('415 for a non-audio MIME type', async () => {
    const h = await startServer({ stt: okStt() });
    await expectError(await transcribe(h, audioForm({ type: 'text/plain' })), 415, 'unsupported_audio_type');
    await expectError(await transcribe(h, audioForm({ type: 'video/mp4' })), 415, 'unsupported_audio_type');
  });

  it('413 when the file exceeds the configured limit', async () => {
    // 0.1 MB = 104,857 bytes. 120 KB passes the body cap but fails file validation;
    // 300 KB is rejected while streaming, before it is buffered.
    const h = await startServer({ stt: okStt(), env: { MAX_AUDIO_UPLOAD_MB: '0.1' } });
    await expectError(await transcribe(h, audioForm({ bytes: new Uint8Array(120_000) })), 413, 'audio_too_large');
    await expectError(await transcribe(h, audioForm({ bytes: new Uint8Array(300_000) })), 413, 'audio_too_large');
  });

  it('validates duration metadata', async () => {
    const h = await startServer({ stt: okStt() });
    await expectError(await transcribe(h, audioForm({ duration: null })), 400, 'duration_missing');
    await expectError(await transcribe(h, audioForm({ duration: 'abc' })), 400, 'duration_invalid');
    await expectError(await transcribe(h, audioForm({ duration: '-3' })), 400, 'duration_invalid');
    await expectError(await transcribe(h, audioForm({ duration: '0' })), 400, 'duration_invalid');
    await expectError(await transcribe(h, audioForm({ duration: '60.5' })), 422, 'audio_too_long');
  });

  it('honors a configured duration limit', async () => {
    const h = await startServer({ stt: okStt(), env: { MAX_UTTERANCE_SECONDS: '10' } });
    await expectError(await transcribe(h, audioForm({ duration: '11' })), 422, 'audio_too_long');
  });

  it('415 for a non-multipart body', async () => {
    const h = await startServer({ stt: okStt() });
    await expectError(await transcribe(h, JSON.stringify({ audio: 'x' }), { 'content-type': 'application/json' }), 415, 'unsupported_content_type');
  });

  it('400 for a malformed multipart body', async () => {
    const h = await startServer({ stt: okStt() });
    await expectError(await transcribe(h, 'garbage', { 'content-type': 'multipart/form-data; boundary=abc' }), 400, 'malformed_multipart');
  });

  it('does not call any provider for rejected uploads', async () => {
    const provider = scriptedProvider('elevenlabs', makeResult());
    const h = await startServer({ stt: createSttOrchestrator({ providers: [provider] }) });
    await expectError(await transcribe(h, audioForm({ type: 'text/plain' })), 415, 'unsupported_audio_type');
    await expectError(await transcribe(h, audioForm({ duration: '999' })), 422, 'audio_too_long');
    expect(provider.calls).toHaveLength(0);
  });
});

describe('POST /api/audio/transcribe provider failures', () => {
  it('falls back from ElevenLabs quota exhaustion and reports which provider succeeded', async () => {
    const calls: string[] = [];
    const fetch: FetchLike = async (url) => {
      calls.push(url);
      return jsonResponse(429, { detail: { status: 'quota_exceeded', message: 'quota' } });
    };
    const h = await startServer({
      env: { STT_PROVIDER: 'elevenlabs', STT_FALLBACK_PROVIDER: 'fake', ELEVENLABS_API_KEY: TEST_API_KEY },
      fetch,
    });
    const response = await transcribe(h, audioForm());
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(calls).toEqual(['https://api.elevenlabs.io/v1/speech-to-text']);
    expect(JSON.parse(text)).toMatchObject({
      provider: 'fake',
      transcript: { text: FAKE_TRANSCRIPT_TEXT },
      fallback: {
        used: true,
        reason: 'quota_exceeded',
        attempts: [
          { provider: 'elevenlabs', outcome: 'failed', code: 'quota_exceeded' },
          { provider: 'fake', outcome: 'succeeded' },
        ],
      },
    });
    // Neither the response nor the logs contain the key or the transcript.
    expect(text).not.toContain(TEST_API_KEY);
    const logs = h.logs.join('\n');
    expect(logs).not.toContain(TEST_API_KEY);
    expect(logs).not.toContain(FAKE_TRANSCRIPT_TEXT);
    expect(logs).toContain('stt.transcribed');
  });

  it('503 with a typed-fallback message when the ElevenLabs key is missing and no fallback exists', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('network must not be called');
    };
    const h = await startServer({ env: { STT_PROVIDER: 'elevenlabs', STT_FALLBACK_PROVIDER: 'none' }, fetch });
    const body = await expectError(await transcribe(h, audioForm()), 503, 'stt_not_configured');
    expect(body.error.message).toMatch(/type your answer/i);
    expect(body.fallback).toEqual({ used: false, reason: 'not_configured', attempts: [{ provider: 'elevenlabs', outcome: 'failed', code: 'not_configured' }] });
  });

  it('maps the final failure to an explicit status', async () => {
    const cases = [
      ['quota_exceeded', 429, false],
      ['rate_limited', 429, true],
      ['timeout', 504, true],
      ['network', 502, true],
      ['upstream', 502, true],
      ['auth_failed', 502, false],
      ['provider_unavailable', 503, true],
    ] as const;
    for (const [code, status, retryable] of cases) {
      const h = await startServer({
        stt: createSttOrchestrator({ providers: [scriptedProvider('elevenlabs', 'not_configured'), scriptedProvider('whisper-local', code)] }),
      });
      const body = await expectError(await transcribe(h, audioForm()), status, `stt_${code}`);
      expect(body.error.retryable).toBe(retryable);
      expect(body.fallback?.used).toBe(true);
      await h.close();
    }
  });

  it('422 for audio a provider cannot decode, without trying the fallback', async () => {
    const fallback = scriptedProvider('fake', makeResult());
    const h = await startServer({ stt: createSttOrchestrator({ providers: [scriptedProvider('whisper-local', 'invalid_audio'), fallback] }) });
    await expectError(await transcribe(h, audioForm()), 422, 'stt_invalid_audio');
    expect(fallback.calls).toHaveLength(0);
  });

  it('500 with a generic body for unexpected errors', async () => {
    const broken: SttOrchestrator = {
      providerIds: ['fake'],
      transcribe: async () => {
        throw new Error(`boom ${TEST_API_KEY}`);
      },
    };
    const h = await startServer({ stt: broken });
    const response = await transcribe(h, audioForm());
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain(TEST_API_KEY);
    expect(h.logs.join('\n')).not.toContain(TEST_API_KEY);
  });
});

describe('router basics', () => {
  it('405 for the wrong method and 404 for unknown paths', async () => {
    const h = await startServer({ stt: createSttOrchestrator({ providers: [scriptedProvider('fake', makeResult())] }) });
    const wrongMethod = await request(`${h.url}/api/audio/transcribe`);
    await expectError(wrongMethod, 405, 'method_not_allowed');
    expect(wrongMethod.headers.get('allow')).toBe('POST');
    await expectError(await request(`${h.url}/api/nope`), 404, 'not_found');
  });

  it('GET /api/health reports configured providers without secrets', async () => {
    const h = await startServer({ env: { ELEVENLABS_API_KEY: TEST_API_KEY, STT_FALLBACK_PROVIDER: 'whisper-local' } });
    const response = await request(`${h.url}/api/health`);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      status: 'ok',
      stt: { providers: ['elevenlabs', 'whisper-local'], maxDurationSeconds: 60, maxUploadMb: 10 },
    });
    expect(text).not.toContain(TEST_API_KEY);
  });
});

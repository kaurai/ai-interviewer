import { describe, expect, it } from 'vitest';
import { STTError, STT_ERROR_CODES, STT_ERROR_POLICY, type SttErrorCode } from '../../src/providers/stt/errors';
import { TranscriptionUnavailableError, createSttOrchestrator } from '../../src/providers/stt/orchestrator';
import { makeRequest, makeResult, scriptedProvider } from './helpers';

const FAILOVER_CODES = STT_ERROR_CODES.filter((code) => STT_ERROR_POLICY[code].failover);
const TERMINAL_CODES = STT_ERROR_CODES.filter((code) => !STT_ERROR_POLICY[code].failover);

describe('failover policy table', () => {
  it('fails over on availability, credential, quota, network, timeout, and upstream errors only', () => {
    expect([...FAILOVER_CODES].sort()).toEqual(
      ['auth_failed', 'network', 'not_configured', 'provider_unavailable', 'quota_exceeded', 'rate_limited', 'timeout', 'upstream'].sort(),
    );
    expect([...TERMINAL_CODES].sort()).toEqual(['aborted', 'invalid_audio']);
  });
});

describe('STT orchestrator', () => {
  it('uses the primary provider when it succeeds', async () => {
    const primary = scriptedProvider('elevenlabs', makeResult('from primary'));
    const fallback = scriptedProvider('whisper-local', makeResult('from fallback'));
    const outcome = await createSttOrchestrator({ providers: [primary, fallback] }).transcribe(makeRequest());

    expect(outcome.provider).toBe('elevenlabs');
    expect(outcome.result.text).toBe('from primary');
    expect(outcome.fallbackUsed).toBe(false);
    expect(outcome.fallbackReason).toBeNull();
    expect(outcome.attempts.map((a) => [a.provider, a.outcome])).toEqual([['elevenlabs', 'succeeded']]);
    expect(fallback.calls).toHaveLength(0);
  });

  it.each(FAILOVER_CODES)('fails over to the next provider on %s and reports the safe reason', async (code) => {
    const primary = scriptedProvider('elevenlabs', code);
    const fallback = scriptedProvider('whisper-local', makeResult('local text'));
    const outcome = await createSttOrchestrator({ providers: [primary, fallback] }).transcribe(makeRequest());

    expect(outcome.provider).toBe('whisper-local');
    expect(outcome.fallbackUsed).toBe(true);
    expect(outcome.fallbackReason).toBe(code);
    expect(outcome.attempts.map((a) => [a.provider, a.outcome, a.code])).toEqual([
      ['elevenlabs', 'failed', code],
      ['whisper-local', 'succeeded', undefined],
    ]);
    // The fallback receives the same validated request.
    expect(fallback.calls[0]).toBe(primary.calls[0]);
  });

  it('does not fall back on invalid client input', async () => {
    const fallback = scriptedProvider('whisper-local', makeResult());
    const orchestrator = createSttOrchestrator({ providers: [scriptedProvider('elevenlabs', 'invalid_audio'), fallback] });
    await expect(orchestrator.transcribe(makeRequest())).rejects.toMatchObject({ code: 'invalid_audio' });
    expect(fallback.calls).toHaveLength(0);
  });

  it('stops without fallback when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const fallback = scriptedProvider('whisper-local', makeResult());
    const orchestrator = createSttOrchestrator({ providers: [scriptedProvider('elevenlabs', 'network'), fallback] });
    await expect(orchestrator.transcribe(makeRequest({ signal: controller.signal }))).rejects.toMatchObject({ code: 'aborted' });
    expect(fallback.calls).toHaveLength(0);
  });

  it('raises TranscriptionUnavailableError with every attempt when all providers fail', async () => {
    const orchestrator = createSttOrchestrator({
      providers: [scriptedProvider('elevenlabs', 'quota_exceeded'), scriptedProvider('whisper-local', 'not_configured')],
    });
    const error = await orchestrator.transcribe(makeRequest()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranscriptionUnavailableError);
    const unavailable = error as TranscriptionUnavailableError;
    expect(unavailable.lastError.code).toBe('not_configured');
    expect(unavailable.attempts.map((a) => a.code)).toEqual(['quota_exceeded', 'not_configured']);
  });

  it('treats unexpected exceptions as upstream failures so the fallback still runs', async () => {
    const outcome = await createSttOrchestrator({
      providers: [scriptedProvider('elevenlabs', new RangeError('bug')), scriptedProvider('whisper-local', makeResult('ok'))],
    }).transcribe(makeRequest());
    expect(outcome.fallbackReason).toBe('upstream');
    expect(outcome.provider).toBe('whisper-local');
  });

  it('accepts an injected policy', async () => {
    const neverFailover = { shouldFailover: (_error: STTError) => false };
    const fallback = scriptedProvider('whisper-local', makeResult());
    const orchestrator = createSttOrchestrator({ providers: [scriptedProvider('elevenlabs', 'timeout'), fallback], policy: neverFailover });
    await expect(orchestrator.transcribe(makeRequest())).rejects.toMatchObject({ code: 'timeout' });
    expect(fallback.calls).toHaveLength(0);
  });

  it('a single provider that fails over-eligibly yields TranscriptionUnavailableError', async () => {
    const orchestrator = createSttOrchestrator({ providers: [scriptedProvider('elevenlabs', 'rate_limited' as SttErrorCode)] });
    await expect(orchestrator.transcribe(makeRequest())).rejects.toBeInstanceOf(TranscriptionUnavailableError);
  });

  it('requires at least one provider', () => {
    expect(() => createSttOrchestrator({ providers: [] })).toThrow();
  });
});

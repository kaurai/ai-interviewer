import { STTError, STT_ERROR_POLICY, isSttError, type SttErrorCode } from './errors';
import type { STTProvider, SttProviderId, TranscriptionRequest, TranscriptionResult } from './types';

/**
 * Provider orchestrator: tries providers in order and fails over according to
 * an explicit, injectable policy. It never retries the same provider; a quick
 * second opinion from a different engine is more useful in a live interview
 * than waiting on a struggling one.
 */

export interface FailoverPolicy {
  shouldFailover(error: STTError): boolean;
}

/** Default policy: exactly the `failover` column of STT_ERROR_POLICY. */
export const defaultFailoverPolicy: FailoverPolicy = {
  shouldFailover: (error) => STT_ERROR_POLICY[error.code].failover,
};

export interface AttemptSummary {
  provider: SttProviderId;
  outcome: 'succeeded' | 'failed';
  /** Present when `outcome` is `failed`. A code, never a raw vendor message. */
  code?: SttErrorCode;
  latencyMs: number;
}

export interface TranscriptionOutcome {
  result: TranscriptionResult;
  /** Which provider produced `result`. */
  provider: SttProviderId;
  fallbackUsed: boolean;
  /** Safe reason the earlier provider was skipped, e.g. `quota_exceeded`. */
  fallbackReason: SttErrorCode | null;
  attempts: AttemptSummary[];
}

/** Every provider failed with a failover-eligible error. */
export class TranscriptionUnavailableError extends Error {
  override readonly name = 'TranscriptionUnavailableError';

  constructor(
    readonly attempts: AttemptSummary[],
    /** The final provider's error; decides the HTTP status. */
    readonly lastError: STTError,
  ) {
    super(`All speech-to-text providers failed: ${attempts.map((a) => `${a.provider}=${a.code}`).join(', ')}`);
  }
}

export interface SttOrchestrator {
  readonly providerIds: readonly SttProviderId[];
  transcribe(request: TranscriptionRequest): Promise<TranscriptionOutcome>;
}

export interface OrchestratorOptions {
  providers: readonly STTProvider[];
  policy?: FailoverPolicy;
  now?: () => number;
}

/** Unknown exceptions are treated as upstream failures so the fallback can run. */
function toSttError(error: unknown, provider: SttProviderId): STTError {
  if (isSttError(error)) return error;
  const name = error instanceof Error ? error.name : 'unknown';
  return new STTError('upstream', provider, `Unexpected ${name} from provider`);
}

export function createSttOrchestrator(options: OrchestratorOptions): SttOrchestrator {
  const { providers, policy = defaultFailoverPolicy, now = () => performance.now() } = options;
  if (providers.length === 0) throw new Error('At least one STT provider is required.');

  return {
    providerIds: providers.map((p) => p.id),
    async transcribe(request) {
      const attempts: AttemptSummary[] = [];
      let firstFailure: SttErrorCode | null = null;

      for (const [index, provider] of providers.entries()) {
        const started = now();
        try {
          const result = await provider.transcribe(request);
          attempts.push({ provider: provider.id, outcome: 'succeeded', latencyMs: Math.round(now() - started) });
          return { result, provider: provider.id, fallbackUsed: index > 0, fallbackReason: firstFailure, attempts };
        } catch (raw) {
          const error = toSttError(raw, provider.id);
          attempts.push({ provider: provider.id, outcome: 'failed', code: error.code, latencyMs: Math.round(now() - started) });
          firstFailure ??= error.code;

          // Cancelled by the caller: stop immediately, regardless of policy.
          if (request.signal?.aborted || error.code === 'aborted') {
            throw new STTError('aborted', provider.id, 'Transcription cancelled by caller');
          }
          if (!policy.shouldFailover(error)) throw error;
          if (index === providers.length - 1) throw new TranscriptionUnavailableError(attempts, error);
        }
      }
      // Unreachable: the loop either returns or throws.
      throw new Error('STT orchestrator exhausted providers unexpectedly.');
    },
  };
}

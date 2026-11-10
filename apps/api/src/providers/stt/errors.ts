import type { SttProviderId } from './types';

/**
 * Typed STT error taxonomy. Every provider maps its own failures into exactly
 * one of these codes, so the orchestrator and HTTP route never inspect vendor
 * status codes or process exit codes.
 */
export const STT_ERROR_CODES = [
  'invalid_audio',
  'not_configured',
  'provider_unavailable',
  'auth_failed',
  'quota_exceeded',
  'rate_limited',
  'network',
  'timeout',
  'upstream',
  'aborted',
] as const;

export type SttErrorCode = (typeof STT_ERROR_CODES)[number];

export interface SttErrorPolicy {
  /** Try the next provider when this error occurs. */
  failover: boolean;
  /** The same request may succeed if the client retries later. */
  retryable: boolean;
  description: string;
}

/**
 * The explicit failover policy. Read this table to answer "will the fallback
 * provider run?". Client-input problems and cancellations never fail over:
 * a second provider would receive the same bad audio, and an aborted request
 * has nobody waiting for the answer.
 */
export const STT_ERROR_POLICY: Readonly<Record<SttErrorCode, SttErrorPolicy>> = {
  invalid_audio: { failover: false, retryable: false, description: 'The audio could not be decoded or was rejected as invalid input.' },
  not_configured: { failover: true, retryable: false, description: 'Credentials, binary, or model path are missing.' },
  provider_unavailable: { failover: true, retryable: true, description: 'The provider or a local tool could not be started or reached.' },
  auth_failed: { failover: true, retryable: false, description: 'The provider rejected the configured credentials.' },
  quota_exceeded: { failover: true, retryable: false, description: 'Account credits or quota are exhausted.' },
  rate_limited: { failover: true, retryable: true, description: 'The provider asked us to slow down.' },
  network: { failover: true, retryable: true, description: 'A network error prevented the request from completing.' },
  timeout: { failover: true, retryable: true, description: 'The provider did not answer within the configured timeout.' },
  upstream: { failover: true, retryable: true, description: 'The provider failed or returned an unusable response.' },
  aborted: { failover: false, retryable: false, description: 'The caller cancelled the request.' },
};

export class STTError extends Error {
  override readonly name = 'STTError';

  constructor(
    readonly code: SttErrorCode,
    readonly provider: SttProviderId,
    /** Internal diagnostic text. Must never contain secrets or transcript text. */
    message: string,
    /** Vendor HTTP status or process exit code, for diagnostics only. */
    readonly upstreamStatus?: number,
  ) {
    super(message);
  }

  get failover(): boolean {
    return STT_ERROR_POLICY[this.code].failover;
  }

  get retryable(): boolean {
    return STT_ERROR_POLICY[this.code].retryable;
  }
}

export function isSttError(value: unknown): value is STTError {
  return value instanceof STTError;
}

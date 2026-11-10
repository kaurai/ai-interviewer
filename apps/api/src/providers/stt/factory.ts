import type { SttConfig } from '../../config';
import { createElevenLabsSttProvider, type FetchLike } from './elevenlabs';
import { createFakeSttProvider } from './fake';
import { createSttOrchestrator, type FailoverPolicy, type SttOrchestrator } from './orchestrator';
import type { ProcessRunner } from './processRunner';
import type { STTProvider, SttProviderId } from './types';
import { createWhisperLocalProvider, type WhisperFs } from './whisperLocal';

/** Injection points so tests never touch the network or spawn real binaries. */
export interface SttFactoryDeps {
  fetch?: FetchLike;
  runProcess?: ProcessRunner;
  fs?: WhisperFs;
  policy?: FailoverPolicy;
}

export function createSttProvider(id: SttProviderId, config: SttConfig, deps: SttFactoryDeps = {}): STTProvider {
  switch (id) {
    case 'elevenlabs':
      return createElevenLabsSttProvider(config.elevenLabs, { fetch: deps.fetch });
    case 'whisper-local':
      return createWhisperLocalProvider(
        { ...config.whisper, maxDurationSeconds: config.limits.maxDurationSeconds },
        { runProcess: deps.runProcess, fs: deps.fs },
      );
    case 'fake':
      return createFakeSttProvider();
  }
}

/** Ordered provider list: primary first, then the optional fallback. */
export function createSttProviders(config: SttConfig, deps: SttFactoryDeps = {}): STTProvider[] {
  const ids: SttProviderId[] = config.fallback === 'none' ? [config.primary] : [config.primary, config.fallback];
  return ids.map((id) => createSttProvider(id, config, deps));
}

export function createSttFromConfig(config: SttConfig, deps: SttFactoryDeps = {}): SttOrchestrator {
  return createSttOrchestrator({ providers: createSttProviders(config, deps), policy: deps.policy });
}

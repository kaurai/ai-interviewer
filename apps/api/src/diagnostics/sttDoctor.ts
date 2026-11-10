import path from 'node:path';
import { ConfigError, loadConfig, type AppConfig, type Env } from '../config';
import { createSttProvider, type SttFactoryDeps } from '../providers/stt/factory';
import type { SttProviderId } from '../providers/stt/types';

/**
 * Speech-to-text preflight for `npm run doctor`.
 *
 * Local checks only: configuration, key *presence*, ffmpeg/whisper-cli
 * spawnability, and model file presence. It never calls ElevenLabs, so it
 * costs no credits, and it never prints the key.
 */

export type CheckLevel = 'ok' | 'warn' | 'fail' | 'skip';

export interface DoctorCheck {
  level: CheckLevel;
  label: string;
  detail?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** False only for blocking problems (invalid config, unsupported Node). */
  passed: boolean;
}

export interface DoctorOptions {
  env: Env;
  baseDir?: string;
  nodeVersion?: string;
  deps?: SttFactoryDeps;
}

/** Common copy-paste mistakes that should not be mistaken for a real key. */
const PLACEHOLDER_KEY = /^(?:your|<|xxx|changeme|replace|sk_\.\.\.|placeholder)/i;

export async function runSttDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const nodeMajor = Number(nodeVersion.split('.')[0]);
  checks.push(
    nodeMajor >= 22
      ? { level: 'ok', label: `Node.js ${nodeVersion}` }
      : { level: 'fail', label: `Node.js ${nodeVersion}`, detail: 'Node.js 22 or newer is required' },
  );

  let config: AppConfig;
  try {
    config = loadConfig(options.env, { baseDir: options.baseDir });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    for (const issue of error.issues) checks.push({ level: 'fail', label: 'Configuration', detail: issue });
    return { checks, passed: false };
  }
  const { stt } = config;
  checks.push({ level: 'ok', label: 'Configuration parsed', detail: `API will bind ${config.server.host}:${config.server.port}` });
  checks.push({
    level: 'ok',
    label: `STT providers: ${stt.primary} -> ${stt.fallback}`,
    detail: `limits ${stt.limits.maxUploadMb} MB, ${stt.limits.maxDurationSeconds} s`,
  });

  const selected: SttProviderId[] = stt.fallback === 'none' ? [stt.primary] : [stt.primary, stt.fallback];
  const readiness: boolean[] = [];

  for (const id of selected) {
    const role = id === stt.primary ? 'primary' : 'fallback';
    const provider = createSttProvider(id, stt, options.deps);
    const result = await provider.checkReadiness();
    readiness.push(result.ready);
    checks.push({ level: result.ready ? 'ok' : 'warn', label: `${role} ${id}`, detail: result.detail });

    if (id === 'elevenlabs' && stt.elevenLabs.apiKey && PLACEHOLDER_KEY.test(stt.elevenLabs.apiKey)) {
      checks.push({ level: 'warn', label: 'ELEVENLABS_API_KEY looks like a placeholder', detail: 'Paste your own key into .env' });
    }
    if (id === 'whisper-local') {
      const model = path.basename(stt.whisper.modelPath);
      if (/\.en\.bin$/.test(model) && stt.whisper.language !== 'en') {
        checks.push({ level: 'warn', label: `${model} is English-only`, detail: 'Set WHISPER_LANGUAGE=en or use a multilingual model' });
      }
    }
  }
  if (!selected.includes('elevenlabs')) checks.push({ level: 'skip', label: 'ElevenLabs', detail: 'not selected' });
  checks.push({ level: 'skip', label: 'ElevenLabs network probe', detail: 'skipped on purpose; no credits are spent' });

  checks.push(
    readiness.some(Boolean)
      ? { level: 'ok', label: 'Voice answers can be transcribed' }
      : { level: 'warn', label: 'No STT provider is ready', detail: 'Typed answers still work; fix a provider above for voice' },
  );

  return { checks, passed: !checks.some((c) => c.level === 'fail') };
}

export function formatDoctorReport(report: DoctorReport): string {
  const tag: Record<CheckLevel, string> = { ok: '[OK]  ', warn: '[WARN]', fail: '[FAIL]', skip: '[SKIP]' };
  return report.checks.map((c) => `${tag[c.level]} ${c.label}${c.detail ? ` - ${c.detail}` : ''}`).join('\n');
}

import path from 'node:path';
import { ConfigError, EnvReader, type Env } from './config';

/**
 * Configuration for the interview pipeline (CLI, resume parsing, evaluator,
 * spoken questions). Separate from `loadConfig` so the speech-to-text module
 * and its tests are unaffected. Every variable is listed in `.env.example`.
 */

export const LLM_PROVIDER_IDS = ['deterministic', 'ollama'] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export const TTS_PROVIDER_IDS = ['none', 'say', 'espeak', 'spd-say'] as const;
export type TtsProviderId = (typeof TTS_PROVIDER_IDS)[number];

export interface ResumeLimits {
  maxBytes: number;
  maxChars: number;
  maxPdfPages: number;
}

export interface PipelineConfig {
  llm: {
    provider: LlmProviderId;
    model: string;
    /** Loopback only: candidate text never leaves the machine through the LLM. */
    ollamaBaseUrl: string;
    timeoutMs: number;
  };
  resume: ResumeLimits & { maxMb: number };
  tts: {
    provider: TtsProviderId;
    /** Optional absolute path or command name overriding the provider's default binary. */
    command: string | undefined;
    timeoutMs: number;
  };
  interview: {
    defaultQuestions: number;
    defaultMinutes: number;
    maxFollowupsPerQuestion: 0 | 1;
    sessionsDir: string;
  };
}

export const DEFAULT_RESUME_MAX_MB = 5;
export const DEFAULT_RESUME_MAX_CHARS = 40_000;
export const DEFAULT_RESUME_MAX_PDF_PAGES = 10;
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_LLM_MODEL = 'qwen3:4b';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseLoopbackUrl(reader: EnvReader, name: string, fallback: string): string {
  const value = reader.string(name, fallback);
  try {
    const url = new URL(value);
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      reader.issues.push(`${name} must point at this machine (localhost/127.0.0.1); cloud LLMs are not supported`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') reader.issues.push(`${name} must use http or https`);
    if (url.username || url.password || url.search || url.hash) {
      reader.issues.push(`${name} must be a plain origin without credentials, query, or fragment`);
    }
    return url.origin;
  } catch {
    reader.issues.push(`${name} must be a valid URL`);
    return fallback;
  }
}

export function loadPipelineConfig(env: Env = process.env, options: { baseDir?: string } = {}): PipelineConfig {
  const baseDir = options.baseDir ?? process.cwd();
  const r = new EnvReader(env);

  const maxMb = r.number('RESUME_MAX_MB', DEFAULT_RESUME_MAX_MB, { min: 0.1, max: 20, integer: false });
  const ttsCommand = r.raw('CLI_TTS_COMMAND');
  const config: PipelineConfig = {
    llm: {
      provider: r.choice('LLM_PROVIDER', LLM_PROVIDER_IDS, 'deterministic'),
      model: r.string('LLM_MODEL', DEFAULT_LLM_MODEL),
      ollamaBaseUrl: parseLoopbackUrl(r, 'OLLAMA_BASE_URL', DEFAULT_OLLAMA_BASE_URL),
      timeoutMs: r.number('LLM_TIMEOUT_MS', 60_000, { min: 1000, max: 600_000 }),
    },
    resume: {
      maxMb,
      maxBytes: Math.floor(maxMb * 1024 * 1024),
      maxChars: r.number('RESUME_MAX_CHARS', DEFAULT_RESUME_MAX_CHARS, { min: 1000, max: 200_000 }),
      maxPdfPages: r.number('RESUME_MAX_PDF_PAGES', DEFAULT_RESUME_MAX_PDF_PAGES, { min: 1, max: 50 }),
    },
    tts: {
      provider: r.choice('CLI_TTS_PROVIDER', TTS_PROVIDER_IDS, 'none'),
      command: ttsCommand === undefined ? undefined : ttsCommand.includes('/') ? path.resolve(baseDir, ttsCommand) : ttsCommand,
      timeoutMs: r.number('CLI_TTS_TIMEOUT_MS', 30_000, { min: 1000, max: 120_000 }),
    },
    interview: {
      defaultQuestions: r.number('INTERVIEW_DEFAULT_QUESTIONS', 3, { min: 1, max: 6 }),
      defaultMinutes: r.number('INTERVIEW_DEFAULT_MINUTES', 5, { min: 2, max: 15 }),
      maxFollowupsPerQuestion: r.number('INTERVIEW_MAX_FOLLOWUPS_PER_QUESTION', 1, { min: 0, max: 1 }) as 0 | 1,
      sessionsDir: path.resolve(baseDir, r.string('INTERVIEW_SESSIONS_DIR', './data/sessions')),
    },
  };

  if (!/^[A-Za-z0-9._:/-]{1,80}$/.test(config.llm.model)) r.issues.push('LLM_MODEL must be a model tag such as qwen3:4b');
  if (![5, 10, 15].includes(config.interview.defaultMinutes)) r.issues.push('INTERVIEW_DEFAULT_MINUTES must be 5, 10, or 15');
  if (r.issues.length > 0) throw new ConfigError(r.issues);
  return config;
}

import path from 'node:path';
import { DEFAULT_MAX_AUDIO_UPLOAD_MB, DEFAULT_MAX_UTTERANCE_SECONDS } from '@ai-interviewer/shared';
import { STT_PROVIDER_IDS, type SttProviderId } from './providers/stt/types';

/**
 * Typed configuration from environment variables. Every variable is listed in
 * `.env.example`. Parsing collects all problems and reports them at once, and
 * no message ever echoes the value of ELEVENLABS_API_KEY.
 */

export type Env = Readonly<Record<string, string | undefined>>;

export interface ServerConfig {
  host: string;
  port: number;
}

export interface SttConfig {
  primary: SttProviderId;
  fallback: SttProviderId | 'none';
  limits: {
    maxUploadMb: number;
    maxUploadBytes: number;
    maxDurationSeconds: number;
  };
  elevenLabs: {
    /** Secret. Use `describeSttConfig` for anything printed or logged. */
    apiKey: string | undefined;
    baseUrl: string;
    modelId: string;
    timeoutMs: number;
    tagAudioEvents: boolean;
  };
  whisper: {
    cliPath: string;
    modelPath: string;
    ffmpegPath: string;
    language: string;
    threads: number | undefined;
    timeoutMs: number;
    ffmpegTimeoutMs: number;
  };
}

export interface AppConfig {
  server: ServerConfig;
  stt: SttConfig;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';

  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
  }
}

export const DEFAULT_WHISPER_MODEL_PATH = './models/whisper/ggml-small.en.bin';

/** Collects every configuration problem instead of failing on the first. Reused by pipelineConfig.ts. */
export class EnvReader {
  readonly issues: string[] = [];

  constructor(private readonly env: Env) {}

  /** Trimmed value; empty strings count as unset. */
  raw(name: string): string | undefined {
    const value = this.env[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  }

  string(name: string, fallback: string): string {
    return this.raw(name) ?? fallback;
  }

  number(name: string, fallback: number, { min, max, integer = true }: { min: number; max: number; integer?: boolean }): number {
    const value = this.raw(name);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) {
      this.issues.push(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max} (got "${value}")`);
      return fallback;
    }
    return parsed;
  }

  optionalInteger(name: string, min: number, max: number): number | undefined {
    return this.raw(name) === undefined ? undefined : this.number(name, min, { min, max });
  }

  boolean(name: string, fallback: boolean): boolean {
    const value = this.raw(name)?.toLowerCase();
    if (value === undefined) return fallback;
    if (['true', '1', 'yes'].includes(value)) return true;
    if (['false', '0', 'no'].includes(value)) return false;
    this.issues.push(`${name} must be true or false (got "${value}")`);
    return fallback;
  }

  choice<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    const value = this.raw(name);
    if (value === undefined) return fallback;
    if ((allowed as readonly string[]).includes(value)) return value as T;
    this.issues.push(`${name} must be one of ${allowed.join(' | ')} (got "${value}")`);
    return fallback;
  }
}

/** HTTPS is required except for loopback hosts, which tests and mocks use. */
function parseBaseUrl(reader: EnvReader, name: string, fallback: string): string {
  const value = reader.string(name, fallback);
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      reader.issues.push(`${name} must use https (http is allowed only for localhost)`);
    }
    if (url.username || url.password || url.search || url.hash) {
      reader.issues.push(`${name} must be a plain origin without credentials, query, or fragment`);
    }
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    reader.issues.push(`${name} must be a valid URL`);
    return fallback;
  }
}

/** Command names (no separator) resolve via PATH at spawn time; paths resolve from baseDir. */
function resolveToolPath(value: string, baseDir: string): string {
  return value.includes('/') || value.includes('\\') ? path.resolve(baseDir, value) : value;
}

export function loadConfig(env: Env = process.env, options: { baseDir?: string } = {}): AppConfig {
  const baseDir = options.baseDir ?? process.cwd();
  const r = new EnvReader(env);

  const fallbackChoices = [...STT_PROVIDER_IDS, 'none'] as const;
  const primary = r.choice('STT_PROVIDER', STT_PROVIDER_IDS, 'elevenlabs');
  const fallback = r.choice('STT_FALLBACK_PROVIDER', fallbackChoices, 'whisper-local');
  if (fallback === primary) r.issues.push('STT_FALLBACK_PROVIDER must differ from STT_PROVIDER (use "none" to disable fallback)');

  const maxUploadMb = r.number('MAX_AUDIO_UPLOAD_MB', DEFAULT_MAX_AUDIO_UPLOAD_MB, { min: 0.1, max: 25, integer: false });
  const maxDurationSeconds = r.number('MAX_UTTERANCE_SECONDS', DEFAULT_MAX_UTTERANCE_SECONDS, { min: 1, max: 300 });

  const config: AppConfig = {
    server: {
      host: r.string('HOST', '127.0.0.1'),
      port: r.number('PORT', 3001, { min: 0, max: 65535 }),
    },
    stt: {
      primary,
      fallback,
      limits: { maxUploadMb, maxUploadBytes: Math.floor(maxUploadMb * 1024 * 1024), maxDurationSeconds },
      elevenLabs: {
        apiKey: r.raw('ELEVENLABS_API_KEY'),
        baseUrl: parseBaseUrl(r, 'ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io'),
        modelId: r.string('ELEVENLABS_STT_MODEL', 'scribe_v2'),
        timeoutMs: r.number('ELEVENLABS_STT_TIMEOUT_MS', 30_000, { min: 1000, max: 300_000 }),
        tagAudioEvents: r.boolean('ELEVENLABS_TAG_AUDIO_EVENTS', false),
      },
      whisper: {
        cliPath: resolveToolPath(r.string('WHISPER_CLI_PATH', 'whisper-cli'), baseDir),
        modelPath: path.resolve(baseDir, r.string('WHISPER_MODEL_PATH', DEFAULT_WHISPER_MODEL_PATH)),
        ffmpegPath: resolveToolPath(r.string('FFMPEG_PATH', 'ffmpeg'), baseDir),
        language: r.string('WHISPER_LANGUAGE', 'en'),
        threads: r.optionalInteger('WHISPER_THREADS', 1, 64),
        timeoutMs: r.number('WHISPER_TIMEOUT_MS', 120_000, { min: 1000, max: 600_000 }),
        ffmpegTimeoutMs: r.number('FFMPEG_TIMEOUT_MS', 20_000, { min: 1000, max: 120_000 }),
      },
    },
  };

  if (!/^[a-z]{2,3}$|^auto$/.test(config.stt.whisper.language)) {
    r.issues.push('WHISPER_LANGUAGE must be a 2-3 letter code such as "en", or "auto"');
  }
  if (r.issues.length > 0) throw new ConfigError(r.issues);
  return config;
}

/** Secret-free summary for logs, the health route, and `npm run doctor`. */
export function describeSttConfig(stt: SttConfig) {
  return {
    primary: stt.primary,
    fallback: stt.fallback,
    limits: { maxUploadMb: stt.limits.maxUploadMb, maxDurationSeconds: stt.limits.maxDurationSeconds },
    elevenLabs: {
      apiKey: stt.elevenLabs.apiKey ? 'set' : 'missing',
      baseUrl: stt.elevenLabs.baseUrl,
      modelId: stt.elevenLabs.modelId,
      timeoutMs: stt.elevenLabs.timeoutMs,
      tagAudioEvents: stt.elevenLabs.tagAudioEvents,
    },
    whisper: { ...stt.whisper },
  };
}

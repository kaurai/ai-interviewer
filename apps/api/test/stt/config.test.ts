import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_WHISPER_MODEL_PATH, describeSttConfig, loadConfig } from '../../src/config';
import { createSttProviders } from '../../src/providers/stt/factory';
import { TEST_API_KEY } from './helpers';

const baseDir = '/repo';

describe('loadConfig defaults', () => {
  it('works with an empty environment (no key required to start)', () => {
    const config = loadConfig({}, { baseDir });
    expect(config.server).toEqual({ host: '127.0.0.1', port: 3001 });
    expect(config.stt.primary).toBe('elevenlabs');
    expect(config.stt.fallback).toBe('whisper-local');
    expect(config.stt.limits).toEqual({ maxUploadMb: 10, maxUploadBytes: 10 * 1024 * 1024, maxDurationSeconds: 60 });
    expect(config.stt.elevenLabs).toMatchObject({
      apiKey: undefined,
      baseUrl: 'https://api.elevenlabs.io',
      modelId: 'scribe_v2',
      tagAudioEvents: false,
    });
    expect(config.stt.whisper.modelPath).toBe(path.resolve(baseDir, DEFAULT_WHISPER_MODEL_PATH));
    expect(config.stt.whisper.cliPath).toBe('whisper-cli'); // resolved via PATH at spawn time
    expect(config.stt.whisper.ffmpegPath).toBe('ffmpeg');
  });

  it('treats blank values as unset', () => {
    expect(loadConfig({ ELEVENLABS_API_KEY: '   ', PORT: '' }, { baseDir }).stt.elevenLabs.apiKey).toBeUndefined();
  });

  it('reads overrides and resolves relative tool paths from the base directory', () => {
    const config = loadConfig(
      {
        STT_PROVIDER: 'whisper-local',
        STT_FALLBACK_PROVIDER: 'none',
        WHISPER_CLI_PATH: './vendor/whisper.cpp/build/bin/whisper-cli',
        WHISPER_MODEL_PATH: 'models/ggml-medium.en.bin',
        FFMPEG_PATH: '/usr/local/bin/ffmpeg',
        WHISPER_THREADS: '4',
        MAX_AUDIO_UPLOAD_MB: '5',
        MAX_UTTERANCE_SECONDS: '30',
        ELEVENLABS_BASE_URL: 'https://api.elevenlabs.io/',
        PORT: '4000',
      },
      { baseDir },
    );
    expect(config.stt.whisper.cliPath).toBe('/repo/vendor/whisper.cpp/build/bin/whisper-cli');
    expect(config.stt.whisper.modelPath).toBe('/repo/models/ggml-medium.en.bin');
    expect(config.stt.whisper.ffmpegPath).toBe('/usr/local/bin/ffmpeg');
    expect(config.stt.whisper.threads).toBe(4);
    expect(config.stt.limits.maxUploadBytes).toBe(5 * 1024 * 1024);
    expect(config.stt.elevenLabs.baseUrl).toBe('https://api.elevenlabs.io');
    expect(config.server.port).toBe(4000);
    expect(createSttProviders(config.stt).map((p) => p.id)).toEqual(['whisper-local']);
  });
});

describe('loadConfig validation', () => {
  it('collects every problem in one ConfigError', () => {
    const error = (() => {
      try {
        loadConfig(
          {
            STT_PROVIDER: 'lemonlabs',
            MAX_UTTERANCE_SECONDS: 'sixty',
            MAX_AUDIO_UPLOAD_MB: '500',
            ELEVENLABS_TAG_AUDIO_EVENTS: 'maybe',
            ELEVENLABS_BASE_URL: 'http://evil.example.com',
            WHISPER_LANGUAGE: 'english',
          },
          { baseDir },
        );
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(ConfigError);
    const issues = (error as ConfigError).issues.join('\n');
    expect(issues).toContain('STT_PROVIDER');
    expect(issues).toContain('MAX_UTTERANCE_SECONDS');
    expect(issues).toContain('MAX_AUDIO_UPLOAD_MB');
    expect(issues).toContain('ELEVENLABS_TAG_AUDIO_EVENTS');
    expect(issues).toContain('ELEVENLABS_BASE_URL must use https');
    expect(issues).toContain('WHISPER_LANGUAGE');
  });

  it('rejects a fallback equal to the primary', () => {
    expect(() => loadConfig({ STT_PROVIDER: 'fake', STT_FALLBACK_PROVIDER: 'fake' }, { baseDir })).toThrow(/must differ/);
  });

  it('never echoes the API key in errors or summaries', () => {
    try {
      loadConfig({ ELEVENLABS_API_KEY: TEST_API_KEY, PORT: 'not-a-port' }, { baseDir });
    } catch (error) {
      expect((error as Error).message).not.toContain(TEST_API_KEY);
    }
    const config = loadConfig({ ELEVENLABS_API_KEY: TEST_API_KEY }, { baseDir });
    const summary = JSON.stringify(describeSttConfig(config.stt));
    expect(summary).not.toContain(TEST_API_KEY);
    expect(summary).toContain('"apiKey":"set"');
  });
});

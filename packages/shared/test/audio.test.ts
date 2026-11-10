import { describe, expect, it } from 'vitest';
import { ALLOWED_AUDIO_MIME_TYPES, audioFileExtension, isAllowedAudioMimeType, normalizeAudioMimeType } from '../src/audio';

describe('audio MIME contract', () => {
  it('strips codec parameters and normalizes case', () => {
    expect(normalizeAudioMimeType('Audio/WebM; codecs=opus')).toBe('audio/webm');
    expect(normalizeAudioMimeType(undefined)).toBe('');
  });

  it('accepts the browser recording containers and rejects others', () => {
    for (const type of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/wav', 'audio/x-wav']) {
      expect(isAllowedAudioMimeType(type)).toBe(true);
    }
    for (const type of ['video/webm', 'audio/mpeg', 'text/plain', '', null]) {
      expect(isAllowedAudioMimeType(type)).toBe(false);
    }
  });

  it('maps every allowed type to a file extension', () => {
    for (const type of ALLOWED_AUDIO_MIME_TYPES) expect(audioFileExtension(type)).not.toBe('bin');
    expect(audioFileExtension('audio/mp4;codecs=mp4a.40.2')).toBe('mp4');
    expect(audioFileExtension('application/octet-stream')).toBe('bin');
  });
});

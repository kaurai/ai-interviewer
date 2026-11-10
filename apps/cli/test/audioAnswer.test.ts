import { describe, expect, it } from 'vitest';
import { hasExpectedAudioSignature, wavDurationSeconds } from '../src/audioAnswer';

function oneSecondWav(): Uint8Array {
  const bytes = new Uint8Array(44 + 16_000 * 2);
  const view = new DataView(bytes.buffer);
  const put = (offset: number, text: string) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
  put(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); put(8, 'WAVE');
  put(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  put(36, 'data'); view.setUint32(40, 32_000, true);
  return bytes;
}

describe('audio answer validation', () => {
  it('measures a PCM WAV from its header', () => {
    const wav = oneSecondWav();
    expect(hasExpectedAudioSignature('.wav', wav)).toBe(true);
    expect(wavDurationSeconds(wav)).toBe(1);
  });

  it('does not trust an extension without matching magic bytes', () => {
    expect(hasExpectedAudioSignature('.wav', new TextEncoder().encode('not audio'))).toBe(false);
    expect(hasExpectedAudioSignature('.ogg', new Uint8Array([0x4f, 0x67, 0x67, 0x53]))).toBe(true);
  });
});

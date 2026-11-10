import { describe, expect, it, vi } from 'vitest';
import { PREFERRED_RECORDING_MIME_TYPES, selectRecordingMimeType } from '../src/voice/mimeTypes';
import { RecorderError, createAudioRecorder, detectRecorderEnvironment, type Recording } from '../src/voice/recorder';
import { FakeMediaRecorder, fakeEnvironment } from './fakes';

const supports = (...types: string[]) => (type: string) => types.includes(type);

describe('MediaRecorder MIME capability detection', () => {
  it('prefers WebM/Opus where available (Chrome, Edge, Firefox)', () => {
    expect(selectRecordingMimeType(supports('audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'))).toBe('audio/webm;codecs=opus');
  });

  it('chooses MP4 on Safari instead of assuming WebM', () => {
    expect(selectRecordingMimeType(supports('audio/mp4'))).toBe('audio/mp4');
    expect(selectRecordingMimeType(supports('audio/mp4;codecs=mp4a.40.2', 'audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  it('falls back to Ogg, then WAV', () => {
    expect(selectRecordingMimeType(supports('audio/ogg;codecs=opus'))).toBe('audio/ogg;codecs=opus');
    expect(selectRecordingMimeType(supports('audio/wav'))).toBe('audio/wav');
  });

  it('returns undefined to use the browser default when nothing matches or detection is missing', () => {
    expect(selectRecordingMimeType(supports('video/x-matroska'))).toBeUndefined();
    expect(selectRecordingMimeType(undefined)).toBeUndefined();
    expect(
      selectRecordingMimeType(() => {
        throw new Error('broken');
      }),
    ).toBeUndefined();
  });

  it('only offers types the server accepts', () => {
    const asked: string[] = [];
    selectRecordingMimeType((type) => {
      asked.push(type);
      return false;
    });
    expect(asked).toEqual([...PREFERRED_RECORDING_MIME_TYPES]);
  });
});

describe('detectRecorderEnvironment', () => {
  it('returns null without mediaDevices or MediaRecorder (typed fallback)', () => {
    expect(detectRecorderEnvironment({ setTimeout, clearTimeout })).toBeNull();
    expect(detectRecorderEnvironment({ navigator: { mediaDevices: { getUserMedia: async () => ({}) } }, setTimeout, clearTimeout })).toBeNull();
  });

  it('detects a capable browser scope', () => {
    const env = detectRecorderEnvironment({
      navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
      MediaRecorder: FakeMediaRecorder,
      setTimeout,
      clearTimeout,
    });
    expect(env).not.toBeNull();
  });
});

describe('createAudioRecorder', () => {
  it('records with the detected MIME type and returns blob, base type, and duration', async () => {
    const env = fakeEnvironment({ supported: ['audio/mp4'], defaultMimeType: 'audio/mp4' });
    const recorder = createAudioRecorder(env);
    await recorder.start();
    expect(recorder.isRecording).toBe(true);
    const instance = FakeMediaRecorder.controls.instances[0]!;
    expect(instance.options).toEqual({ mimeType: 'audio/mp4' });
    expect(instance.timeslice).toBe(1000);

    env.clock.now += 4321;
    const recording = await recorder.stop();
    expect(recording.mimeType).toBe('audio/mp4');
    expect(recording.blob.type).toBe('audio/mp4');
    expect(recording.blob.size).toBe(512);
    expect(recording.durationSeconds).toBe(4.32);
    expect(recording.autoStopped).toBe(false);
    expect(recorder.isRecording).toBe(false);
  });

  it('strips codec parameters from the recorded type', async () => {
    const env = fakeEnvironment();
    const recorder = createAudioRecorder(env);
    await recorder.start();
    env.clock.now += 1000;
    expect((await recorder.stop()).mimeType).toBe('audio/webm');
  });

  it('releases the microphone after stopping', async () => {
    const env = fakeEnvironment();
    const recorder = createAudioRecorder(env);
    await recorder.start();
    env.clock.now += 1000;
    await recorder.stop();
    expect(env.stream.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('auto-stops at the 60 second limit and clamps the reported duration', async () => {
    const env = fakeEnvironment();
    const recorder = createAudioRecorder(env);
    const onAutoStop = vi.fn<(recording: Promise<Recording>) => void>();
    await recorder.start({ onAutoStop });
    expect(env.timers[0]!.ms).toBe(60_000);

    env.clock.now += 60_250; // timers fire slightly late in real browsers
    env.fireTimers();
    expect(onAutoStop).toHaveBeenCalledTimes(1);
    const recording = await onAutoStop.mock.calls[0]![0];
    expect(recording.autoStopped).toBe(true);
    expect(recording.durationSeconds).toBe(60);
    expect(env.stream.tracks.every((t) => t.stopped)).toBe(true);
    // Once the auto-stopped recording is delivered, a late manual stop is a no-op error.
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'not_recording' });
  });

  it('honors a custom limit', async () => {
    const env = fakeEnvironment();
    await createAudioRecorder(env, { maxDurationSeconds: 15 }).start();
    expect(env.timers[0]!.ms).toBe(15_000);
  });

  it.each([
    ['NotAllowedError', 'permission_denied'],
    ['SecurityError', 'permission_denied'],
    ['NotFoundError', 'no_microphone'],
    ['NotReadableError', 'microphone_busy'],
    ['TypeError', 'recording_failed'],
  ])('maps getUserMedia %s to %s', async (name, code) => {
    const recorder = createAudioRecorder(fakeEnvironment({ getUserMediaError: { name } }));
    const error = await recorder.start().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecorderError);
    expect((error as RecorderError).code).toBe(code);
    expect(recorder.isRecording).toBe(false);
  });

  it('rejects an empty recording', async () => {
    const env = fakeEnvironment({ chunkBytes: 0 });
    const recorder = createAudioRecorder(env);
    await recorder.start();
    env.clock.now += 2000;
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'empty_recording' });
  });

  it('rejects a browser default container the server cannot accept', async () => {
    const env = fakeEnvironment({ supported: [], defaultMimeType: 'video/x-matroska' });
    const recorder = createAudioRecorder(env);
    await recorder.start();
    expect(FakeMediaRecorder.controls.instances[0]!.options).toBeUndefined();
    env.clock.now += 2000;
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'unsupported_format' });
  });

  it('prevents overlapping recordings and stops without a recording', async () => {
    const env = fakeEnvironment();
    const recorder = createAudioRecorder(env);
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'not_recording' });
    await recorder.start();
    await expect(recorder.start()).rejects.toMatchObject({ code: 'already_recording' });
  });

  it('cancel discards audio and releases the microphone', async () => {
    const env = fakeEnvironment();
    const recorder = createAudioRecorder(env);
    await recorder.start();
    recorder.cancel();
    expect(recorder.isRecording).toBe(false);
    expect(env.stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(env.timers[0]!.cleared).toBe(true);
  });
});

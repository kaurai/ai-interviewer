import { DEFAULT_MAX_UTTERANCE_SECONDS, isAllowedAudioMimeType } from '@ai-interviewer/shared';
import { selectRecordingMimeType } from './mimeTypes';

/**
 * Push-to-talk recorder around getUserMedia + MediaRecorder.
 *
 * - detects a supported MIME type instead of assuming WebM;
 * - stops automatically at the utterance limit (60 s by default);
 * - always releases the microphone (stops every track) when recording ends;
 * - reports failures as typed `RecorderError`s so the UI can switch to typing.
 *
 * Browser APIs are injected through `RecorderEnvironment`, so this module has
 * no framework dependency and is unit-tested in Node with fakes.
 */

export interface MediaStreamLike {
  getTracks(): Array<{ stop(): void }>;
}

export interface MediaRecorderLike {
  readonly state: 'inactive' | 'recording' | 'paused';
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(timesliceMs?: number): void;
  stop(): void;
}

export interface MediaRecorderConstructorLike {
  new (stream: MediaStreamLike, options?: { mimeType?: string }): MediaRecorderLike;
  isTypeSupported?(type: string): boolean;
}

export interface RecorderEnvironment {
  getUserMedia(constraints: { audio: boolean | Record<string, unknown> }): Promise<MediaStreamLike>;
  MediaRecorder: MediaRecorderConstructorLike;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type RecorderErrorCode =
  | 'unsupported'
  | 'permission_denied'
  | 'no_microphone'
  | 'microphone_busy'
  | 'already_recording'
  | 'not_recording'
  | 'unsupported_format'
  | 'empty_recording'
  | 'recording_failed';

export class RecorderError extends Error {
  override readonly name = 'RecorderError';

  constructor(
    readonly code: RecorderErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Recording {
  blob: Blob;
  /** Base MIME type accepted by the server, e.g. `audio/mp4`. */
  mimeType: string;
  /** Measured length, clamped to the configured maximum. */
  durationSeconds: number;
  /** True when the recorder stopped itself at the time limit. */
  autoStopped: boolean;
}

export interface StartOptions {
  /** Called once if the time limit stops the recording. */
  onAutoStop?: (recording: Promise<Recording>) => void;
}

export interface AudioRecorder {
  readonly isRecording: boolean;
  readonly maxDurationSeconds: number;
  start(options?: StartOptions): Promise<void>;
  stop(): Promise<Recording>;
  /** Stop and discard; always releases the microphone. */
  cancel(): void;
}

export interface RecorderOptions {
  maxDurationSeconds?: number;
  /** MediaRecorder timeslice; periodic chunks survive a mid-recording error. */
  timesliceMs?: number;
}

/** Browser environment, or null when recording is impossible (typed fallback). */
export function detectRecorderEnvironment(scope: unknown = globalThis): RecorderEnvironment | null {
  const g = scope as {
    navigator?: { mediaDevices?: { getUserMedia?: unknown } };
    MediaRecorder?: MediaRecorderConstructorLike;
    performance?: { now(): number };
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  const mediaDevices = g.navigator?.mediaDevices;
  const Recorder = g.MediaRecorder;
  const getUserMedia = mediaDevices?.getUserMedia;
  if (!mediaDevices || typeof getUserMedia !== 'function' || typeof Recorder !== 'function') return null;
  return {
    getUserMedia: (constraints) => (getUserMedia as (c: unknown) => Promise<MediaStreamLike>).call(mediaDevices, constraints),
    MediaRecorder: Recorder,
    now: () => g.performance?.now() ?? Date.now(),
    setTimeout: (callback, ms) => g.setTimeout(callback, ms),
    clearTimeout: (handle) => g.clearTimeout(handle),
  };
}

function mapGetUserMediaError(error: unknown): RecorderError {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new RecorderError('permission_denied', 'Microphone permission was denied. You can type your answer instead.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new RecorderError('no_microphone', 'No microphone was found. You can type your answer instead.');
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new RecorderError('microphone_busy', 'The microphone is in use by another application.');
  }
  return new RecorderError('recording_failed', 'Could not start the microphone.');
}

export function createAudioRecorder(env: RecorderEnvironment, options: RecorderOptions = {}): AudioRecorder {
  const maxDurationSeconds = options.maxDurationSeconds ?? DEFAULT_MAX_UTTERANCE_SECONDS;
  const timesliceMs = options.timesliceMs ?? 1000;

  let stream: MediaStreamLike | null = null;
  let recorder: MediaRecorderLike | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let timer: unknown = null;
  let requestedMimeType: string | undefined;
  let stopping: Promise<Recording> | null = null;
  let starting = false;

  const releaseMicrophone = () => {
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  };

  const reset = () => {
    releaseMicrophone();
    recorder = null;
    chunks = [];
    stopping = null;
  };

  function finish(autoStopped: boolean): Promise<Recording> {
    if (stopping) return stopping;
    const active = recorder;
    if (!active) return Promise.reject(new RecorderError('not_recording', 'No recording is in progress.'));

    stopping = new Promise<Recording>((resolve, reject) => {
      active.onerror = () => {
        reset();
        reject(new RecorderError('recording_failed', 'Recording failed.'));
      };
      active.onstop = () => {
        const durationSeconds = Math.min(Math.max((env.now() - startedAt) / 1000, 0), maxDurationSeconds);
        const mimeType = (active.mimeType || requestedMimeType || chunks[0]?.type || '').split(';', 1)[0]!.trim().toLowerCase();
        const blob = new Blob(chunks, { type: mimeType });
        reset();
        if (!isAllowedAudioMimeType(mimeType)) {
          reject(new RecorderError('unsupported_format', 'This browser recorded an audio format the server cannot accept.'));
        } else if (blob.size === 0 || durationSeconds <= 0) {
          reject(new RecorderError('empty_recording', 'Nothing was recorded. Try again.'));
        } else {
          resolve({ blob, mimeType, durationSeconds: Math.round(durationSeconds * 100) / 100, autoStopped });
        }
      };
    });
    // Tracks are stopped in `onstop`, after MediaRecorder flushes its last chunk.
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
    try {
      if (active.state !== 'inactive') active.stop();
    } catch {
      reset();
      return Promise.reject(new RecorderError('recording_failed', 'Recording failed.'));
    }
    return stopping;
  }

  return {
    maxDurationSeconds,
    get isRecording() {
      return recorder !== null && stopping === null;
    },

    async start(startOptions = {}) {
      if (recorder || starting) throw new RecorderError('already_recording', 'A recording is already in progress.');
      starting = true;
      try {
        try {
          stream = await env.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
        } catch (error) {
          throw mapGetUserMediaError(error);
        }
        requestedMimeType = selectRecordingMimeType(env.MediaRecorder.isTypeSupported?.bind(env.MediaRecorder));
        try {
          recorder = new env.MediaRecorder(stream, requestedMimeType ? { mimeType: requestedMimeType } : undefined);
          chunks = [];
          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) chunks.push(event.data);
          };
          recorder.start(timesliceMs);
        } catch {
          reset();
          throw new RecorderError('recording_failed', 'This browser could not start recording.');
        }
        startedAt = env.now();
        timer = env.setTimeout(() => {
          timer = null;
          const result = finish(true);
          result.catch(() => undefined); // the onAutoStop consumer handles it
          startOptions.onAutoStop?.(result);
        }, maxDurationSeconds * 1000);
      } finally {
        starting = false;
      }
    },

    stop: () => finish(false),

    cancel() {
      const active = recorder;
      if (active) {
        active.onstop = null;
        active.ondataavailable = null;
        try {
          if (active.state !== 'inactive') active.stop();
        } catch {
          // already stopped
        }
      }
      reset();
    },
  };
}

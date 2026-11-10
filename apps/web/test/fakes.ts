import type { MediaRecorderLike, MediaStreamLike, RecorderEnvironment } from '../src/voice/recorder';

/**
 * Minimal browser fakes. Node provides Blob/FormData/Response, so only
 * getUserMedia, MediaRecorder, and the clock need faking.
 */

export class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

export class FakeStream implements MediaStreamLike {
  readonly tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

export interface FakeRecorderControls {
  instances: FakeMediaRecorder[];
  supported: Set<string>;
  /** MIME type the fake reports when none was requested. */
  defaultMimeType: string;
  /** Bytes emitted per chunk; 0 simulates an empty recording. */
  chunkBytes: number;
}

export class FakeMediaRecorder implements MediaRecorderLike {
  static controls: FakeRecorderControls;

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.controls.supported.has(type);
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  timeslice: number | undefined;

  constructor(
    readonly stream: MediaStreamLike,
    readonly options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? FakeMediaRecorder.controls.defaultMimeType;
    FakeMediaRecorder.controls.instances.push(this);
  }

  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    // Real browsers deliver the final dataavailable, then stop, asynchronously.
    queueMicrotask(() => {
      const bytes = FakeMediaRecorder.controls.chunkBytes;
      this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}

export interface FakeEnvironment extends RecorderEnvironment {
  stream: FakeStream;
  clock: { now: number };
  timers: Array<{ callback: () => void; ms: number; cleared: boolean }>;
  /** Run every pending timer, as if its delay elapsed. */
  fireTimers(): void;
}

export function fakeEnvironment(
  options: { supported?: string[]; defaultMimeType?: string; chunkBytes?: number; getUserMediaError?: { name: string } } = {},
): FakeEnvironment {
  FakeMediaRecorder.controls = {
    instances: [],
    supported: new Set(options.supported ?? ['audio/webm;codecs=opus', 'audio/webm']),
    defaultMimeType: options.defaultMimeType ?? 'audio/webm',
    chunkBytes: options.chunkBytes ?? 512,
  };
  const stream = new FakeStream();
  const clock = { now: 1000 };
  const timers: FakeEnvironment['timers'] = [];
  return {
    stream,
    clock,
    timers,
    fireTimers() {
      for (const timer of timers.splice(0)) if (!timer.cleared) timer.callback();
    },
    async getUserMedia() {
      if (options.getUserMediaError) throw Object.assign(new Error('denied'), options.getUserMediaError);
      return stream;
    },
    MediaRecorder: FakeMediaRecorder,
    now: () => clock.now,
    setTimeout(callback, ms) {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(handle) {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

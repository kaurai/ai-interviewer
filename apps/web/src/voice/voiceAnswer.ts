import { RecorderError, type AudioRecorder, type Recording } from './recorder';
import { TranscriptionClientError, type TranscriptionClient } from './transcriptionClient';

/**
 * Voice-or-typed answer controller: the state machine a UI binds to.
 *
 *   idle -> recording -> transcribing -> review  (edit, then submit)
 *     \______________ any failure ______________-> typing (draft preserved)
 *
 * The transcript is only a draft. The candidate can always edit it, and the
 * text they submit is the canonical answer (CONTEXT.md 11.1). Any microphone
 * or STT failure switches to typing without discarding what is already in the
 * draft. A missing recorder (no MediaRecorder, insecure origin) starts in
 * typing mode.
 */

export type VoiceAnswerStatus = 'idle' | 'recording' | 'transcribing' | 'review' | 'typing';

export interface VoiceAnswerNotice {
  code: string;
  message: string;
  retryable: boolean;
}

export interface VoiceAnswerState {
  status: VoiceAnswerStatus;
  /** Editable answer text. */
  draft: string;
  voiceAvailable: boolean;
  /** Last failure or informational notice, for an accessible status region. */
  notice: VoiceAnswerNotice | null;
  /** STT provider that produced the latest transcript, if any. */
  provider: string | null;
  fallbackUsed: boolean;
  /** Whether any part of the draft came from speech. */
  usedVoice: boolean;
  /** The candidate changed the text after it was transcribed. */
  editedAfterTranscription: boolean;
}

export interface AnswerSubmission {
  text: string;
  inputMethod: 'voice' | 'text';
  transcriptEdited: boolean;
  sttProvider: string | null;
}

export interface VoiceAnswerController {
  getState(): VoiceAnswerState;
  subscribe(listener: (state: VoiceAnswerState) => void): () => void;
  startRecording(): Promise<void>;
  /** Stop recording, transcribe, and move to review (or typing on failure). */
  stopRecording(): Promise<void>;
  cancel(): void;
  setDraft(text: string): void;
  switchToTyping(): void;
  /** Trimmed answer ready for POST /api/interviews/:id/turn, or null if empty. */
  getSubmission(): AnswerSubmission | null;
  reset(): void;
}

export interface VoiceAnswerOptions {
  /** `null` when the browser cannot record; the controller starts in typing mode. */
  recorder: AudioRecorder | null;
  client: TranscriptionClient;
}

function noticeFrom(error: unknown): VoiceAnswerNotice {
  if (error instanceof RecorderError) return { code: error.code, message: error.message, retryable: error.code !== 'unsupported' };
  if (error instanceof TranscriptionClientError) {
    return { code: error.code, message: `${error.message} Your typed answer is still available.`, retryable: error.retryable };
  }
  return { code: 'unknown', message: 'Voice input failed. Please type your answer.', retryable: true };
}

export function createVoiceAnswerController({ recorder, client }: VoiceAnswerOptions): VoiceAnswerController {
  const initial = (): VoiceAnswerState => ({
    status: recorder ? 'idle' : 'typing',
    draft: '',
    voiceAvailable: recorder !== null,
    notice: recorder ? null : { code: 'unsupported', message: 'Voice recording is not available in this browser. Type your answer.', retryable: false },
    provider: null,
    fallbackUsed: false,
    usedVoice: false,
    editedAfterTranscription: false,
  });

  let state = initial();
  const listeners = new Set<(state: VoiceAnswerState) => void>();
  let inFlight: AbortController | null = null;

  const update = (patch: Partial<VoiceAnswerState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };

  const fail = (error: unknown) => update({ status: 'typing', notice: noticeFrom(error) });

  async function transcribe(recordingPromise: Promise<Recording>): Promise<void> {
    // Auto-stop and a manual stop can race; only the first one transcribes.
    if (state.status === 'transcribing') return;
    update({ status: 'transcribing', notice: null });
    let recording: Recording;
    try {
      recording = await recordingPromise;
    } catch (error) {
      return fail(error);
    }
    if (recording.autoStopped) {
      update({ notice: { code: 'time_limit', message: 'Recording stopped at the time limit.', retryable: false } });
    }

    inFlight = new AbortController();
    try {
      const result = await client.transcribe({
        audio: recording.blob,
        mimeType: recording.mimeType,
        durationSeconds: recording.durationSeconds,
        signal: inFlight.signal,
      });
      if (result.noSpeechDetected || result.text.trim() === '') {
        update({ status: 'typing', notice: { code: 'no_speech', message: 'No speech was detected. Try again or type your answer.', retryable: true } });
        return;
      }
      // Append rather than replace, so earlier typed or spoken text survives.
      const draft = state.draft.trim() === '' ? result.text : `${state.draft.trimEnd()} ${result.text}`;
      update({
        status: 'review',
        draft,
        provider: result.provider,
        fallbackUsed: result.fallbackUsed,
        usedVoice: true,
        editedAfterTranscription: false,
      });
    } catch (error) {
      if (error instanceof TranscriptionClientError && error.code === 'aborted') return;
      fail(error);
    } finally {
      inFlight = null;
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async startRecording() {
      if (!recorder) return fail(new RecorderError('unsupported', 'Voice recording is not available in this browser. Type your answer.'));
      if (state.status === 'recording' || state.status === 'transcribing') return;
      try {
        await recorder.start({ onAutoStop: (recording) => void transcribe(recording) });
        update({ status: 'recording', notice: null });
      } catch (error) {
        fail(error);
      }
    },

    async stopRecording() {
      if (!recorder || state.status !== 'recording') return;
      await transcribe(recorder.stop());
    },

    cancel() {
      recorder?.cancel();
      inFlight?.abort();
      inFlight = null;
      update({ status: state.draft.trim() === '' && recorder ? 'idle' : 'typing', notice: null });
    },

    setDraft(text) {
      update({ draft: text, editedAfterTranscription: state.usedVoice ? true : state.editedAfterTranscription });
    },

    switchToTyping() {
      if (state.status === 'recording') recorder?.cancel();
      inFlight?.abort();
      update({ status: 'typing' });
    },

    getSubmission() {
      const text = state.draft.trim();
      if (text === '') return null;
      return {
        text,
        inputMethod: state.usedVoice ? 'voice' : 'text',
        transcriptEdited: state.editedAfterTranscription,
        sttProvider: state.provider,
      };
    },

    reset() {
      recorder?.cancel();
      inFlight?.abort();
      state = initial();
      for (const listener of listeners) listener(state);
    },
  };
}

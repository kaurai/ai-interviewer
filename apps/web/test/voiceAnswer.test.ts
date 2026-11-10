import { describe, expect, it } from 'vitest';
import { createAudioRecorder } from '../src/voice/recorder';
import { TranscriptionClientError, type TranscriptionClient, type TranscriptionSuccess } from '../src/voice/transcriptionClient';
import { createVoiceAnswerController } from '../src/voice/voiceAnswer';
import { fakeEnvironment } from './fakes';

function fakeClient(behavior: Partial<TranscriptionSuccess> | TranscriptionClientError): TranscriptionClient & { calls: number } {
  const client = {
    calls: 0,
    async transcribe() {
      client.calls += 1;
      if (behavior instanceof TranscriptionClientError) throw behavior;
      return { text: 'spoken answer', noSpeechDetected: false, provider: 'elevenlabs', fallbackUsed: false, languageCode: 'en', ...behavior };
    },
  };
  return client;
}

function setup(client: TranscriptionClient, envOptions: Parameters<typeof fakeEnvironment>[0] = {}) {
  const env = fakeEnvironment(envOptions);
  const controller = createVoiceAnswerController({ recorder: createAudioRecorder(env), client });
  return { env, controller };
}

async function recordFor(env: ReturnType<typeof fakeEnvironment>, controller: ReturnType<typeof createVoiceAnswerController>, ms = 3000) {
  await controller.startRecording();
  env.clock.now += ms;
  await controller.stopRecording();
}

describe('voice answer controller', () => {
  it('records, transcribes, and offers the transcript for editing before submission', async () => {
    const { env, controller } = setup(fakeClient({ text: 'I would use a queue', provider: 'whisper-local', fallbackUsed: true }));
    const statuses: string[] = [];
    controller.subscribe((s) => statuses.push(s.status));

    await recordFor(env, controller);
    expect(statuses).toEqual(['recording', 'transcribing', 'review']);
    expect(controller.getState()).toMatchObject({ draft: 'I would use a queue', provider: 'whisper-local', fallbackUsed: true, usedVoice: true });

    controller.setDraft('I would use a durable queue');
    expect(controller.getSubmission()).toEqual({
      text: 'I would use a durable queue',
      inputMethod: 'voice',
      transcriptEdited: true,
      sttProvider: 'whisper-local',
    });
  });

  it('starts in typing mode when the browser cannot record', () => {
    const controller = createVoiceAnswerController({ recorder: null, client: fakeClient({}) });
    expect(controller.getState()).toMatchObject({ status: 'typing', voiceAvailable: false, notice: { code: 'unsupported' } });
    controller.setDraft('typed answer');
    expect(controller.getSubmission()).toEqual({ text: 'typed answer', inputMethod: 'text', transcriptEdited: false, sttProvider: null });
  });

  it('falls back to typing and keeps the existing draft when STT fails', async () => {
    const quota = new TranscriptionClientError('stt_quota_exceeded', 'Credits are exhausted.', false, 429);
    const { env, controller } = setup(fakeClient(quota));
    controller.setDraft('What I typed so far');

    await recordFor(env, controller);
    expect(controller.getState()).toMatchObject({ status: 'typing', draft: 'What I typed so far', notice: { code: 'stt_quota_exceeded', retryable: false } });
    expect(controller.getSubmission()?.inputMethod).toBe('text');
  });

  it('falls back to typing when microphone permission is denied', async () => {
    const client = fakeClient({});
    const { controller } = setup(client, { getUserMediaError: { name: 'NotAllowedError' } });
    await controller.startRecording();
    expect(controller.getState()).toMatchObject({ status: 'typing', notice: { code: 'permission_denied' } });
    expect(client.calls).toBe(0);
  });

  it('treats silence as a prompt to retry or type, not as an answer', async () => {
    const { env, controller } = setup(fakeClient({ text: '', noSpeechDetected: true }));
    await recordFor(env, controller);
    expect(controller.getState()).toMatchObject({ status: 'typing', draft: '', notice: { code: 'no_speech' } });
    expect(controller.getSubmission()).toBeNull();
  });

  it('appends a new transcript to text already in the draft', async () => {
    const { env, controller } = setup(fakeClient({ text: 'and then retry with backoff.' }));
    controller.setDraft('First I would log the failure');
    await recordFor(env, controller);
    expect(controller.getState().draft).toBe('First I would log the failure and then retry with backoff.');
  });

  it('transcribes automatically when the time limit stops recording', async () => {
    const client = fakeClient({ text: 'long answer' });
    const { env, controller } = setup(client);
    await controller.startRecording();
    env.clock.now += 61_000;
    env.fireTimers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getState()).toMatchObject({ status: 'review', draft: 'long answer', notice: { code: 'time_limit' } });
    // A stop click that races the auto-stop does not transcribe twice.
    await controller.stopRecording();
    expect(client.calls).toBe(1);
  });

  it('switchToTyping cancels an active recording and releases the microphone', async () => {
    const client = fakeClient({});
    const { env, controller } = setup(client);
    await controller.startRecording();
    controller.switchToTyping();
    expect(controller.getState().status).toBe('typing');
    expect(env.stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(client.calls).toBe(0);
  });

  it('reset clears the draft for the next question', async () => {
    const { env, controller } = setup(fakeClient({}));
    await recordFor(env, controller);
    controller.reset();
    expect(controller.getState()).toMatchObject({ status: 'idle', draft: '', usedVoice: false, provider: null });
  });
});

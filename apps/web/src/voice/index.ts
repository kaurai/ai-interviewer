/**
 * Framework-light browser voice input. A future React hook
 * (`useAudioRecorder`) can wrap these without changing them:
 *
 *   const env = detectRecorderEnvironment();
 *   const controller = createVoiceAnswerController({
 *     recorder: env ? createAudioRecorder(env, { maxDurationSeconds: 60 }) : null,
 *     client: createTranscriptionClient({ endpoint: '/api/audio/transcribe' }),
 *   });
 *   controller.subscribe(render);
 */
export * from './mimeTypes';
export * from './recorder';
export * from './transcriptionClient';
export * from './voiceAnswer';

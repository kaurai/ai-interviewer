# Pipeline operations

## Common commands

```bash
npm run doctor
npm run interview:demo
npm run interview
npm run interview -- --resume ./resume.pdf --role backend --seniority mid --questions 3
npm run interview -- --mode voice --tts say --duration 5
npm run interview -- delete <session-id>
npm run test:pipeline
```

`--answers` points to a JSON array of strings for deterministic scripts. Use
`--no-save --yes` in automated demos. Scripted runs use text mode and must not
touch STT or TTS.

## Diagnosis order

1. Run `npm run doctor`; configuration errors are blocking, optional provider
   readiness is a warning because typing works.
2. Run `npm run interview:demo`. If it fails, the problem is in core pipeline
   composition rather than real resume/audio input.
3. Run `npm run test:pipeline`, then the focused question or STT suite.
4. Inspect only safe metadata: provider ID, safe error code, session status,
   question ID, and stack trace. Never print keys, audio, raw resume, or answer
   text as a diagnostic shortcut.

## Voice-file syntax

- WAV: `/audio ./answer.wav` (duration from RIFF header).
- WebM/MP4/M4A/Ogg: `/audio ./answer.m4a 37.5` (declared seconds).
- A typed answer remains valid in voice mode.

If ElevenLabs is ordered, display the cloud privacy notice before sending the
audio. A missing key or exhausted quota may fail over to whisper.cpp. Invalid
audio never fails over.

## Extension recipes

- Resume format: implement `ResumeParser`, add its extension, lazy-load its
  library, enforce limits, and test corrupt/empty/truncated cases.
- New TTS tool: extend `TTS_PROVIDER_IDS`, implement `SpeechOutput`, use the
  shared process runner with argument arrays, and add a fake-runner test.
- Planning policy: modify `stageTemplate` or diversity selection; keep IDs from
  `QuestionRepository` and add deterministic plan tests.
- Evaluator signal: add exact evidence extraction first, then a conservative
  dimension rule. Never manufacture evidence or turn missing evidence into a
  low score.
- Report format: consume validated `InterviewFeedback`; do not re-score inside
  a renderer.

After any extension, run typecheck, pipeline tests, all tests, doctor, and the
offline demo. Exercise paid/cloud and local binary integrations separately and
state whether they were actually tested.

---
name: implement-speech-to-text
description: Implement, configure, test, diagnose, or extend the AI interviewer's speech-to-text module - ElevenLabs Scribe v2 primary, local whisper.cpp fallback, provider failover, POST /api/audio/transcribe, the browser recorder, and npm run doctor. Use for the voice-input workshop module; do not use for text-to-speech, realtime streaming STT, or interview planning and evaluation.
---

# Implement Speech-to-Text

Build voice input as a replaceable layer: audio goes in, editable draft text
comes out. Interview logic never imports a speech provider, and the candidate
can always correct the transcript or type instead.

## Execution boundary

Work directly in the current Claude Code session. Do not launch a nested
`claude` process, delegate to another model, or add OpenAI/Codex metadata.
Keep normal permission checks.

Claude Code is the development tool, not a runtime provider. Never wire Claude
Code OAuth, subscription credentials, or `claude -p` into the app. Runtime
providers come from `CONTEXT.md`.

## Read first

1. `CONTEXT.md` sections 2.3, 3, 6.1–6.2 (error shape), 11.1–11.4, 12, 13, and
   15. Section 11.2 is the ElevenLabs contract.
2. [references/provider-contracts.md](references/provider-contracts.md) for the
   exact request/response mapping, error taxonomy, failover table, and HTTP
   status codes. If it disagrees with `CONTEXT.md`, `CONTEXT.md` wins.
3. The existing code. Preserve the established module boundaries and names:

| Concern | Path |
|---|---|
| Shared MIME/field contract | `packages/shared/src/audio.ts` |
| Provider interface | `apps/api/src/providers/stt/types.ts` |
| Error taxonomy and failover table | `apps/api/src/providers/stt/errors.ts` |
| Orchestrator | `apps/api/src/providers/stt/orchestrator.ts` |
| ElevenLabs adapter | `apps/api/src/providers/stt/elevenlabs.ts` |
| whisper.cpp adapter and ffmpeg step | `apps/api/src/providers/stt/whisperLocal.ts`, `audioConversion.ts`, `processRunner.ts` |
| Deterministic demo provider | `apps/api/src/providers/stt/fake.ts` |
| Config from env | `apps/api/src/config.ts`, `.env.example` |
| HTTP route and server | `apps/api/src/routes/audio.ts`, `apps/api/src/http/`, `apps/api/src/app.ts`, `apps/api/src/index.ts` |
| Doctor | `apps/api/src/diagnostics/sttDoctor.ts`, `scripts/doctor.ts` |
| Browser recorder, client, controller | `apps/web/src/voice/` |
| Tests | `apps/api/test/stt/`, `apps/web/test/`, `packages/shared/test/audio.test.ts` |

If a piece is missing, build it at that path. If it exists, change it in place.
Never create parallel definitions of the MIME list, provider IDs, or error codes.

## Pick the task mode

Use the caller's request. With no qualifier, run **implement** and then
**verify**.

- **implement**: build or repair the module to the contract below.
- **configure**: help set `.env` and local tools. Run `npm run doctor`; never
  print, echo, or write a real key; never write placeholders into `.env`.
- **diagnose**: reproduce the issue with the doctor, a curl request, or a
  focused test, and match it against
  [references/operations.md](references/operations.md). Fix the cause rather
  than widening the failover policy.
- **extend**: add a provider or capability by following
  [references/extending.md](references/extending.md).
- **teach**: walk a student through the checkpoint in `docs/WORKSHOP.md`,
  pointing at the code that demonstrates each idea.

## Non-negotiable contract

Providers

- `STTProvider` has `id`, `transcribe(request)`, and `checkReadiness()`.
  Results are normalized to text, language code, language probability, word
  timings with logprobs (ElevenLabs), and segments (whisper.cpp).
- ElevenLabs: `POST {ELEVENLABS_BASE_URL}/v1/speech-to-text`, multipart `file`
  and `model_id=scribe_v2`, header `xi-api-key`. Do not send `no_verbatim`, so
  fillers are kept. Do not send paid `keyterms` by default.
- whisper.cpp: run `whisper-cli` through `child_process.spawn` with an argument
  array and `shell: false`. Normalize every upload through a configurable
  `ffmpeg` binary to mono 16 kHz PCM WAV in a private temp directory, and
  delete that directory in `finally`. Never download binaries or models.
- Readiness checks are local only. Never spend credits to check a key.

Failover

- Fail over on `not_configured`, `provider_unavailable`, `auth_failed`,
  `quota_exceeded`, `rate_limited`, `network`, `timeout`, and `upstream`.
- Never fail over or retry on `invalid_audio` or `aborted`.
- Return which provider succeeded, whether fallback was used, and a safe
  reason code. Never return vendor messages or secrets.
- The policy lives in one table (`STT_ERROR_POLICY`) and is injectable for
  tests.

HTTP

- `POST /api/audio/transcribe`: multipart in memory, field `audio`, plus
  `durationSeconds`. Enforce a non-empty file, an allowed browser audio MIME
  type, the upload byte limit (default 10 MB) while streaming, and a duration
  of at most `MAX_UTTERANCE_SECONDS` (default 60).
- Errors use `{ error: { code, message, retryable } }` with explicit statuses.
  See the status table in the provider contracts reference.
- Log metadata only. Never log the key, auth headers, raw audio, or
  transcript text.

Browser

- Detect a MediaRecorder MIME type with `isTypeSupported`; never hard-code WebM.
- Auto-stop at the limit, clamp the reported duration, and always stop tracks.
- The endpoint and `fetch` are injectable.
- The transcript is an editable draft. Any microphone or STT failure switches
  to typing and keeps the existing draft.

## Implementation order

1. Shared MIME contract, then the provider types and error taxonomy.
2. Orchestrator with the explicit policy table, then its tests.
3. ElevenLabs adapter with an injected `fetch`, then tests for request shape,
   normalization, and HTTP error mapping.
4. Process runner, ffmpeg conversion, and whisper adapter with an injected
   runner, then tests for invocation, cleanup, and error mapping.
5. Config loader, `.env.example`, and `.gitignore` entries.
6. Bounded multipart parsing, route, and server, then route tests on an
   ephemeral port using built-in `fetch`.
7. Doctor module and script.
8. Browser MIME selection, recorder, client, and controller, then tests with
   fakes.
9. Documentation: README voice section and the `docs/WORKSHOP.md` checkpoint.

Keep each step runnable. Prefer Node 22 built-ins. Add a dependency only when
the built-in alternative is clearly worse, and install it only with permission.

## Verify

Run:

```bash
npm run test:stt
npm test
npm run typecheck
npm run doctor
```

Tests must never call ElevenLabs or need whisper.cpp or ffmpeg. Use injected
`fetch`, process runners, filesystem fakes, and scripted providers. Required
coverage:

- the ElevenLabs request contract, normalization, and every error mapping;
- the failover table, failover on each eligible code, and no failover on
  invalid input or abort;
- missing configuration (no key, missing model, missing binary);
- the whisper and ffmpeg argument arrays, temp cleanup on success and
  failure, and literal (shell-free) argument passing;
- upload validation and status codes, including the streaming size limit;
- browser MIME selection, the auto-stop limit, microphone errors, and typed
  fallback that preserves the draft;
- no key or transcript text in responses, logs, or doctor output.

If the session cannot run commands, say so plainly, list the commands the user
must run, and do not claim the suite passed.

## Report

Finish with the files changed, the provider order and failover policy, the
commands run with their actual results, anything you could not verify (real
microphone, real ElevenLabs call, real whisper.cpp build), and any deviation
from `CONTEXT.md` together with its reason.

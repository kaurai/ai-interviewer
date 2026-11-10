# Workshop guide

Other workshop sections (timeboxes, live-demo script, later checkpoints) are
added as their phases are built. See `CONTEXT.md` section 16 for the full
curriculum.

## Checkpoint: question bank and retrieval (45–65 min)

**Concept.** Retrieval returns *candidate* questions plus private assessment
criteria. It does not pick the next turn; the planner does that. This
checkpoint runs fully offline: no LLM, network, or API key.

**What exists**

| Piece | Path |
|---|---|
| Zod schemas and competency taxonomy | `packages/shared/src/schemas.ts`, `packages/shared/src/competencies.ts` |
| Deterministic validator | `packages/shared/src/questionValidation.ts`, `scripts/validate-questions.ts` |
| 60 original seed questions | `data/questions/seed-questions.json` |
| Repository (validated, frozen, lookup by ID) | `apps/api/src/data/questionRepository.ts` |
| Lexical retriever with match factors | `apps/api/src/domain/retriever.ts` |
| Tests | `packages/shared/test/`, `apps/api/test/` |

### 1. Run the validator

```bash
npm install
npm run validate:questions      # alias: npm run seed:validate
```

Expected: `OK: no validation issues.`, with 60 records split 18 backend,
14 frontend, 14 product, and 14 behavioral. On failure, the command exits 1 and
prints a line such as
`[error] missing-anchor backend_foo_01: scoringAnchors must define level 5`.

### 2. Inspect one record's private signals and probes

```bash
npm run questions:show -- backend_rate_limiter_01
```

The section labelled PRIVATE holds expected signals, red flags, probe triggers,
and scoring anchors. These stay on the server. Red flags are prompts for the
interviewer to investigate, never automatic penalties.

### 3. Run a retrieval query for a role and focus area

```bash
npm run questions:search -- --role backend --seniority mid --focus caching
npm run questions:search -- --role frontend --seniority senior \
  --competency frontend.accessibility --exclude frontend_accessibility_practice_01 --top 5
npm run questions:search -- --role backend --seniority junior   # triggers behavioral fallback
```

Add `--json` for machine-readable output. That output contains IDs, scores, and
factors, not the private record.

### 4. Observe why the candidates ranked as they did

Each candidate lists its factors, and the points add up to the score:

- `eligibility`: role and seniority filter (0 points).
- `fallback`: −2 when the role pool was smaller than top K and behavioral
  questions were added.
- `focus`: +3 if the focus area equals the topic, +2 if it equals a tag, +1 for
  a partial token match.
- `competency`: +2.5 for each requested missing competency the record targets.
- `lexical`: weighted query-term matches (topic 2, tags 1.5, question and
  intent 1, expected signals 0.75), normalized and then scaled ×2.
- `difficulty`: −1 per step away from the target (junior 2, mid 3, senior 4,
  or `--difficulty`).

Ties are broken by question ID. Asked IDs are always excluded, and so is any
record whose question is at least 0.5 Jaccard-similar to an asked question.
All weights are in `RETRIEVAL_WEIGHTS` and are tunable heuristics. Try changing
one weight and re-running a query.

**Discuss:** why should the planner, not "result #1", choose the next question?

### 5. Add one new original question and make the tests pass

1. Append a record to `data/questions/seed-questions.json`. Use a stable ID
   like `frontend_offline_form_01`, probe IDs like
   `frontend_offline_form_01.retry-queue`, anchors `1`, `3`, and `5`, and
   `"source": { "kind": "original", "title": "AI Interviewer workshop seed bank" }`.
2. Run `npm run validate:questions`. It now fails with `corpus-size` and
   `role-distribution` because the seed contract is exactly 60 records. Either
   replace an existing record of the same primary role, or put your question in
   a separate file and validate it with
   `npm run validate:questions -- path/to/file.json --no-seed-rules`.
3. Fix any other reported rule (word count, difficulty versus seniority,
   near-duplicate, and so on).
4. Run `npm run test:questions` and `npm run typecheck`.

The authoring checklist is in
`.claude/skills/build-question-bank/references/question-authoring.md`.

**Limits to keep in mind:** the validator checks structure, coverage, and
duplication. It cannot show that a question is fair or well calibrated, so
human review still matters. Semantic (embedding) retrieval is a later
extension, and lexical mode remains the fallback.

## Checkpoint: voice input and speech-to-text (10–25 min)

**Concept.** The voice layer only turns audio into *draft* text. The candidate
reviews and edits it, and the submitted text is the canonical answer. Interview
logic never sees a speech provider. Typed answers must keep working when the
microphone, credits, or providers fail.

The Claude Code skill for this module is `/implement-speech-to-text`.

**What exists**

| Piece | Path |
|---|---|
| Provider interface and normalized result | `apps/api/src/providers/stt/types.ts` |
| Typed errors and the failover policy table | `apps/api/src/providers/stt/errors.ts` |
| Orchestrator (primary, then fallback) | `apps/api/src/providers/stt/orchestrator.ts` |
| ElevenLabs Scribe v2 adapter | `apps/api/src/providers/stt/elevenlabs.ts` |
| whisper.cpp adapter, ffmpeg step, safe process runner | `apps/api/src/providers/stt/{whisperLocal,audioConversion,processRunner}.ts` |
| `POST /api/audio/transcribe` | `apps/api/src/routes/audio.ts` |
| Browser recorder, client, answer controller | `apps/web/src/voice/` |
| Doctor | `scripts/doctor.ts` |
| Tests (no network, no binaries) | `apps/api/test/stt/`, `apps/web/test/` |

### 1. Preflight

```bash
cp .env.example .env     # optional
npm run doctor
```

Read each `[OK]`, `[WARN]`, and `[SKIP]` line. A missing key or missing
whisper.cpp is a **warning**, not a failure, because typed answers still work.
The doctor never prints the key and never calls ElevenLabs.

### 2. Run the tests and read the failover table

```bash
npm run test:stt
```

Open `STT_ERROR_POLICY` in `errors.ts`. **Discuss:** why does `quota_exceeded`
fail over to whisper.cpp while `invalid_audio` does not? What would retrying
corrupt audio on a second provider cost?

### 3. Call the endpoint

Start the API with demo transcription (no key, no binaries):

```bash
STT_PROVIDER=fake STT_FALLBACK_PROVIDER=none npm run start:api
```

In a second terminal:

```bash
ffmpeg -f lavfi -i sine=frequency=440:duration=2 -ac 1 /tmp/tone.wav   # or use any short recording
curl -s http://127.0.0.1:3001/api/audio/transcribe \
  -F "audio=@/tmp/tone.wav;type=audio/wav" -F "durationSeconds=2"
curl -s http://127.0.0.1:3001/api/audio/transcribe \
  -F "audio=@/tmp/tone.wav;type=audio/wav" -F "durationSeconds=75"   # 422 audio_too_long
curl -s http://127.0.0.1:3001/api/audio/transcribe \
  -F "audio=@/tmp/tone.wav;type=text/plain" -F "durationSeconds=2"    # 415
```

Then restart with `STT_PROVIDER=elevenlabs` and no key, and compare
`fallback.attempts` with and without a working whisper.cpp install.

### 4. Trace one failover

In `apps/api/test/stt/audioRoute.test.ts`, find *falls back from ElevenLabs
quota exhaustion*. Follow the request: route → orchestrator →
`elevenlabs.ts` (429 → `quota_exceeded`) → fallback provider → response
`fallback.reason`. Note the assertions that the key and the transcript text
never appear in the response or the logs.

### 5. Browser side

Read `apps/web/src/voice/mimeTypes.ts` and `recorder.ts`. **Discuss:** why ask
`MediaRecorder.isTypeSupported` instead of hard-coding WebM? (Safari records
MP4.) Why clamp the reported duration at exactly 60 seconds? Then read
`voiceAnswer.ts`. On every failure it moves to `typing` and keeps the draft.

### 6. Extend it

Pick one:

- Add a fixture to `whisperLocal.test.ts` for a new non-speech marker, such as
  `[MUSIC]`.
- Add a configurable `ELEVENLABS_LANGUAGE_CODE` that is sent as
  `language_code` when set. Follow
  `.claude/skills/implement-speech-to-text/references/extending.md` and keep
  the tests green.

**Limits to keep in mind:** the tests prove contracts and failure handling,
not real-world accuracy. Before class, record a real 20-second answer on
every workshop OS and browser, and run it through each configured provider.
Realtime streaming STT is a later extension.

## Checkpoint: connect the complete interview pipeline (45–70 min)

**Concept.** Keep the orchestration thin: resume parsing produces bounded
signals, the planner selects real bank IDs, the service owns turn state, and
the evaluator can cite only committed candidate text. The Claude Code skill is
`/run-interview-pipeline`.

### 1. Run the offline demo

```bash
npm run interview:demo
```

Trace the output from `apps/cli/src/runner.ts` to the resume extractor,
planner, interview service, evaluator, and report renderer. The synthetic
resume and answers live in `data/fixtures/`; no credential or network call is
needed.

### 2. Inspect the plan before the score

Open the printed **Why these questions were selected** section. Confirm that
resume terms appear only in selection reasons. Then inspect **Evidence** and
verify every quote occurs exactly in a candidate turn. Discuss why resume
claims must not boost evaluation scores.

### 3. Exercise state and privacy controls

```bash
npm run interview -- --questions 3 --no-save
npm run test:pipeline
```

Use `/repeat`, `/skip`, and `/end`. With `--no-save`, confirm that no session
file is created. In a saved run, inspect `data/sessions/<id>.json`: it may hold
the corrected transcript and bounded resume signals, but never resume text,
path, file name, or audio bytes.

### 4. Try a voice-file turn

Set `STT_PROVIDER=fake` and `STT_FALLBACK_PROVIDER=none` for a no-cost wiring
test, run with `--mode voice`, and enter `/audio /path/to/short.wav`. For a real
transcript, configure ElevenLabs or whisper.cpp as described above. Edit the
draft before accepting it and find `stt.edited` in the saved turn.

### 5. Extend one seam

Pick one: add a new `ResumeParser`, alter the deterministic stage template,
add a new `SpeechOutput`, or create a new report renderer. Keep the associated
interface stable and add an injected-fake test. Finish with:

```bash
npm run typecheck
npm run test:pipeline
npm test
npm run doctor
```

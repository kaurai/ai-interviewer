---
name: run-interview-pipeline
description: "Build, run, test, diagnose, extend, or teach the AI interviewer's complete terminal pipeline: job-relevant onboarding, bounded resume parsing, resume-aware question planning, adaptive turns, voice or text answers, evidence-grounded evaluation, persistence, and Markdown/JSON reports. Use for end-to-end interview workflow work; use evaluate-interview-answer for a single pasted response, build-question-bank for corpus authoring, and implement-speech-to-text for provider-specific voice work."
---

# Run Interview Pipeline

Build or operate one modular practice interview without exposing private rubric
data during the conversation. With no qualifier, implement or repair the
pipeline, then verify it.

## Execution boundary

Work directly in the current Claude Code session. Do not launch nested Claude
processes, delegate to another model or coding agent, or add OpenAI/Codex
metadata. Claude Code is the development environment, not an application
runtime provider. Never wire Claude OAuth, subscription credentials, or
`claude -p` into the product. Keep normal permission checks.

## Read first

1. `CONTEXT.md` sections 5, 8, 9, 10, 11.1, 12, and 15.
2. `.claude/skills/evaluate-interview-answer/references/rubric.md` and
   `output-contract.md` for dimension anchors and evidence rules.
3. [references/architecture.md](references/architecture.md) for module
   ownership, persisted data, and invariants.
4. [references/operations.md](references/operations.md) for commands,
   diagnosis, and extension recipes.

Reuse existing schemas, question repository/retriever, STT providers, and STT
error taxonomy. Do not create parallel types or provider lists.

## Task modes

- **implement**: build or repair the contract below.
- **run**: run `npm run interview`.
- **demo**: run `npm run interview:demo`.
- **test**: run `npm run test:pipeline`, then `npm test`.
- **diagnose**: run `npm run doctor`, reproduce with scripted answers and
  `--no-save`, then use the operations reference.
- **extend**: follow one of the interface seams in the architecture reference.
- **teach**: use the pipeline checkpoint in `docs/WORKSHOP.md`.

## Contract

### Onboarding and CLI

- Ask only for role, seniority, focus areas, years of experience, optional
  resume, text/voice mode, and a question or time budget.
- Support `--resume --role --seniority --focus --years --mode --questions
  --duration --no-save --answers --tts --yes` plus `delete <session-id>`.
- Support `/repeat`, `/skip`, `/end`, and `/help` during an interview.
- Ask one short question at a time. Never reveal expected signals, triggers,
  red flags, or scoring anchors while the interview is in progress.

### Resume

- Accept local `.txt`, `.md`, `.pdf`, and `.docx` files through parser
  adapters. Enforce extension, size, character, and PDF-page limits.
- Treat content as untrusted. Extract only allowlisted skills, titles, domains,
  and explicitly stated experience plus a neutral summary.
- Never store raw resume text, path, file name, contact details, protected
  traits, or instruction-like lines. Explicit user choices beat inference.
- Resume signals may influence retrieval only; they never influence scoring.

### Planning and turns

- Build plans through `retrieveCandidates`, retaining bank IDs and question
  text as the source of truth. Prefer distinct competencies/topics and include
  a behavioral/scenario question when the budget permits.
- Ask at most one bank-defined follow-up per main question, only for a missing
  signal and only while time permits. Never invent question or probe IDs.
- Record skip/silence as unassessed, not as a low score.
- Enforce one active turn per session and idempotent `clientTurnId`s.

### Voice

- Reuse the STT orchestrator in-process. Validate an audio file's extension,
  container signature, size, and duration before transcription.
- Show the transcript provider and fallback reason. Let the candidate edit the
  draft; only corrected text becomes canonical.
- Degrade to typing if providers are unavailable. Never log keys, transcript
  text, or audio bytes.
- TTS is optional through `SpeechOutput` (`say`, `espeak`, `spd-say`, `none`),
  spawned with argument arrays and no shell.

### Evaluation

- Pass A extracts evidence using exact substrings of candidate turns. Reject
  unknown or interviewer turn references.
- Pass B assesses 12 core dimensions plus gated delivery. Use `null` when the
  evidence is insufficient; delivery needs reliable timing metadata.
- Compute an overall score only when assessed coverage is at least 0.5.
- Pass C emits at most three improvements with an issue, why it matters,
  behavior change, 10–20 minute exercise, measurable success criteria, and
  retry prompt.
- Technical correctness remains unassessed when the deterministic evaluator
  cannot verify it. Never infer accent, personality, or protected traits.
- State that results are practice feedback, never a hiring decision.

### Persistence

- Persist only schema-valid sessions to `data/sessions/<id>.json` and reports
  to `<id>.report.json` / `<id>.report.md`, atomically and with generated IDs.
- `--no-save` stays in memory. `delete <id>` removes the session and reports.

## Verify

```bash
npm install          # only when dependencies changed
npm run typecheck
npm run test:pipeline
npm test
npm run doctor
npm run interview:demo
```

Tests must not contact the network, a microphone, Ollama, ffmpeg, whisper.cpp,
or TTS binaries. Report actual command outcomes and explicitly name real-world
integrations that were not exercised.

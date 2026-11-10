# Claude Code workflow

## Workshop skills

This repository uses a strict Claude Code-only development workflow.

- Store project skills at `.claude/skills/<skill-name>/SKILL.md` so Claude Code
  discovers them natively.
- Do not add Codex/OpenAI skill metadata such as `agents/openai.yaml`.
- Do not invoke OpenAI models or delegate skill implementation to another coding
  agent unless the user explicitly changes this workflow.
- A skill executes directly in the current Claude Code session. It must not
  launch a nested `claude` process.
- Preserve normal Claude Code permission checks. Never use a
  dangerously-skip-permissions option.
- Claude Code is the development environment only. Do not expose Claude Code
  OAuth, subscription credentials, or `claude -p` as an application runtime
  inference provider. Runtime providers remain governed by `CONTEXT.md`.

Invoke the workshop skills with:

- `/build-question-bank` — build or revise the question corpus, validation,
  retrieval, and question-bank tests.
- `/evaluate-interview-answer` — directly evaluate a supplied interview answer
  or transcript with evidence-grounded, actionable practice feedback (no
  application code changes).
- `/implement-speech-to-text` — implement, configure, test, diagnose, or extend
  voice input: ElevenLabs Scribe v2 with a local whisper.cpp fallback, explicit
  provider failover, `POST /api/audio/transcribe`, the browser recorder, and
  `npm run doctor`.
- `/run-interview-pipeline` — build, run, test, diagnose, or teach the complete
  terminal flow: onboarding, resume-aware planning, adaptive turns, voice/text
  answers, evidence-grounded evaluation, and Markdown/JSON reports.

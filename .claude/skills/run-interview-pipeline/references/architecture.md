# Pipeline architecture

## Flow

```text
CLI onboarding
  -> resume loader -> bounded ResumeProfile
  -> planner -> bank-backed InterviewPlan
  -> interview service -> transcript + turn decisions
  -> evaluator Pass A/B/C -> validated InterviewFeedback
  -> Markdown + JSON reports
```

## Module ownership

| Concern | Owner |
|---|---|
| Runtime schemas | `packages/shared/src/interview.ts`, `evaluation.ts` |
| Resume intake and bounded profile | `apps/api/src/resume/` |
| Question source of truth | `data/questions/seed-questions.json`, `QuestionRepository` |
| Retrieval and plan | `domain/retriever.ts`, `domain/interview/planner.ts` |
| Active turn and idempotency | `domain/interview/service.ts` |
| Voice-to-text | `providers/stt/`, `apps/cli/src/audioAnswer.ts` |
| Evidence and scoring | `domain/evaluator.ts` |
| Presentation | `domain/report.ts` |
| Persistence | `data/sessionStore.ts` |
| Terminal orchestration | `apps/cli/src/runner.ts` |

The CLI composes modules; it must not contain retrieval, scoring, or provider
logic. Zod schemas are runtime boundaries and TypeScript types derive from
them.

## Persistence boundary

Allowed: explicit candidate profile, bounded professional resume signals,
question IDs and selection reasons, corrected transcript, provider IDs and
safe error codes, timing metadata, decisions, evaluation, and reports.

Forbidden: raw resume text, path/file name, contact data, protected traits,
audio bytes, API keys, vendor response bodies, hidden prompts, and temporary
conversion files.

## Invariants worth testing

1. A plan contains only IDs that exist in the validated bank.
2. Resume terms can change selection but not scoring.
3. One question receives no more than one follow-up.
4. Retried client turn IDs return the same outcome; conflicting reuse fails.
5. Every evidence quote occurs in a referenced candidate turn.
6. Skip/silence and unsupported dimensions are `null`, not score 1.
7. Delivery stays unassessed without measured/declared audio duration.
8. Generated session IDs prevent path traversal; writes are atomic.
9. `--no-save` performs no persistence.
10. Tests inject providers and do not contact external services.

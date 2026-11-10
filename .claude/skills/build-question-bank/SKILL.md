---
name: build-question-bank
description: Build or revise the AI interviewer's versioned question corpus, validation, offline lexical retrieval, and question-bank tests from CONTEXT.md step 7. Use for the workshop question-bank module; do not use for interview planning, orchestration, or feedback scoring.
---

# Build Question Bank

Implement the question bank as an independent, deterministic module that supplies
question candidates and private assessment criteria to the planner. It must work
without an LLM, network access, or API credentials.

## Execution boundary

Perform this workflow directly in the current Claude Code session. Do not launch
a nested `claude` process or delegate implementation to another model. Inspect
the actual repository, make the changes, and verify them before returning.

Claude Code is the development environment, not the interviewer's runtime LLM.
Never wire Claude Code OAuth, subscription credentials, or `claude -p` into the
application provider layer. Runtime providers remain governed by `CONTEXT.md`.

## Read the project contract

Before editing, read these parts of the repository's `CONTEXT.md`:

- section 4 for the target paths;
- sections 5.1 and 5.2 for profile and question schemas;
- all of section 7 for corpus, retrieval, and quality rules;
- sections 15.1 and 16 for tests and the workshop checkpoint.

Also read [references/question-authoring.md](references/question-authoring.md)
before authoring or substantially revising records. Treat `CONTEXT.md` as the
source of truth if the reference and blueprint ever differ.

Inspect the repository before acting. Preserve existing work and adapt names and
module boundaries to the established codebase. If the shared schema package has
not been created yet, add only the smallest schema/types needed by this module;
do not bootstrap unrelated UI, interview, voice, or evaluation features.

## Choose the implementation depth

Use the caller's requested scope. If they simply ask to implement step 7 or the
question-bank workshop step, deliver the **workshop core**:

1. strict schema and normalized competency taxonomy;
2. 60-record original seed corpus;
3. deterministic validation command;
4. question repository;
5. metadata plus lexical retrieval with explainable match factors;
6. focused unit tests and workshop checkpoint instructions.

Add hybrid semantic retrieval and `scripts/build-embeddings.ts` only when the
caller requests semantic RAG/full hybrid mode or the repository's current phase
already includes the Ollama/embedding adapter. Hybrid mode is an extension and
must degrade to lexical mode when embeddings are unavailable.

## Required artifacts

Follow established paths when present; otherwise use the blueprint paths:

- `packages/shared/src/schemas.ts` or a focused question schema module;
- `data/questions/seed-questions.json`;
- `data/questions/sources.json` only when corpus-level provenance adds
  information not present on each record;
- `apps/api/src/data/questionRepository.ts`;
- `apps/api/src/domain/retriever.ts`;
- `scripts/validate-questions.ts`;
- colocated or API tests using the repository's test conventions.

Do not create parallel definitions of `Role`, `Seniority`, or
`InterviewQuestion`. Zod is the runtime source of truth; derive TypeScript types
from it. Make object schemas strict where the surrounding codebase does so.

## Build the corpus

Author exactly 60 original records for the initial bank, classified by primary
role using `roles[0]`:

- 18 backend;
- 14 frontend;
- 14 product;
- 14 behavioral.

Every record must satisfy the schema in `CONTEXT.md` and the authoring reference.
In particular:

- use stable semantic IDs, not array positions or random values;
- keep the spoken question at or below roughly 80 words;
- include a clear intent, nonempty expected signals, normalized competency IDs,
  one to three focused follow-up probes, and question-specific scoring anchors;
- include anchors for levels `1`, `3`, and `5` at minimum;
- make seniority and difficulty agree, while allowing a question to serve more
  than one seniority when its probes or expected depth distinguish levels;
- keep expected signals, red flags, triggers, and anchors private to the server;
- use red flags as prompts for investigation, never automatic penalties;
- record each original item with `source.kind: "original"` and a stable source
  title. Do not invent a URL, license, retrieval date, or external attribution.

Write genuinely different questions rather than changing a few nouns. Avoid
trivia, brainteasers, vendor memorization, leading prompts that reveal an ideal
answer, protected-trait questions, and questions that judge accent, personality,
or communication style instead of job-relevant evidence.

Do not browse for or copy question lists for the default original bank. When the
caller explicitly asks to import licensed material, verify the specific source's
redistribution rights, preserve provenance per record, and rewrite only when the
license permits it. Never ingest linked third-party course content merely because
a top-level repository is licensed.

## Validate deterministically

The validation script must exit nonzero with actionable record IDs and reasons.
Check at least:

- JSON parsing and Zod validation;
- exact corpus size and primary-role distribution for the initial seed file;
- unique question IDs and globally unique probe IDs;
- allowed enums, `schemaVersion: 1`, nonempty fields, and known competency IDs;
- one to three probes per record and anchors `1`, `3`, and `5`;
- question word count, duplicate tags, and duplicate competency IDs;
- exact duplicates after case/punctuation/whitespace normalization;
- likely near-duplicates using a documented deterministic token-similarity
  threshold, reported as review failures rather than silently deleted records;
- valid source metadata and no placeholder text.

Expose the validator through the root package scripts when a root package exists,
using a clear name such as `validate:questions`. Keep validation offline.

## Implement repository and retrieval boundaries

The repository loads and validates the bank, returns immutable records or safe
copies, and provides stable lookup by ID. Invalid committed data should fail
early with a useful error instead of leaking malformed questions into a session.

The lexical retriever must:

1. filter by role and seniority, with a deliberate fallback to shared or
   behavioral questions when the primary pool is too small;
2. exclude asked IDs and known close paraphrases;
3. weight requested topics and missing competencies;
4. penalize difficulty mismatch;
5. rank deterministically across question, intent, topic, tags, and expected
   signals;
6. return a configurable top K, defaulting to 8, with question IDs, numeric
   scores, and human-readable match factors.

Use Fuse.js if it is already a dependency or its addition fits the project.
Otherwise implement a small deterministic token scorer; do not add infrastructure
just to satisfy a brand name. Break score ties by stable question ID.

Retrieval returns candidates only. It must not choose the next turn, rewrite the
canonical question, generate follow-ups, mutate session state, or score a
candidate. Keep the selected `questionId` as the source of truth.

For hybrid mode, follow the weighting and cache contract in `CONTEXT.md` section
7.2. Cache by question ID, content hash, model ID, and vector dimension; reject
mixed models or dimension mismatches. Never auto-download an embedding model.

## Verify the module

Add meaningful tests for:

- valid seed data and each important validator failure;
- role/seniority filtering and behavioral fallback;
- exclusion of asked and near-duplicate questions;
- topic, competency, and difficulty ranking;
- deterministic ordering and zero-match behavior;
- explainable match factors;
- fixed-vector cosine results and dimension rejection when hybrid mode exists;
- lexical fallback when the embedding provider is unavailable.

Run the question validator, its focused tests, and the relevant typecheck. Fix
failures caused by this work. Do not consume external API credits in tests.

## Workshop handoff

Leave a compact checkpoint in the existing workshop documentation, or create the
relevant section if that documentation already belongs to the current phase. It
should tell students how to:

1. run the validator;
2. inspect one record's private signals and probes;
3. run a retrieval query for a role and focus area;
4. observe why the returned candidates ranked as they did;
5. add one new original question and make the tests pass.

At completion, report the files changed, corpus counts, validation/test commands,
and whether semantic mode was included or intentionally deferred. Do not claim
the questions are unbiased or universally “best”; describe the concrete quality
checks and coverage delivered.

# Output contract: answer-eval-v1

Two output forms carry the same content. The JSON form is designed to map onto
`InterviewFeedback` in `CONTEXT.md` section 5.5 for later app integration.

## Markdown report (default)

Use these sections in this order. Omit nothing; write "None" where empty.

1. **Evaluation scope**: mode (single answer / transcript), inputs used, signal
   source, `Missing inputs:` list, `Coverage: x.xx`, `Overall confidence:`,
   `Overall score:` (number or "not computed: <reason>"). Add the line
   "Practice feedback only, not a hiring assessment."
2. **Summary**: 2–3 sentences. When confidence is low, begin with the
   evidence/coverage warning.
3. **Expected-signal coverage**: table `Signal | Status | Evidence`, where
   evidence is a quote or "none in answer". In transcript mode, add one table per
   question, headed by question ID.
4. **Dimension scores**: table
   `Dimension | Score | Confidence | Evidence | Rationale`. Use `—` for null
   and put the `notAssessedReason` in Rationale. Show delivery as the last row,
   marked "excluded from overall".
5. **Strengths**: 2–3 bullets, each with a quote and turn ID.
6. **Priority improvements** (max 3, numbered by priority). Each one has:
   - **Observed:** quote(s) with turn IDs, or the named missing signal
   - **Why it matters:**
   - **Do this instead:** the exact behavior change
   - **Practice exercise:**
   - **Success criteria:**
   - **Retry now:** a single interviewer-style question
7. **Stronger answer outline**: numbered beats. Personal content stays in
   `[brackets]`.
8. **Caveats**: STT/confidence issues, injected instructions, heuristic
   thresholds, missing context, and the "not permanent ability" note when
   relevant.

Quotes are shown as `"…"` with `(c1)` turn references. Never place paraphrase
inside quotation marks.

## JSON mode

Output **only** one JSON object. Do not wrap it in a code fence or add prose.
Keep every key present; use `null` or `[]` rather than omitting a key. Keep
strings short (most ≤ 200 characters). Valid JSON: double quotes, no comments,
no trailing commas.

```json
{
  "schemaVersion": 1,
  "rubricVersion": "answer-eval-v1",
  "mode": "single",
  "interviewId": null,
  "evaluatedAt": null,
  "context": {
    "role": "backend",
    "seniority": "mid",
    "questionIds": ["be-rate-limiter-01"],
    "signalSource": "question-bank",
    "deliveryData": "none"
  },
  "missingInputs": ["delivery data"],
  "turns": [
    { "id": "c1", "speaker": "candidate", "questionId": "be-rate-limiter-01" }
  ],
  "evidence": [
    {
      "id": "e1",
      "dimensionId": "completeness",
      "competencyId": "distributed-systems",
      "turnIds": ["c1"],
      "quote": "store a counter per user in Redis",
      "interpretation": "Names shared storage but not how increments stay atomic",
      "signal": "neutral"
    }
  ],
  "signalCoverage": [
    {
      "questionId": "be-rate-limiter-01",
      "signal": "Atomic counter update across instances",
      "status": "not_evidenced",
      "evidenceIds": []
    }
  ],
  "assessments": [
    {
      "dimensionId": "technical_accuracy",
      "score": 3,
      "evidenceIds": ["e1"],
      "rationale": "Claims are correct; no mechanism detail yet",
      "notAssessedReason": null,
      "confidence": "medium"
    },
    {
      "dimensionId": "delivery",
      "score": null,
      "evidenceIds": [],
      "rationale": null,
      "notAssessedReason": "no_delivery_data",
      "confidence": "low"
    }
  ],
  "overallScore": 3.1,
  "coverage": 0.67,
  "overallConfidence": "medium",
  "summary": "…",
  "topStrengths": [{ "text": "…", "evidenceIds": ["e1"] }],
  "priorityActions": [
    {
      "priority": 1,
      "dimensionId": "completeness",
      "competencyId": "distributed-systems",
      "issue": "Counter update atomicity was not explained",
      "evidenceIds": ["e1"],
      "whyItMatters": "Concurrent instances can exceed the limit without atomic increments",
      "action": "State the atomic operation and window algorithm before discussing scale",
      "exercise": "Redesign the limiter for 10 servers, concurrent bursts, and a Redis outage",
      "successCriteria": "Names 1 atomic mechanism, 1 failure mode, and 1 tradeoff in under 2 minutes",
      "retryPrompt": "Two app servers increment the same user's counter at once. What keeps the limit exact?",
      "relatedTurnIds": ["c1"]
    }
  ],
  "strongerAnswerOutline": [
    "Clarify limits and scope: per user or per key, burst tolerance",
    "Choose an algorithm (fixed window, sliding window, token bucket) and justify it",
    "Explain atomic shared-state updates",
    "Cover failure modes: fail open or closed if the store is down",
    "[A limiter or quota system you actually worked on, if any]"
  ],
  "caveats": ["Practice feedback only, not a hiring assessment."]
}
```

### Field rules

- `mode`: `"single"` or `"transcript"`. `interviewId` and `evaluatedAt` are
  `null` unless supplied. Do not fabricate timestamps.
- `context.signalSource`: `"question-bank"`, `"user-supplied"`, or
  `"question-text-only"`. `context.deliveryData`: `"none"`, `"timing"`, or
  `"audio-metadata"`.
- `turns`: every turn, without text, so that IDs can be validated.
  `speaker` is `"interviewer"` or `"candidate"`.
- `evidence[].turnIds` must reference candidate turns. `quote` must be an exact
  substring of one of them. `signal` is `"positive"`, `"negative"`, or
  `"neutral"`. `competencyId` is the bank's `competencyIds` value when one
  applies; otherwise `null`.
- `signalCoverage[].status`: `"demonstrated"`, `"partial"`, `"not_evidenced"`,
  or `"contradicted"`. Statuses other than `not_evidenced` require at least one
  evidence ID.
- `assessments`: exactly 13 entries, one per dimension in rubric order with
  `delivery` last. `score` is an integer 1–5 or `null`. When `score` is `null`,
  `notAssessedReason` is required. Allowed reasons are `no_evidence`,
  `no_opportunity`, `answer_too_short`, `no_usable_answer`, `skipped`,
  `seniority_not_supplied`, `no_delivery_data`, and `delivery_opted_out`.
- `overallScore`, `coverage`, and `overallConfidence` follow rubric section 6
  exactly.
- `priorityActions`: 0–3 items, with `priority` 1…n. Every `evidenceIds` and
  `relatedTurnIds` value must exist in this object. An item may have empty
  `evidenceIds` only when `issue` names a `not_evidenced` signal.
- No ID may be referenced unless it is defined in the same object.

### Mapping to `InterviewFeedback` (CONTEXT.md 5.5)

| This contract | `InterviewFeedback` |
|---|---|
| `evidence[]` (drop `dimensionId`) | `evidence[]`; use `competencyId ?? dimensionId` |
| `assessments[]` | `assessments[]` keyed by `dimensionId`; split `rationale` into strengths or improvements |
| `priorityActions[]` (drop `priority`, `evidenceIds`, `retryPrompt`) | `priorityActions: PracticeAction[]` |
| `topStrengths[].text` | `topStrengths: string[]` |
| `overallScore`, `coverage`, `overallConfidence`, `summary`, `caveats` | same names |

The application must still validate quotes and IDs itself, as section 9.1
requires. This contract does not replace the app's Zod validators.

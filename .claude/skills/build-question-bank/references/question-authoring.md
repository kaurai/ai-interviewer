# Question authoring reference

Use this reference while creating or revising seed records. It defines the
initial coverage targets and review standard; the schema in `CONTEXT.md` remains
authoritative.

## Coverage matrix

Classify each seed record by `roles[0]` so distribution checks are unambiguous.
Additional roles may appear when the same question is genuinely useful across
tracks.

| Primary role | Coverage target | Count |
|---|---|---:|
| Backend | API design (3), data/concurrency (4), caching/performance (3), reliability (3), observability (2), security/tradeoffs (3) | 18 |
| Frontend | accessibility (3), web performance (3), state management (3), testing (2), component/browser design (3) | 14 |
| Product | prioritization (3), metrics (3), stakeholder tradeoffs (3), experimentation (3), strategy/discovery (2) | 14 |
| Behavioral | communication (3), ownership (3), teamwork/conflict (4), learning/adaptability (2), decision quality (2) | 14 |

Treat these as coverage buckets, not mandatory `topic` strings. Keep topic names
consistent within the dataset and validate against the competency ontology.

## Competency ontology

Prefer stable namespaced IDs. Reuse an existing equivalent ontology instead of
creating aliases. A suitable initial set is:

- `backend.api-design`
- `backend.data-modeling`
- `backend.concurrency`
- `backend.caching`
- `backend.reliability`
- `backend.observability`
- `backend.security`
- `backend.system-tradeoffs`
- `frontend.accessibility`
- `frontend.performance`
- `frontend.state-management`
- `frontend.testing`
- `frontend.component-design`
- `frontend.browser-platform`
- `product.prioritization`
- `product.metrics`
- `product.stakeholder-management`
- `product.experimentation`
- `product.discovery`
- `product.strategy`
- `behavioral.communication`
- `behavioral.ownership`
- `behavioral.collaboration`
- `behavioral.conflict-resolution`
- `behavioral.learning-agility`
- `behavioral.adaptability`
- `behavioral.decision-making`
- `shared.problem-solving`
- `shared.tradeoff-reasoning`

Add a new ID only when its evidence and scoring meaning are distinct. One record
normally targets one or two competencies; avoid tagging every plausible skill.

## Difficulty and seniority calibration

Difficulty describes the reasoning demanded by the prompt, not how obscure the
topic is.

| Difficulty | Typical evidence |
|---:|---|
| 1 | Explains a core concept or a concrete past action with basic relevance |
| 2 | Applies a concept to a bounded scenario and names a simple tradeoff |
| 3 | Connects design choices, constraints, verification, and common failure modes |
| 4 | Handles ambiguity, scale, competing goals, or organizational consequences |
| 5 | Frames an underspecified problem, revises assumptions, and reasons through second-order effects |

Use mostly difficulties 1–2 for junior, 2–4 for mid-level, and 3–5 for senior.
This is a tendency, not a hard mapping. A broadly applicable question can list
multiple seniorities when its expected depth and probes make the distinction
clear.

Across each primary role, include a usable mix for all three seniorities. Avoid a
bank where senior questions are merely junior questions with “at scale” added.

## Record review rubric

A record is ready only when all answers below are yes:

1. **Job relevance:** Does the question collect evidence for a named competency?
2. **Answer space:** Can more than one defensible answer succeed when tradeoffs
   differ?
3. **Voice fit:** Can an interviewer ask it naturally in one turn, without a long
   setup or nested multipart list?
4. **Seniority fit:** Are the intended depth and difficulty plausible for every
   listed seniority?
5. **Observable signals:** Do expected signals describe ideas, decisions,
   behaviors, or verification rather than personality impressions?
6. **Focused probes:** Does each probe follow from a missing or strong signal and
   ask one thing?
7. **Anchors:** Do levels 1, 3, and 5 describe question-specific evidence without
   requiring exact buzzwords?
8. **Fairness:** Could scoring ignore accent, protected traits, school pedigree,
   personal hardship, and stylistic similarity to the interviewer?
9. **Distinctness:** Is it materially different from every other record?
10. **Provenance:** Is the source information truthful and complete for its kind?

## Writing expected signals and anchors

Expected signals are private criteria, not a hidden ideal script. Use compact,
separable observations such as:

- states important assumptions before choosing a design;
- identifies a race condition and proposes an atomic operation;
- defines a success metric and a guardrail metric;
- describes their own action and the effect on collaborators.

Avoid vague traits such as “smart,” “confident,” “culture fit,” or “great
communicator.” Do not treat missing vocabulary as missing understanding when the
candidate explains the concept correctly.

Anchors should be cumulative descriptions of evidence quality:

- **1:** little relevant evidence, a serious misconception, or an unexamined
  unsafe choice;
- **3:** a workable baseline answer with relevant reasoning and at least one
  meaningful tradeoff;
- **5:** a precise, adaptable answer that covers important failure modes,
  verification, and second-order tradeoffs.

Rewrite those anchors for the actual question. A short answer can still be strong;
verbosity is not a scoring criterion.

## Probe patterns

Use one to three probes. Give each a stable ID derived from its parent question.
Useful trigger types include:

- missing assumption or constraint;
- missing failure mode, validation, or measurement;
- missing ownership or personal action in a behavioral answer;
- strong answer that supports a deeper tradeoff;
- ambiguous answer needing one neutral clarification.

Do not encode candidate answers into the trigger, and do not use a probe to pile
several questions into one turn. A probe is available to the planner; it is not an
instruction to ask every probe.

## Original-source convention

For the default seed bank, use a stable source object like:

```json
{
  "kind": "original",
  "title": "AI Interviewer workshop seed bank"
}
```

Do not add a fictitious author, license, URL, or retrieval timestamp. If the
project later applies an explicit license to its own data, record that only after
the repository owner has chosen it.

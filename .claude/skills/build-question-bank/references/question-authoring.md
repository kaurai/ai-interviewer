# AI question authoring reference

Use this reference while creating or revising seed records. Every record in the
bank assesses AI skills. It defines the AI tracks, coverage targets, competency
ontology, and review standard. `CONTEXT.md` remains authoritative for the record
schema; this reference sets the AI-specific roles and distribution.

## Coverage matrix

Classify each seed record by `roles[0]` so distribution checks are unambiguous.
Additional AI tracks may appear in `roles` when the same question is genuinely
useful across tracks.

| Primary role | Coverage buckets | Count |
|---|---|---:|
| `ai-fundamentals` | ML foundations and generalization (5), training and optimization (4), representations and embeddings (3), neural architectures and transformers (5), LLM behavior and limitations (5), adaptation methods: prompting vs RAG vs fine-tuning (3) | 25 |
| `ai-engineering` | data pipelines and data quality (5), RAG and retrieval design (5), agents and tool use (4), serving, latency, and cost (5), reliability, safety, and guardrails (5), deployment, monitoring, and drift (3) | 27 |
| `ai-evaluation` | metric selection (5), eval-set design and leakage (5), evaluating generative and LLM outputs (5), online experiments and A/B tests (3), error analysis (4), fairness and responsible evaluation (3) | 25 |
| `ai-problem-solving` | problem framing: should this use AI at all (5), debugging an underperforming system (5), tradeoff scenarios (5), ownership in AI projects, behavioral (5), communicating uncertainty and limits to stakeholders (3) | 23 |
| **Total** | | **100** |

Treat these as coverage buckets, not mandatory `topic` strings. Keep topic names
consistent within the dataset (for example `rag`, `embeddings`,
`llm-as-judge`, `data-leakage`) and validate against the competency ontology.

### Example topics per bucket

Use these to spread coverage, not as a checklist to copy:

- **ML foundations:** overfitting vs underfitting, bias–variance, train/validation/test
  splits, class imbalance, why a model that wins offline can lose in production.
- **Training and optimization:** what a loss function encodes, learning-rate
  behavior, regularization, why training loss falls while validation loss rises.
- **Representations:** what an embedding captures, similarity search, why
  embeddings from different models can't be mixed.
- **Architectures:** what attention lets a model do, why transformers replaced
  recurrent models for most text tasks, the role of pretraining.
- **LLM behavior:** tokenization effects, context limits, sampling temperature,
  hallucination causes, prompt sensitivity.
- **Adaptation methods:** choosing between prompting, retrieval, and
  fine-tuning for a given constraint set.
- **Data pipelines:** labeling quality, deduplication, PII handling, dataset
  versioning, train–serve skew.
- **RAG and retrieval:** chunking, hybrid search, reranking, citing sources,
  diagnosing retrieval vs generation failures.
- **Agents and tool use:** tool schemas, loop termination, error recovery,
  limiting an agent's permissions.
- **Serving:** latency budgets, caching, batching, routing between small and
  large models, cost per request.
- **Reliability and safety:** structured-output validation, fallbacks, prompt
  injection, output filtering, rate limits.
- **Monitoring:** drift detection, feedback loops, logging without leaking user
  data, rollback criteria.
- **Metric selection:** precision vs recall for a stated cost of errors,
  calibration, ranking metrics, task-specific vs proxy metrics.
- **Eval-set design:** golden sets, leakage and contamination, coverage of edge
  cases, keeping an eval set from going stale.
- **Generative eval:** rubric-based human review, LLM-as-judge and its biases,
  pairwise comparison, agreement between raters.
- **Online experiments:** guardrail metrics, novelty effects, sample size,
  shadow and canary deployments.
- **Error analysis:** slicing failures by segment, building a failure taxonomy,
  deciding what to fix first.
- **Fairness:** measuring performance across groups, representative eval data,
  documenting known limits.
- **Problem framing:** when a rules-based system beats a model, defining
  success before building, data availability as a constraint.
- **Debugging:** a model regresses after retraining, a chatbot gives confident
  wrong answers, accuracy is high but users complain.
- **Tradeoffs:** quality vs latency, build vs buy, accuracy vs explainability,
  automation vs human review.
- **Ownership (behavioral):** a time you shipped an AI feature, found a flaw in
  your own model, or changed course after an evaluation.
- **Communicating uncertainty:** explaining model limits to a non-technical
  stakeholder, setting expectations about error rates.

## Competency ontology

Use stable namespaced IDs. Every record's `competencyIds` must use the `ai.` or
`shared.` namespace. Reuse an existing equivalent ID instead of creating aliases.

**AI fundamentals**

- `ai.ml-foundations`
- `ai.training-optimization`
- `ai.representations`
- `ai.neural-architectures`
- `ai.llm-behavior`
- `ai.adaptation-methods`

**Building AI systems**

- `ai.data-pipelines`
- `ai.retrieval-systems`
- `ai.agents-tool-use`
- `ai.serving-performance`
- `ai.reliability-safety`
- `ai.mlops-monitoring`

**Evaluating AI models**

- `ai.metric-selection`
- `ai.eval-design`
- `ai.generative-evaluation`
- `ai.online-experimentation`
- `ai.error-analysis`
- `ai.responsible-ai`

**Applied problem solving**

- `ai.problem-framing`
- `ai.debugging`
- `ai.ownership`
- `ai.stakeholder-communication`

**Shared**

- `shared.problem-solving`
- `shared.tradeoff-reasoning`

Add a new ID only when its evidence and scoring meaning are distinct. One record
normally targets one or two competencies; avoid tagging every plausible skill.

## Difficulty and seniority calibration

Difficulty describes the reasoning demanded by the prompt, not how obscure the
topic is.

| Difficulty | Typical evidence in an AI answer |
|---:|---|
| 1 | Explains a core concept correctly in plain words, such as why we hold out a test set |
| 2 | Applies a concept to a bounded scenario and names a simple tradeoff, such as choosing recall over precision for a stated cost |
| 3 | Connects design choices, data, evaluation, and common failure modes, such as designing a RAG pipeline and saying how they would tell retrieval failures from generation failures |
| 4 | Handles ambiguity, scale, competing goals, or organizational consequences, such as rolling out a model whose offline gains might not hold online |
| 5 | Frames an underspecified AI problem, revises assumptions, and reasons through second-order effects, such as feedback loops, eval gaming, or misuse |

Use mostly difficulties 1–2 for junior, 2–4 for mid-level, and 3–5 for senior.
This is a tendency, not a hard mapping. Each AI track needs at least 6 records
per seniority.

Avoid a bank where senior questions are junior questions with "at scale" added.
A junior fundamentals question might ask why validation loss rising while
training loss falls is a problem; a senior one might ask how they would decide
whether a promising offline result justifies a production launch.

## Record review rubric

A record is ready only when all answers below are yes:

1. **AI relevance:** Does the question collect evidence for a named AI
   competency, rather than generic software or management skill?
2. **Durability:** Would the question and its anchors still be valid if a new
   model or framework were released tomorrow?
3. **Answer space:** Can more than one defensible answer succeed when tradeoffs
   differ?
4. **Voice fit:** Can an interviewer ask it naturally in one turn, without a long
   setup, equations, or a nested multipart list?
5. **Seniority fit:** Are the intended depth and difficulty plausible for every
   listed seniority?
6. **Observable signals:** Do expected signals describe ideas, decisions,
   behaviors, or verification rather than personality impressions?
7. **Focused probes:** Does each probe follow from a missing or strong signal and
   ask one thing?
8. **Anchors:** Do levels 1, 3, and 5 describe question-specific evidence without
   requiring exact buzzwords?
9. **Fairness:** Could scoring ignore accent, protected traits, school pedigree,
   employer prestige, access to expensive compute, personal hardship, and
   stylistic similarity to the interviewer?
10. **Distinctness:** Is it materially different from every other record?
11. **Provenance:** Is the source information truthful and complete for its kind?

## Writing expected signals and anchors

Expected signals are private criteria, not a hidden ideal script. Use compact,
separable observations such as:

- distinguishes a retrieval failure from a generation failure before proposing a fix;
- checks for train–test leakage before trusting a surprising result;
- chooses a metric that matches the stated cost of false positives and negatives;
- names a guardrail metric alongside the primary metric for a model launch;
- validates an LLM judge against a sample of human labels;
- describes their own action and its effect on the team in an AI project.

Avoid vague traits such as "smart," "confident," "AI-native," or "great
communicator." Do not treat missing vocabulary as missing understanding: a
candidate who explains "the test data overlapped the training data" has shown
awareness of leakage without saying the word.

Anchors should be cumulative descriptions of evidence quality:

- **1:** little relevant evidence, a serious misconception (for example,
  trusting accuracy on a heavily imbalanced dataset), or an unexamined unsafe
  choice;
- **3:** a workable baseline answer with relevant reasoning and at least one
  meaningful tradeoff;
- **5:** a precise, adaptable answer that covers important failure modes,
  verification, and second-order tradeoffs.

Rewrite those anchors for the actual question. A short answer can still be strong;
verbosity is not a scoring criterion.

## Probe patterns

Use one to three probes. Give each a stable ID derived from its parent question,
in the form `<questionId>.<kebab-slug>`, such as
`ai_eval_rag_support_bot_01.judge-agreement`. Useful trigger types include:

- missing assumption or constraint (data size, latency budget, cost of errors);
- missing failure mode, evaluation, or measurement;
- missing data concern (leakage, labeling quality, privacy);
- missing ownership or personal action in a behavioral answer;
- strong answer that supports a deeper tradeoff;
- ambiguous answer needing one neutral clarification.

Do not encode candidate answers into the trigger, and do not use a probe to pile
several questions into one turn. A probe is available to the planner; it is not an
instruction to ask every probe.

## Example record

Use this as a calibration example for shape and depth. Do not copy it into the
bank unchanged.

```json
{
  "id": "ai_eval_rag_support_bot_01",
  "schemaVersion": 1,
  "roles": ["ai-evaluation", "ai-engineering"],
  "seniorities": ["mid", "senior"],
  "type": "situational",
  "topic": "rag-evaluation",
  "tags": ["rag", "evaluation", "llm-as-judge", "customer-support"],
  "difficulty": 3,
  "competencyIds": ["ai.generative-evaluation", "ai.eval-design"],
  "question": "Your team built a retrieval-augmented assistant that answers customer-support questions from the help center. Before launch, how would you evaluate whether it is good enough to ship?",
  "intent": "Assess whether the candidate can design an evaluation for a generative system that separates retrieval quality from answer quality and ties results to a launch decision.",
  "expectedSignals": [
    "defines what good enough means before measuring, tied to user or business impact",
    "builds or samples a representative question set, including hard and out-of-scope questions",
    "evaluates retrieval separately from the generated answer",
    "checks answers for faithfulness to the retrieved sources, not only fluency",
    "uses human review or validates any automated judge against human labels",
    "names a launch threshold or guardrail, such as an unsafe or wrong-answer rate"
  ],
  "redFlags": [
    "relies only on a few manual spot checks",
    "treats a fluent answer as a correct one"
  ],
  "followupProbes": [
    {
      "id": "ai_eval_rag_support_bot_01.retrieval-vs-generation",
      "trigger": "Candidate does not distinguish retrieval failures from generation failures",
      "question": "If an answer is wrong, how would you tell whether retrieval or generation caused it?"
    },
    {
      "id": "ai_eval_rag_support_bot_01.judge-agreement",
      "trigger": "Candidate proposes an LLM judge without saying how to trust it",
      "question": "How would you know whether your automated judge agrees with human reviewers?"
    }
  ],
  "scoringAnchors": {
    "1": "Describes trying a few questions by hand with no criteria, test set, or launch threshold.",
    "3": "Builds a representative test set, measures answer correctness with a stated method, and sets a reasonable bar for launch.",
    "5": "Separates retrieval and generation metrics, checks faithfulness, validates any automated judge, covers out-of-scope and adversarial questions, and links the result to a launch threshold and post-launch monitoring."
  },
  "source": {
    "kind": "original",
    "title": "AI Interviewer AI-skills seed bank"
  }
}
```

## Original-source convention

For the default seed bank, use a stable source object like:

```json
{
  "kind": "original",
  "title": "AI Interviewer AI-skills seed bank"
}
```

Do not add a fictitious author, license, URL, or retrieval timestamp. If the
project later applies an explicit license to its own data, record that only after
the repository owner has chosen it.

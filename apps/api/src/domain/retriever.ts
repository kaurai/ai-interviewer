import { z } from 'zod';
import {
  CompetencyIdSchema,
  DifficultySchema,
  QuestionTypeSchema,
  RoleSchema,
  SenioritySchema,
  contentTokens,
  jaccard,
  normalizeText,
  tokenSet,
  type Difficulty,
  type Role,
  type Seniority,
} from '@ai-interviewer/shared';
import type { QuestionRecord, QuestionRepository } from '../data/questionRepository';

/**
 * Mode A retrieval (CONTEXT.md 7.2): metadata filters plus a small
 * deterministic token scorer. It returns ranked *candidates* with explanations.
 * It never picks the next turn, rewrites questions, generates follow-ups,
 * mutates session state, or scores a candidate's answer; the planner does that.
 */

/** Tunable heuristics, not scientific constants. Points are additive. */
export const RETRIEVAL_WEIGHTS = {
  /** A focus area equal to the record's topic. */
  focusTopic: 3,
  /** A focus area equal to one of the record's tags. */
  focusTag: 2,
  /** A focus area sharing a content token with the topic or tags. */
  focusPartial: 1,
  /** Each requested missing competency the record targets. */
  competency: 2.5,
  /** Multiplier on the normalized lexical match (0..max field weight). */
  lexicalScale: 2,
  /** Subtracted per difficulty step away from the target. */
  difficultyPenaltyPerStep: 1,
  /** Subtracted from fallback-pool records so primary records usually lead. */
  fallbackPenalty: 2,
  /** Field weights for lexical matching; a token earns its best field's weight. */
  fields: { topic: 2, tags: 1.5, question: 1, intent: 1, expectedSignals: 0.75 },
} as const;

/** Default difficulty a seniority should be served when none is requested. */
export const TARGET_DIFFICULTY_BY_SENIORITY: Readonly<Record<Seniority, Difficulty>> = {
  junior: 2,
  mid: 3,
  senior: 4,
};

/**
 * Candidates whose spoken question is at least this similar (Jaccard over
 * content tokens) to an asked question or excluded text are treated as close
 * paraphrases and removed. Lower than the validator's near-duplicate threshold
 * on purpose: two distinct records can still be too alike for one interview.
 */
export const PARAPHRASE_EXCLUSION_THRESHOLD = 0.5;

export const DEFAULT_TOP_K = 8;

/** Shared pool used when a track has too few eligible questions. */
export const FALLBACK_ROLE: Role = 'ai-problem-solving';

export const RetrievalQuerySchema = z.strictObject({
  role: RoleSchema,
  seniority: SenioritySchema,
  /** Requested topics, e.g. "rag" or "llm-as-judge". */
  focusAreas: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  /** Planned competencies that still lack evidence. */
  missingCompetencyIds: z.array(CompetencyIdSchema).max(30).default([]),
  /** Optional stage filter, e.g. only situational questions. */
  questionTypes: z.array(QuestionTypeSchema).min(1).optional(),
  /** Already asked question IDs; never returned again. */
  excludeIds: z.array(z.string()).default([]),
  /** Spoken text already used (e.g. paraphrased lead-ins) to avoid repeating. */
  excludeTexts: z.array(z.string().max(2000)).max(50).default([]),
  targetDifficulty: DifficultySchema.optional(),
  /** Untrusted free text (e.g. job description); only tokenized, never executed. */
  queryText: z.string().max(5000).optional(),
  topK: z.number().int().min(1).max(50).default(DEFAULT_TOP_K),
  /** Use the ai-problem-solving fallback pool when fewer primary candidates remain. Defaults to topK. */
  minPoolSize: z.number().int().min(0).max(200).optional(),
});
export type RetrievalQueryInput = z.input<typeof RetrievalQuerySchema>;
export type RetrievalQuery = z.output<typeof RetrievalQuerySchema>;

export type MatchFactorKind =
  | 'eligibility'
  | 'fallback'
  | 'focus'
  | 'competency'
  | 'lexical'
  | 'difficulty';

export type MatchFactor = {
  kind: MatchFactorKind;
  /** Contribution to the score; informational factors contribute 0. */
  points: number;
  detail: string;
};

export type RetrievalCandidate = {
  questionId: string;
  score: number;
  pool: 'primary' | 'fallback';
  factors: MatchFactor[];
  /** Frozen record for the planner's private use; questionId stays canonical. */
  question: QuestionRecord;
};

export type ExcludedQuestion = {
  questionId: string;
  reason: 'asked' | 'paraphrase';
  detail: string;
};

export type RetrievalResult = {
  mode: 'lexical';
  query: RetrievalQuery;
  candidates: RetrievalCandidate[];
  /** Eligible primary records left after exclusions. */
  primaryPoolSize: number;
  fallbackUsed: boolean;
  excluded: ExcludedQuestion[];
};

const round = (value: number) => Math.round(value * 1000) / 1000;

function slug(text: string): string {
  return normalizeText(text).replace(/ /g, '-');
}

type FieldName = keyof typeof RETRIEVAL_WEIGHTS.fields;

function fieldTokens(q: QuestionRecord): Record<FieldName, Set<string>> {
  return {
    topic: tokenSet(q.topic),
    tags: tokenSet(q.tags.join(' ')),
    question: tokenSet(q.question),
    intent: tokenSet(q.intent),
    expectedSignals: tokenSet(q.expectedSignals.join(' ')),
  };
}

function scoreCandidate(
  q: QuestionRecord,
  pool: RetrievalCandidate['pool'],
  query: RetrievalQuery,
  queryTokens: readonly string[],
  targetDifficulty: Difficulty,
): RetrievalCandidate {
  const factors: MatchFactor[] = [];
  const eligibility =
    pool === 'primary'
      ? `role ${query.role} and seniority ${query.seniority} match`
      : `fallback: ${FALLBACK_ROLE} question for seniority ${query.seniority}`;
  factors.push({ kind: 'eligibility', points: 0, detail: eligibility });
  if (pool === 'fallback') {
    factors.push({
      kind: 'fallback',
      points: -RETRIEVAL_WEIGHTS.fallbackPenalty,
      detail: `primary pool smaller than ${query.minPoolSize ?? query.topK}; fallback penalty`,
    });
  }

  const tagSet = new Set(q.tags);
  const topicTagTokens = new Set([...tokenSet(q.topic), ...tokenSet(q.tags.join(' '))]);
  for (const area of query.focusAreas) {
    const areaSlug = slug(area);
    if (areaSlug === q.topic) {
      factors.push({ kind: 'focus', points: RETRIEVAL_WEIGHTS.focusTopic, detail: `focus "${area}" matches topic` });
    } else if (tagSet.has(areaSlug)) {
      factors.push({ kind: 'focus', points: RETRIEVAL_WEIGHTS.focusTag, detail: `focus "${area}" matches tag` });
    } else {
      const shared = contentTokens(area).filter((t) => topicTagTokens.has(t));
      if (shared.length > 0) {
        factors.push({
          kind: 'focus',
          points: RETRIEVAL_WEIGHTS.focusPartial,
          detail: `focus "${area}" partially matches topic/tags via ${[...new Set(shared)].join(', ')}`,
        });
      }
    }
  }

  for (const competencyId of query.missingCompetencyIds) {
    if (q.competencyIds.includes(competencyId)) {
      factors.push({
        kind: 'competency',
        points: RETRIEVAL_WEIGHTS.competency,
        detail: `targets missing competency ${competencyId}`,
      });
    }
  }

  if (queryTokens.length > 0) {
    const fields = fieldTokens(q);
    const fieldOrder = Object.keys(RETRIEVAL_WEIGHTS.fields) as FieldName[];
    let total = 0;
    const matches: string[] = [];
    for (const token of queryTokens) {
      let best: FieldName | null = null;
      for (const field of fieldOrder) {
        if (fields[field].has(token) && (best === null || RETRIEVAL_WEIGHTS.fields[field] > RETRIEVAL_WEIGHTS.fields[best])) {
          best = field;
        }
      }
      if (best !== null) {
        total += RETRIEVAL_WEIGHTS.fields[best];
        matches.push(`${token}→${best}`);
      }
    }
    if (matches.length > 0) {
      const points = round((total / queryTokens.length) * RETRIEVAL_WEIGHTS.lexicalScale);
      factors.push({
        kind: 'lexical',
        points,
        detail: `matched ${matches.length}/${queryTokens.length} query terms: ${matches.join(', ')}`,
      });
    }
  }

  const distance = Math.abs(q.difficulty - targetDifficulty);
  factors.push({
    kind: 'difficulty',
    points: -distance * RETRIEVAL_WEIGHTS.difficultyPenaltyPerStep,
    detail:
      distance === 0
        ? `difficulty ${q.difficulty} matches target ${targetDifficulty}`
        : `difficulty ${q.difficulty} is ${distance} from target ${targetDifficulty}`,
  });

  const score = round(factors.reduce((sum, f) => sum + f.points, 0));
  return { questionId: q.id, score, pool, factors, question: q };
}

/**
 * Rank question candidates for a query. Pure and deterministic: ties are
 * broken by question ID, and no randomness or external calls are involved.
 */
export function retrieveCandidates(repository: QuestionRepository, input: RetrievalQueryInput): RetrievalResult {
  const query = RetrievalQuerySchema.parse(input);
  const targetDifficulty = query.targetDifficulty ?? TARGET_DIFFICULTY_BY_SENIORITY[query.seniority];
  const minPoolSize = query.minPoolSize ?? query.topK;
  const typeAllowed = (q: QuestionRecord) => query.questionTypes === undefined || query.questionTypes.includes(q.type);

  // Texts that must not be repeated: canonical text of asked IDs plus caller-provided texts.
  const askedIds = new Set(query.excludeIds);
  const avoidTexts: Array<{ label: string; tokens: Set<string> }> = [];
  for (const id of query.excludeIds) {
    const asked = repository.get(id);
    if (asked !== undefined) avoidTexts.push({ label: id, tokens: tokenSet(asked.question) });
  }
  query.excludeTexts.forEach((text, i) => avoidTexts.push({ label: `excludeTexts[${i}]`, tokens: tokenSet(text) }));

  const excluded: ExcludedQuestion[] = [];
  const isAvailable = (q: QuestionRecord): boolean => {
    if (askedIds.has(q.id)) {
      excluded.push({ questionId: q.id, reason: 'asked', detail: 'already asked in this session' });
      return false;
    }
    const own = tokenSet(q.question);
    for (const avoid of avoidTexts) {
      const similarity = jaccard(own, avoid.tokens);
      if (similarity >= PARAPHRASE_EXCLUSION_THRESHOLD) {
        excluded.push({
          questionId: q.id,
          reason: 'paraphrase',
          detail: `${similarity.toFixed(2)} similar to ${avoid.label} (threshold ${PARAPHRASE_EXCLUSION_THRESHOLD})`,
        });
        return false;
      }
    }
    return true;
  };

  const eligibleForSeniority = repository
    .all()
    .filter((q) => q.seniorities.includes(query.seniority) && typeAllowed(q));
  const primary = eligibleForSeniority.filter((q) => q.roles.includes(query.role)).filter(isAvailable);

  // Deliberate fallback: when the track pool is too small, add applied
  // problem-solving questions for the same seniority. That track has no fallback.
  let fallback: QuestionRecord[] = [];
  if (primary.length < minPoolSize && query.role !== FALLBACK_ROLE) {
    fallback = eligibleForSeniority
      .filter((q) => !q.roles.includes(query.role) && q.roles.includes(FALLBACK_ROLE))
      .filter(isAvailable);
  }

  const queryTokens = [...new Set(contentTokens([...query.focusAreas, query.queryText ?? ''].join(' ')))];
  const candidates = [
    ...primary.map((q) => scoreCandidate(q, 'primary', query, queryTokens, targetDifficulty)),
    ...fallback.map((q) => scoreCandidate(q, 'fallback', query, queryTokens, targetDifficulty)),
  ]
    .sort((a, b) => b.score - a.score || (a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0))
    .slice(0, query.topK);

  excluded.sort((a, b) => (a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0));
  return {
    mode: 'lexical',
    query,
    candidates,
    primaryPoolSize: primary.length,
    fallbackUsed: fallback.length > 0,
    excluded,
  };
}

/** Convenience wrapper bound to one repository. */
export function createLexicalRetriever(repository: QuestionRepository) {
  return {
    mode: 'lexical' as const,
    search: (query: RetrievalQueryInput) => retrieveCandidates(repository, query),
  };
}

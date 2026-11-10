import type { z } from 'zod';
import {
  InterviewQuestionSchema,
  ROLES,
  SENIORITIES,
  type InterviewQuestion,
  type Role,
  type ScoringAnchorLevel,
  type Seniority,
} from './schemas';
import { COMPETENCY_NAMESPACES } from './competencies';
import { countWords, normalizeText, tokenSet, jaccard } from './text';

/** Voice-friendly cap on the spoken question (CONTEXT.md 5.2). */
export const MAX_QUESTION_WORDS = 80;

/** Anchors every record must define so rubric scoring has fixed reference points. */
export const REQUIRED_ANCHOR_LEVELS: readonly ScoringAnchorLevel[] = ['1', '3', '5'];

/**
 * Difficulty range each seniority may be served. A record must fit the range of
 * every seniority it lists, so a difficulty-3 question can serve all three
 * levels while a difficulty-5 question is senior-only.
 */
export const DIFFICULTY_RANGE_BY_SENIORITY: Readonly<Record<Seniority, readonly [number, number]>> = {
  junior: [1, 3],
  mid: [2, 4],
  senior: [3, 5],
};

/**
 * Near-duplicate rule: Jaccard similarity of the content-token sets of two
 * spoken questions (lowercased, punctuation stripped, stopwords and interview
 * boilerplate removed, plural suffixes stripped). Pairs at or above this value
 * are reported for human review; records are never silently dropped.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.6;

/**
 * Size and distribution contract for the AI seed corpus. Overrides the
 * non-AI distribution in CONTEXT.md 7.1 (see the build-question-bank skill).
 */
export const SEED_CORPUS_RULES: {
  readonly total: number;
  readonly byPrimaryRole: Readonly<Record<Role, number>>;
  /** Each primary role must offer at least this many records per seniority. */
  readonly minPerSeniorityPerRole: number;
} = {
  total: 100,
  byPrimaryRole: { 'ai-fundamentals': 25, 'ai-engineering': 27, 'ai-evaluation': 25, 'ai-problem-solving': 23 },
  minPerSeniorityPerRole: 6,
};

/**
 * Authoring leftovers. The bare word "placeholder" is deliberately not matched
 * because it can be legitimate vocabulary (e.g. a placeholder value in a
 * prompt template); bracketed template markers like "[placeholder]" or
 * "{{name}}" are.
 */
const PLACEHOLDER_PATTERN =
  /\b(?:todo|tbd|fixme|xxx|lorem ipsum|insert [a-z ]+ here)\b|\?\?\?|\{\{|\}\}|[[<]\s*placeholder\s*[\]>]/i;

export type ValidationSeverity = 'error' | 'review';

export type ValidationIssue = {
  /** `error` blocks loading; `review` (near-duplicates) needs a human decision. */
  severity: ValidationSeverity;
  rule: string;
  /** Record ID when known, otherwise null (e.g. malformed record or corpus-level rule). */
  recordId: string | null;
  /** Array index of the record when relevant. */
  index: number | null;
  message: string;
};

export type ValidationOptions = {
  /** Enforce the seed-corpus size, AI track distribution, and seniority coverage. */
  seedCorpus?: boolean;
  nearDuplicateThreshold?: number;
};

export type CorpusStats = {
  total: number;
  byPrimaryRole: Record<Role, number>;
  byPrimaryRoleAndSeniority: Record<Role, Record<Seniority, number>>;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
  /** Records that passed schema validation, in input order. */
  questions: InterviewQuestion[];
  stats: CorpusStats;
};

function emptyStats(): CorpusStats {
  const byPrimaryRole = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  const byPrimaryRoleAndSeniority = Object.fromEntries(
    ROLES.map((r) => [r, Object.fromEntries(SENIORITIES.map((s) => [s, 0]))]),
  ) as Record<Role, Record<Seniority, number>>;
  return { total: 0, byPrimaryRole, byPrimaryRoleAndSeniority };
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(record)'}: ${issue.message}`)
    .join('; ');
}

function duplicates<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const dupes = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

/** Every string in the record that a reviewer or interviewer could read. */
function collectStrings(question: InterviewQuestion): Array<[field: string, value: string]> {
  const out: Array<[string, string]> = [
    ['question', question.question],
    ['intent', question.intent],
    ['topic', question.topic],
    ['source.title', question.source.title],
  ];
  question.tags.forEach((v, i) => out.push([`tags.${i}`, v]));
  question.expectedSignals.forEach((v, i) => out.push([`expectedSignals.${i}`, v]));
  question.redFlags?.forEach((v, i) => out.push([`redFlags.${i}`, v]));
  question.followupProbes.forEach((p, i) => {
    out.push([`followupProbes.${i}.trigger`, p.trigger]);
    out.push([`followupProbes.${i}.question`, p.question]);
  });
  for (const [level, text] of Object.entries(question.scoringAnchors ?? {})) {
    if (text !== undefined) out.push([`scoringAnchors.${level}`, text]);
  }
  return out;
}

/**
 * Validate a parsed question bank. Pure and deterministic: the same input
 * always yields the same issues in the same order.
 */
export function validateQuestionBank(input: unknown, options: ValidationOptions = {}): ValidationResult {
  const threshold = options.nearDuplicateThreshold ?? NEAR_DUPLICATE_THRESHOLD;
  const issues: ValidationIssue[] = [];
  const stats = emptyStats();
  const push = (rule: string, recordId: string | null, index: number | null, message: string, severity: ValidationSeverity = 'error') =>
    issues.push({ severity, rule, recordId, index, message });

  if (!Array.isArray(input)) {
    push('not-array', null, null, 'question bank must be a JSON array of question records');
    return { ok: false, issues, questions: [], stats };
  }

  // 1. Schema validation per record, plus raw ID uniqueness so malformed
  //    records with a duplicate ID are still reported.
  const questions: InterviewQuestion[] = [];
  const indexById = new Map<string, number>();
  input.forEach((raw, index) => {
    const rawId =
      raw !== null && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string'
        ? (raw as { id: string }).id
        : null;
    if (rawId !== null) {
      const first = indexById.get(rawId);
      if (first !== undefined) {
        push('duplicate-id', rawId, index, `question ID is already used by record at index ${first}`);
      } else {
        indexById.set(rawId, index);
      }
    }
    const parsed = InterviewQuestionSchema.safeParse(raw);
    if (!parsed.success) {
      push('schema', rawId, index, formatZodIssues(parsed.error));
      return;
    }
    questions.push(parsed.data);
  });

  // 2. Per-record quality rules.
  const probeOwner = new Map<string, string>();
  for (const q of questions) {
    const index = indexById.get(q.id) ?? null;

    const words = countWords(q.question);
    if (words > MAX_QUESTION_WORDS) {
      push('word-count', q.id, index, `spoken question has ${words} words; maximum is ${MAX_QUESTION_WORDS}`);
    }

    const listChecks: Array<[rule: string, field: string, values: readonly string[]]> = [
      ['duplicate-role', 'roles', q.roles],
      ['duplicate-seniority', 'seniorities', q.seniorities],
      ['duplicate-tag', 'tags', q.tags],
      ['duplicate-competency', 'competencyIds', q.competencyIds],
      ['duplicate-signal', 'expectedSignals', q.expectedSignals.map(normalizeText)],
    ];
    for (const [rule, field, values] of listChecks) {
      const dupes = duplicates(values);
      if (dupes.length > 0) {
        push(rule, q.id, index, `${field} contains duplicates: ${dupes.join(', ')}`);
      }
    }

    for (const competencyId of q.competencyIds) {
      const namespace = competencyId.split('.')[0];
      if (!(COMPETENCY_NAMESPACES as readonly string[]).includes(namespace ?? '')) {
        push('competency-namespace', q.id, index,
          `competency ${competencyId} must use one of the namespaces: ${COMPETENCY_NAMESPACES.join(', ')}`);
      }
    }

    for (const level of REQUIRED_ANCHOR_LEVELS) {
      if (q.scoringAnchors?.[level] === undefined) {
        push('missing-anchor', q.id, index, `scoringAnchors must define level ${level}`);
      }
    }

    for (const seniority of q.seniorities) {
      const [min, max] = DIFFICULTY_RANGE_BY_SENIORITY[seniority];
      if (q.difficulty < min || q.difficulty > max) {
        push('difficulty-seniority', q.id, index,
          `difficulty ${q.difficulty} is outside the ${min}-${max} range for ${seniority}`);
      }
    }

    for (const probe of q.followupProbes) {
      if (!probe.id.startsWith(`${q.id}.`)) {
        push('probe-id-prefix', q.id, index, `probe ID ${probe.id} must start with "${q.id}."`);
      }
      const owner = probeOwner.get(probe.id);
      if (owner !== undefined) {
        push('duplicate-probe-id', q.id, index, `probe ID ${probe.id} is already used by ${owner}`);
      } else {
        probeOwner.set(probe.id, q.id);
      }
    }

    for (const [field, value] of collectStrings(q)) {
      if (PLACEHOLDER_PATTERN.test(value)) {
        push('placeholder', q.id, index, `${field} contains placeholder text: "${value}"`);
      }
    }

    const primary = q.roles[0]!;
    stats.byPrimaryRole[primary] += 1;
    for (const s of new Set(q.seniorities)) stats.byPrimaryRoleAndSeniority[primary][s] += 1;
  }
  stats.total = questions.length;

  // 3. Cross-record duplicate detection on the spoken question.
  const normalized = questions.map((q) => normalizeText(q.question));
  const tokens = questions.map((q) => tokenSet(q.question));
  for (let i = 0; i < questions.length; i += 1) {
    for (let j = i + 1; j < questions.length; j += 1) {
      const a = questions[i]!;
      const b = questions[j]!;
      if (normalized[i] === normalized[j]) {
        push('exact-duplicate', b.id, indexById.get(b.id) ?? null,
          `question text is identical to ${a.id} after normalization`);
        continue;
      }
      const similarity = jaccard(tokens[i]!, tokens[j]!);
      if (similarity >= threshold) {
        push('near-duplicate', b.id, indexById.get(b.id) ?? null,
          `question is ${similarity.toFixed(2)} similar to ${a.id} (threshold ${threshold}); rewrite one or justify keeping both`,
          'review');
      }
    }
  }

  // 4. Corpus-level rules for the initial seed file.
  if (options.seedCorpus) {
    if (input.length !== SEED_CORPUS_RULES.total) {
      push('corpus-size', null, null, `seed corpus must contain exactly ${SEED_CORPUS_RULES.total} records; found ${input.length}`);
    }
    for (const role of ROLES) {
      const expected = SEED_CORPUS_RULES.byPrimaryRole[role];
      const actual = stats.byPrimaryRole[role];
      if (actual !== expected) {
        push('role-distribution', null, null, `primary role ${role} must have ${expected} records; found ${actual}`);
      }
      for (const seniority of SENIORITIES) {
        const count = stats.byPrimaryRoleAndSeniority[role][seniority];
        if (count < SEED_CORPUS_RULES.minPerSeniorityPerRole) {
          push('seniority-coverage', null, null,
            `primary role ${role} has ${count} ${seniority} records; minimum is ${SEED_CORPUS_RULES.minPerSeniorityPerRole}`);
        }
      }
    }
  }

  return { ok: issues.length === 0, issues, questions, stats };
}

/** Parse JSON text and validate it, reporting parse failures as issues. */
export function validateQuestionBankJson(text: string, options: ValidationOptions = {}): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [{ severity: 'error', rule: 'json-parse', recordId: null, index: null, message: (error as Error).message }],
      questions: [],
      stats: emptyStats(),
    };
  }
  return validateQuestionBank(parsed, options);
}

export function formatIssue(issue: ValidationIssue): string {
  const where = issue.recordId ?? (issue.index !== null ? `index ${issue.index}` : 'corpus');
  return `[${issue.severity}] ${issue.rule} ${where}: ${issue.message}`;
}

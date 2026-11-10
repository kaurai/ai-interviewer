import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatIssue,
  validateQuestionBank,
  validateQuestionBankJson,
  type InterviewQuestion,
  type ValidationIssue,
  type ValidationResult,
} from '@ai-interviewer/shared';

/** Committed seed bank, resolved from this file so it works from any cwd. */
export const DEFAULT_SEED_QUESTIONS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../data/questions/seed-questions.json',
);

export type QuestionRecord = Readonly<InterviewQuestion>;

export class QuestionBankLoadError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(sourceLabel: string, issues: readonly ValidationIssue[]) {
    const shown = issues.slice(0, 10).map(formatIssue).join('\n  ');
    const more = issues.length > 10 ? `\n  ...and ${issues.length - 10} more` : '';
    super(`Invalid question bank (${sourceLabel}); run npm run validate:questions.\n  ${shown}${more}`);
    this.name = 'QuestionBankLoadError';
    this.issues = issues;
  }
}

export class UnknownQuestionError extends Error {
  constructor(readonly questionId: string) {
    super(`Unknown question ID: ${questionId}`);
    this.name = 'UnknownQuestionError';
  }
}

export interface QuestionRepository {
  readonly size: number;
  /** All records in bank order. Records and the array are deeply frozen. */
  all(): readonly QuestionRecord[];
  has(id: string): boolean;
  get(id: string): QuestionRecord | undefined;
  /** Like get, but throws UnknownQuestionError so callers cannot invent IDs. */
  require(id: string): QuestionRecord;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Only `error` issues block loading. `review` issues (likely near-duplicates)
 * fail the validator command but do not stop a running interview.
 */
function assertLoadable(result: ValidationResult, sourceLabel: string): void {
  const errors = result.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) throw new QuestionBankLoadError(sourceLabel, errors);
}

function buildRepository(questions: readonly InterviewQuestion[]): QuestionRepository {
  // Clone so callers holding the raw input cannot mutate repository state.
  const records = deepFreeze(structuredClone([...questions])) as readonly QuestionRecord[];
  const byId = new Map(records.map((q) => [q.id, q]));
  return {
    size: records.length,
    all: () => records,
    has: (id) => byId.has(id),
    get: (id) => byId.get(id),
    require: (id) => {
      const record = byId.get(id);
      if (record === undefined) throw new UnknownQuestionError(id);
      return record;
    },
  };
}

/** Validate already-parsed data (e.g. test fixtures) and build a repository. */
export function createQuestionRepository(data: unknown, sourceLabel = 'in-memory data'): QuestionRepository {
  const result = validateQuestionBank(data);
  assertLoadable(result, sourceLabel);
  return buildRepository(result.questions);
}

/** Load, validate, and freeze a question bank file. Fails early on bad data. */
export async function loadQuestionRepository(filePath: string = DEFAULT_SEED_QUESTIONS_PATH): Promise<QuestionRepository> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read question bank at ${filePath}: ${(error as Error).message}`);
  }
  const result = validateQuestionBankJson(text);
  assertLoadable(result, filePath);
  return buildRepository(result.questions);
}

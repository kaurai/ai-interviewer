import { beforeAll, describe, expect, it } from 'vitest';
import { createQuestionRepository, loadQuestionRepository, type QuestionRepository } from '../src/data/questionRepository';
import {
  DEFAULT_TOP_K,
  RETRIEVAL_WEIGHTS,
  createLexicalRetriever,
  retrieveCandidates,
  type RetrievalQueryInput,
  type RetrievalResult,
} from '../src/domain/retriever';
import { makeQuestion } from '../../../packages/shared/test/fixtures';

let seed: QuestionRepository;
beforeAll(async () => {
  seed = await loadQuestionRepository();
});

const ids = (result: RetrievalResult) => result.candidates.map((c) => c.questionId);

describe('role and seniority filtering', () => {
  it('returns only primary candidates matching the requested role and seniority', () => {
    // minPoolSize defaults to topK, and the frontend senior pool is smaller than 50,
    // so fallback must be disabled explicitly to test primary-only filtering.
    const result = retrieveCandidates(seed, { role: 'frontend', seniority: 'senior', topK: 50, minPoolSize: 0 });
    expect(result.fallbackUsed).toBe(false);
    expect(result.candidates.length).toBe(result.primaryPoolSize);
    for (const c of result.candidates) {
      expect(c.pool).toBe('primary');
      expect(c.question.roles).toContain('frontend');
      expect(c.question.seniorities).toContain('senior');
    }
  });

  it('defaults to top 8 and honors a configured top K', () => {
    expect(retrieveCandidates(seed, { role: 'backend', seniority: 'mid' }).candidates).toHaveLength(DEFAULT_TOP_K);
    expect(retrieveCandidates(seed, { role: 'backend', seniority: 'mid', topK: 3 }).candidates).toHaveLength(3);
  });

  it('falls back to behavioral questions for the same seniority when the primary pool is too small', () => {
    // The seed bank has 7 junior backend records, fewer than the default top K of 8.
    const result = retrieveCandidates(seed, { role: 'backend', seniority: 'junior' });
    expect(result.primaryPoolSize).toBe(7);
    expect(result.fallbackUsed).toBe(true);
    const fallback = result.candidates.filter((c) => c.pool === 'fallback');
    expect(fallback.length).toBeGreaterThan(0);
    for (const c of fallback) {
      expect(c.question.roles).toContain('behavioral');
      expect(c.question.seniorities).toContain('junior');
      expect(c.factors.some((f) => f.kind === 'fallback' && f.points === -RETRIEVAL_WEIGHTS.fallbackPenalty)).toBe(true);
    }
  });

  it('does not use a fallback pool for behavioral sessions', () => {
    const result = retrieveCandidates(seed, { role: 'behavioral', seniority: 'senior', topK: 50 });
    expect(result.fallbackUsed).toBe(false);
    expect(result.candidates.every((c) => c.question.roles.includes('behavioral'))).toBe(true);
  });

  it('applies an optional question-type stage filter', () => {
    const result = retrieveCandidates(seed, { role: 'backend', seniority: 'senior', questionTypes: ['system-design'], minPoolSize: 0 });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.question.type === 'system-design')).toBe(true);
  });

  it('rejects an invalid query', () => {
    expect(() => retrieveCandidates(seed, { role: 'designer' as never, seniority: 'mid' })).toThrow();
  });
});

describe('exclusions', () => {
  it('never returns already asked question IDs', () => {
    const result = retrieveCandidates(seed, {
      role: 'backend',
      seniority: 'mid',
      topK: 50,
      excludeIds: ['backend_rate_limiter_01', 'backend_cache_fundamentals_01'],
    });
    expect(ids(result)).not.toContain('backend_rate_limiter_01');
    expect(ids(result)).not.toContain('backend_cache_fundamentals_01');
    expect(result.excluded.map((e) => e.reason)).toEqual(['asked', 'asked']);
  });

  it('excludes close paraphrases of already spoken text', () => {
    const result = retrieveCandidates(seed, {
      role: 'backend',
      seniority: 'mid',
      topK: 50,
      excludeTexts: ['Design a rate limiter across several application servers so each customer gets a fixed number of requests per minute.'],
    });
    expect(ids(result)).not.toContain('backend_rate_limiter_01');
    expect(result.excluded).toEqual([
      expect.objectContaining({ questionId: 'backend_rate_limiter_01', reason: 'paraphrase' }),
    ]);
  });

  it('excludes bank records that closely paraphrase an asked record', () => {
    const repository = createQuestionRepository([
      makeQuestion({ id: 'limiter_public', question: 'How would you design a rate limiter for a public API with many clients?' }),
      makeQuestion({ id: 'limiter_partner', question: 'How would you design a rate limiter for partner API clients?' }),
      makeQuestion({ id: 'schema_orders', question: 'How would you model orders and line items?' }),
    ]);
    const result = retrieveCandidates(repository, { role: 'backend', seniority: 'mid', excludeIds: ['limiter_public'] });
    expect(ids(result)).toEqual(['schema_orders']);
    expect(result.excluded.map((e) => [e.questionId, e.reason])).toEqual([
      ['limiter_partner', 'paraphrase'],
      ['limiter_public', 'asked'],
    ]);
  });
});

describe('ranking', () => {
  it('ranks records whose topic matches a requested focus area first', () => {
    const result = retrieveCandidates(seed, { role: 'backend', seniority: 'mid', focusAreas: ['caching'] });
    expect(result.candidates[0]!.question.topic).toBe('caching');
    expect(result.candidates[0]!.factors).toContainEqual(
      expect.objectContaining({ kind: 'focus', points: RETRIEVAL_WEIGHTS.focusTopic }),
    );
  });

  it('weights missing competencies', () => {
    const result = retrieveCandidates(seed, {
      role: 'backend',
      seniority: 'senior',
      missingCompetencyIds: ['backend.observability'],
    });
    expect(result.candidates[0]!.question.competencyIds).toContain('backend.observability');
  });

  it('uses free-text terms across question, intent, topic, tags, and signals', () => {
    const result = retrieveCandidates(seed, { role: 'frontend', seniority: 'mid', queryText: 'screen reader keyboard' });
    expect(result.candidates[0]!.question.topic).toBe('accessibility');
    expect(result.candidates[0]!.factors.find((f) => f.kind === 'lexical')?.detail).toContain('keyboard');
  });

  it('penalizes difficulty mismatch', () => {
    const repository = createQuestionRepository([
      makeQuestion({ id: 'aaa_hard_topic', difficulty: 4 }),
      makeQuestion({ id: 'zzz_fit_topic', difficulty: 3 }),
    ]);
    const result = retrieveCandidates(repository, { role: 'backend', seniority: 'mid' });
    expect(ids(result)).toEqual(['zzz_fit_topic', 'aaa_hard_topic']);
    expect(result.candidates[1]!.factors).toContainEqual(
      expect.objectContaining({ kind: 'difficulty', points: -RETRIEVAL_WEIGHTS.difficultyPenaltyPerStep }),
    );
    const harder = retrieveCandidates(repository, { role: 'backend', seniority: 'mid', targetDifficulty: 4 });
    expect(ids(harder)[0]).toBe('aaa_hard_topic');
  });
});

describe('determinism and explanations', () => {
  it('returns identical results for identical queries', () => {
    const query: RetrievalQueryInput = { role: 'product', seniority: 'mid', focusAreas: ['metrics'], queryText: 'retention experiment' };
    expect(retrieveCandidates(seed, query)).toEqual(retrieveCandidates(seed, query));
  });

  it('breaks score ties by stable question ID regardless of bank order', () => {
    const records = [makeQuestion({ id: 'tie_charlie' }), makeQuestion({ id: 'tie_alpha' }), makeQuestion({ id: 'tie_bravo' })];
    const forward = retrieveCandidates(createQuestionRepository(records), { role: 'backend', seniority: 'mid' });
    const reversed = retrieveCandidates(createQuestionRepository([...records].reverse()), { role: 'backend', seniority: 'mid' });
    expect(ids(forward)).toEqual(['tie_alpha', 'tie_bravo', 'tie_charlie']);
    expect(ids(reversed)).toEqual(ids(forward));
  });

  it('explains every score: factor points sum to the score', () => {
    const result = retrieveCandidates(seed, {
      role: 'backend',
      seniority: 'junior',
      focusAreas: ['reliability', 'timeouts'],
      missingCompetencyIds: ['backend.reliability'],
      queryText: 'third-party API slow',
    });
    for (const c of result.candidates) {
      const sum = c.factors.reduce((total, f) => total + f.points, 0);
      expect(c.score).toBeCloseTo(sum, 2);
      expect(c.factors.every((f) => f.detail.length > 0)).toBe(true);
      expect(c.factors[0]!.kind).toBe('eligibility');
    }
    expect(result.candidates[0]!.questionId).toBe('backend_slow_dependency_timeout_01');
  });

  it('still ranks eligible records when no query terms match', () => {
    const result = retrieveCandidates(seed, { role: 'product', seniority: 'junior', focusAreas: ['quantum-basketry'] });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.factors.every((f) => f.kind !== 'focus' && f.kind !== 'lexical'))).toBe(true);
  });

  it('returns an empty candidate list, not an error, when nothing is eligible', () => {
    const repository = createQuestionRepository([makeQuestion({ id: 'only_backend' })]);
    const result = retrieveCandidates(repository, { role: 'frontend', seniority: 'junior' });
    expect(result.candidates).toEqual([]);
    const allAsked = retrieveCandidates(repository, { role: 'backend', seniority: 'mid', excludeIds: ['only_backend'] });
    expect(allAsked.candidates).toEqual([]);
  });

  it('does not mutate the repository or the returned records', () => {
    const retriever = createLexicalRetriever(seed);
    const before = JSON.stringify(seed.all());
    const result = retriever.search({ role: 'backend', seniority: 'mid', focusAreas: ['caching'] });
    expect(Object.isFrozen(result.candidates[0]!.question)).toBe(true);
    expect(JSON.stringify(seed.all())).toBe(before);
    expect(retriever.mode).toBe('lexical');
  });
});

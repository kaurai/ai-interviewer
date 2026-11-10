import { beforeAll, describe, expect, it } from 'vitest';
import { createQuestionRepository, loadQuestionRepository, type QuestionRepository } from '../src/data/questionRepository';
import {
  DEFAULT_TOP_K,
  FALLBACK_ROLE,
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

describe('AI track and seniority filtering', () => {
  it('returns only primary candidates matching the requested track and seniority', () => {
    // minPoolSize defaults to topK, so fallback must be disabled explicitly to
    // test primary-only filtering with a large top K.
    const result = retrieveCandidates(seed, { role: 'ai-evaluation', seniority: 'senior', topK: 50, minPoolSize: 0 });
    expect(result.fallbackUsed).toBe(false);
    expect(result.candidates.length).toBe(result.primaryPoolSize);
    for (const c of result.candidates) {
      expect(c.pool).toBe('primary');
      expect(c.question.roles).toContain('ai-evaluation');
      expect(c.question.seniorities).toContain('senior');
    }
  });

  it('defaults to top 8 and honors a configured top K', () => {
    expect(retrieveCandidates(seed, { role: 'ai-engineering', seniority: 'mid' }).candidates).toHaveLength(DEFAULT_TOP_K);
    expect(retrieveCandidates(seed, { role: 'ai-engineering', seniority: 'mid', topK: 3 }).candidates).toHaveLength(3);
  });

  it('falls back to ai-problem-solving questions for the same seniority when the primary pool is too small', () => {
    const junior = seed.all().filter((q) => q.roles.includes('ai-engineering') && q.seniorities.includes('junior'));
    const result = retrieveCandidates(seed, { role: 'ai-engineering', seniority: 'junior', topK: junior.length + 5 });
    expect(result.primaryPoolSize).toBe(junior.length);
    expect(result.fallbackUsed).toBe(true);
    const fallback = result.candidates.filter((c) => c.pool === 'fallback');
    expect(fallback.length).toBeGreaterThan(0);
    for (const c of fallback) {
      expect(c.question.roles).toContain(FALLBACK_ROLE);
      expect(c.question.roles).not.toContain('ai-engineering');
      expect(c.question.seniorities).toContain('junior');
      expect(c.factors.some((f) => f.kind === 'fallback' && f.points === -RETRIEVAL_WEIGHTS.fallbackPenalty)).toBe(true);
    }
  });

  it('does not use a fallback pool for ai-problem-solving sessions', () => {
    expect(FALLBACK_ROLE).toBe('ai-problem-solving');
    const result = retrieveCandidates(seed, { role: 'ai-problem-solving', seniority: 'senior', topK: 50 });
    expect(result.fallbackUsed).toBe(false);
    expect(result.candidates.every((c) => c.question.roles.includes('ai-problem-solving'))).toBe(true);
  });

  it('applies an optional question-type stage filter', () => {
    const result = retrieveCandidates(seed, { role: 'ai-engineering', seniority: 'senior', questionTypes: ['system-design'], minPoolSize: 0 });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.question.type === 'system-design')).toBe(true);
  });

  it('rejects an invalid or retired non-AI track', () => {
    expect(() => retrieveCandidates(seed, { role: 'designer' as never, seniority: 'mid' })).toThrow();
    expect(() => retrieveCandidates(seed, { role: 'backend' as never, seniority: 'mid' })).toThrow();
  });
});

describe('exclusions', () => {
  it('never returns already asked question IDs', () => {
    const result = retrieveCandidates(seed, {
      role: 'ai-evaluation',
      seniority: 'mid',
      topK: 50,
      excludeIds: ['ai_eval_llm_judge_validity_01', 'ai_eval_calibration_01'],
    });
    expect(ids(result)).not.toContain('ai_eval_llm_judge_validity_01');
    expect(ids(result)).not.toContain('ai_eval_calibration_01');
    expect(result.excluded.map((e) => e.reason)).toEqual(['asked', 'asked']);
  });

  it('excludes close paraphrases of already spoken text', () => {
    const result = retrieveCandidates(seed, {
      role: 'ai-evaluation',
      seniority: 'mid',
      topK: 50,
      excludeTexts: ['Your team wants one language model to grade another model\'s answers so evaluation can scale. How would you check the judge is trustworthy and which biases would you watch?'],
    });
    expect(ids(result)).not.toContain('ai_eval_llm_judge_validity_01');
    expect(result.excluded).toEqual([
      expect.objectContaining({ questionId: 'ai_eval_llm_judge_validity_01', reason: 'paraphrase' }),
    ]);
  });

  it('excludes bank records that closely paraphrase an asked record', () => {
    const repository = createQuestionRepository([
      makeQuestion({ id: 'chunking_wiki', question: 'How would you split long wiki documents into chunks for retrieval?' }),
      makeQuestion({ id: 'chunking_manual', question: 'How would you split long product manuals into chunks for retrieval?' }),
      makeQuestion({ id: 'gpu_batching', question: 'How would you batch requests for a model served on GPUs?' }),
    ]);
    const result = retrieveCandidates(repository, { role: 'ai-engineering', seniority: 'mid', excludeIds: ['chunking_wiki'] });
    expect(ids(result)).toEqual(['gpu_batching']);
    expect(result.excluded.map((e) => [e.questionId, e.reason])).toEqual([
      ['chunking_manual', 'paraphrase'],
      ['chunking_wiki', 'asked'],
    ]);
  });
});

describe('ranking', () => {
  it('ranks records whose topic matches a requested focus area first', () => {
    const result = retrieveCandidates(seed, { role: 'ai-engineering', seniority: 'mid', focusAreas: ['rag'] });
    expect(result.candidates[0]!.question.topic).toBe('rag');
    expect(result.candidates[0]!.factors).toContainEqual(
      expect.objectContaining({ kind: 'focus', points: RETRIEVAL_WEIGHTS.focusTopic }),
    );
  });

  it('ranks retrieval questions above transformer-theory questions for a rag focus', () => {
    const result = retrieveCandidates(seed, { role: 'ai-fundamentals', seniority: 'mid', focusAreas: ['rag'], topK: 50 });
    const position = (id: string) => ids(result).indexOf(id);
    expect(position('ai_fund_prompt_rag_finetune_01')).toBeGreaterThanOrEqual(0);
    expect(position('ai_fund_prompt_rag_finetune_01')).toBeLessThan(position('ai_fund_transformers_vs_rnn_01'));
    expect(position('ai_fund_prompt_rag_finetune_01')).toBeLessThan(position('ai_fund_attention_intuition_01'));
  });

  it('weights missing competencies', () => {
    const result = retrieveCandidates(seed, {
      role: 'ai-evaluation',
      seniority: 'senior',
      missingCompetencyIds: ['ai.online-experimentation'],
    });
    expect(result.candidates[0]!.question.competencyIds).toContain('ai.online-experimentation');
  });

  it('uses free-text terms across question, intent, topic, tags, and signals', () => {
    const result = retrieveCandidates(seed, { role: 'ai-engineering', seniority: 'mid', queryText: 'attacker hidden instructions email' });
    expect(result.candidates[0]!.question.topic).toBe('prompt-injection');
    expect(result.candidates[0]!.factors.find((f) => f.kind === 'lexical')?.detail).toContain('attacker');
  });

  it('penalizes difficulty mismatch', () => {
    const repository = createQuestionRepository([
      makeQuestion({ id: 'aaa_hard_topic', difficulty: 4 }),
      makeQuestion({ id: 'zzz_fit_topic', difficulty: 3 }),
    ]);
    const result = retrieveCandidates(repository, { role: 'ai-engineering', seniority: 'mid' });
    expect(ids(result)).toEqual(['zzz_fit_topic', 'aaa_hard_topic']);
    expect(result.candidates[1]!.factors).toContainEqual(
      expect.objectContaining({ kind: 'difficulty', points: -RETRIEVAL_WEIGHTS.difficultyPenaltyPerStep }),
    );
    const harder = retrieveCandidates(repository, { role: 'ai-engineering', seniority: 'mid', targetDifficulty: 4 });
    expect(ids(harder)[0]).toBe('aaa_hard_topic');
  });
});

describe('determinism and explanations', () => {
  it('returns identical results for identical queries', () => {
    const query: RetrievalQueryInput = { role: 'ai-evaluation', seniority: 'mid', focusAreas: ['llm-as-judge'], queryText: 'human raters agreement' };
    expect(retrieveCandidates(seed, query)).toEqual(retrieveCandidates(seed, query));
  });

  it('breaks score ties by stable question ID regardless of bank order', () => {
    const records = [makeQuestion({ id: 'tie_charlie' }), makeQuestion({ id: 'tie_alpha' }), makeQuestion({ id: 'tie_bravo' })];
    const forward = retrieveCandidates(createQuestionRepository(records), { role: 'ai-engineering', seniority: 'mid' });
    const reversed = retrieveCandidates(createQuestionRepository([...records].reverse()), { role: 'ai-engineering', seniority: 'mid' });
    expect(ids(forward)).toEqual(['tie_alpha', 'tie_bravo', 'tie_charlie']);
    expect(ids(reversed)).toEqual(ids(forward));
  });

  it('explains every score: factor points sum to the score', () => {
    const result = retrieveCandidates(seed, {
      role: 'ai-engineering',
      seniority: 'mid',
      focusAreas: ['prompt-injection', 'security'],
      missingCompetencyIds: ['ai.reliability-safety'],
      queryText: 'email attacker hidden instructions',
    });
    for (const c of result.candidates) {
      const sum = c.factors.reduce((total, f) => total + f.points, 0);
      expect(c.score).toBeCloseTo(sum, 2);
      expect(c.factors.every((f) => f.detail.length > 0)).toBe(true);
      expect(c.factors[0]!.kind).toBe('eligibility');
    }
    expect(result.candidates[0]!.questionId).toBe('ai_eng_prompt_injection_01');
  });

  it('still ranks eligible records when no query terms match', () => {
    const result = retrieveCandidates(seed, { role: 'ai-problem-solving', seniority: 'junior', focusAreas: ['quantum-basketry'] });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.factors.every((f) => f.kind !== 'focus' && f.kind !== 'lexical'))).toBe(true);
  });

  it('returns an empty candidate list, not an error, when nothing is eligible', () => {
    const repository = createQuestionRepository([makeQuestion({ id: 'only_engineering' })]);
    const result = retrieveCandidates(repository, { role: 'ai-fundamentals', seniority: 'junior' });
    expect(result.candidates).toEqual([]);
    const allAsked = retrieveCandidates(repository, { role: 'ai-engineering', seniority: 'mid', excludeIds: ['only_engineering'] });
    expect(allAsked.candidates).toEqual([]);
  });

  it('does not mutate the repository or the returned records', () => {
    const retriever = createLexicalRetriever(seed);
    const before = JSON.stringify(seed.all());
    const result = retriever.search({ role: 'ai-engineering', seniority: 'mid', focusAreas: ['rag'] });
    expect(Object.isFrozen(result.candidates[0]!.question)).toBe(true);
    expect(JSON.stringify(seed.all())).toBe(before);
    expect(retriever.mode).toBe('lexical');
  });
});

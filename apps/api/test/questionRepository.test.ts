import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  QuestionBankLoadError,
  UnknownQuestionError,
  createQuestionRepository,
  loadQuestionRepository,
} from '../src/data/questionRepository';
import { makeQuestion } from '../../../packages/shared/test/fixtures';

describe('question repository', () => {
  it('loads and validates the committed seed bank', async () => {
    const repository = await loadQuestionRepository();
    expect(repository.size).toBe(60);
    expect(repository.has('backend_rate_limiter_01')).toBe(true);
    expect(repository.require('backend_rate_limiter_01').competencyIds).toContain('backend.concurrency');
  });

  it('returns undefined from get and throws from require for unknown IDs', async () => {
    const repository = await loadQuestionRepository();
    expect(repository.get('not_a_question')).toBeUndefined();
    expect(() => repository.require('not_a_question')).toThrow(UnknownQuestionError);
  });

  it('returns deeply frozen records that callers cannot mutate', async () => {
    const repository = await loadQuestionRepository();
    const record = repository.require('backend_rate_limiter_01');
    expect(() => {
      (record as { question: string }).question = 'rewritten';
    }).toThrow(TypeError);
    expect(() => (record.expectedSignals as string[]).push('leak')).toThrow(TypeError);
    expect(() => (repository.all() as unknown[]).pop()).toThrow(TypeError);
  });

  it('is isolated from later mutation of the input data', () => {
    const input = [makeQuestion({ id: 'isolated_one' })];
    const repository = createQuestionRepository(input);
    input[0]!.question = 'mutated after load';
    expect(repository.require('isolated_one').question).not.toBe('mutated after load');
  });

  it('fails early with record IDs and reasons for invalid data', () => {
    const bad = [makeQuestion({ id: 'broken_one', scoringAnchors: { '1': 'a' } })];
    let error: unknown;
    try {
      createQuestionRepository(bad, 'fixture');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(QuestionBankLoadError);
    expect((error as Error).message).toContain('broken_one');
    expect((error as Error).message).toContain('missing-anchor');
  });

  it('reports an unreadable file path clearly', async () => {
    const missing = path.join(path.dirname(fileURLToPath(import.meta.url)), 'does-not-exist.json');
    await expect(loadQuestionRepository(missing)).rejects.toThrow(/Cannot read question bank/);
  });

  it('does not block loading on review-only near-duplicates', () => {
    const repository = createQuestionRepository([
      makeQuestion({ id: 'limiter_a', question: 'How would you design a rate limiter for a public API?' }),
      makeQuestion({ id: 'limiter_b', question: 'How would you design an API rate limiter for public clients?' }),
    ]);
    expect(repository.size).toBe(2);
  });
});

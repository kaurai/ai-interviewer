import { describe, expect, it } from 'vitest';
import { createMemorySessionStore } from '../../src/data/sessionStore';
import { loadQuestionRepository } from '../../src/data/questionRepository';
import { createInterviewService, TurnConflictError } from '../../src/domain/interview/service';

describe('interview service', () => {
  it('makes retrying one client turn idempotent and rejects conflicting reuse', async () => {
    const repository = await loadQuestionRepository();
    const store = createMemorySessionStore();
    const service = createInterviewService({ repository, store, maxFollowupsPerQuestion: 0, now: () => new Date('2026-01-01T00:00:00.000Z') });
    const created = await service.create({
      profile: { role: 'ai-engineering', seniority: 'mid', focusAreas: [], durationMinutes: 5, mode: 'text' },
      resume: null,
      budget: { kind: 'questions', count: 1 },
      providers: { answerMode: 'text', stt: [], tts: 'none', evaluator: 'deterministic' },
    });
    const input = { clientTurnId: 'turn-1', text: 'I would define constraints, compare options, test failures, and monitor the result.', inputMethod: 'text' as const };
    const first = await service.submit(created.session.id, input);
    const retry = await service.submit(created.session.id, input);
    expect(retry.outcome).toEqual(first.outcome);
    await expect(service.submit(created.session.id, { ...input, text: 'different' })).rejects.toBeInstanceOf(TurnConflictError);
  });
});

import type { InterviewQuestion } from '../src/schemas';

/**
 * A valid, self-contained question record for tests. Override fields to build
 * targeted failures. Each call returns a fresh deep copy.
 */
export function makeQuestion(overrides: Partial<InterviewQuestion> & { id: string }): InterviewQuestion {
  const { id } = overrides;
  const base: InterviewQuestion = {
    id,
    schemaVersion: 1,
    roles: ['ai-engineering'],
    seniorities: ['mid'],
    type: 'technical',
    topic: 'llm-caching',
    tags: ['cache-invalidation'],
    difficulty: 3,
    competencyIds: ['ai.serving-performance'],
    // Content tokens come only from the ID, so fixtures with distinct IDs are not near-duplicates.
    question: `How would you approach ${id.replace(/_/g, ' ')}?`,
    intent: 'Assess a fixture competency.',
    expectedSignals: ['states an assumption'],
    followupProbes: [{ id: `${id}.probe`, trigger: 'missing assumption', question: 'What did you assume?' }],
    scoringAnchors: { '1': 'No relevant evidence.', '3': 'Workable baseline.', '5': 'Precise and adaptable.' },
    source: { kind: 'original', title: 'Test fixtures' },
  };
  return structuredClone({ ...base, ...overrides });
}

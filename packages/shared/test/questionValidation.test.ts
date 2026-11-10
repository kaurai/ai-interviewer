import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  InterviewQuestionSchema,
  MAX_QUESTION_WORDS,
  NEAR_DUPLICATE_THRESHOLD,
  normalizeText,
  tokenSimilarity,
  validateQuestionBank,
  validateQuestionBankJson,
  type ValidationIssue,
} from '../src';
import { makeQuestion } from './fixtures';

const SEED_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/questions/seed-questions.json',
);

const rules = (issues: ValidationIssue[]) => issues.map((i) => i.rule);
const issueFor = (issues: ValidationIssue[], rule: string) => issues.find((i) => i.rule === rule);

describe('committed seed corpus', () => {
  const result = validateQuestionBankJson(readFileSync(SEED_PATH, 'utf8'), { seedCorpus: true });

  it('passes every validation rule', () => {
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('has the required size and primary-role distribution', () => {
    expect(result.stats.total).toBe(100);
    expect(result.stats.byPrimaryRole).toEqual({
      'ai-fundamentals': 25,
      'ai-engineering': 27,
      'ai-evaluation': 25,
      'ai-problem-solving': 23,
    });
  });

  it('offers every seniority within every primary role', () => {
    for (const perSeniority of Object.values(result.stats.byPrimaryRoleAndSeniority)) {
      for (const count of Object.values(perSeniority)) expect(count).toBeGreaterThanOrEqual(6);
    }
  });

  it('records truthful original provenance with no invented external metadata', () => {
    for (const q of result.questions) {
      expect(q.source).toEqual({ kind: 'original', title: 'AI Interviewer AI-skills seed bank' });
    }
  });

  it('assesses AI skills only: every competency uses the ai or shared namespace', () => {
    for (const q of result.questions) {
      for (const id of q.competencyIds) expect(id).toMatch(/^(ai|shared)\./);
    }
  });
});

describe('schema rejections', () => {
  const schemaIssue = (record: unknown) => {
    const result = validateQuestionBank([record]);
    expect(result.ok).toBe(false);
    return issueFor(result.issues, 'schema');
  };

  it('rejects an invalid role', () => {
    const issue = schemaIssue({ ...makeQuestion({ id: 'bad_role' }), roles: ['designer'] });
    expect(issue?.recordId).toBe('bad_role');
    expect(issue?.message).toContain('roles.0');
  });

  it('rejects an invalid seniority and difficulty', () => {
    const issue = schemaIssue({ ...makeQuestion({ id: 'bad_enum' }), seniorities: ['principal'], difficulty: 6 });
    expect(issue?.message).toContain('seniorities.0');
    expect(issue?.message).toContain('difficulty');
  });

  it('rejects injected extra fields because objects are strict', () => {
    const issue = schemaIssue({ ...makeQuestion({ id: 'extra_field' }), idealAnswer: 'leaked' });
    expect(issue?.message).toContain('idealAnswer');
  });

  it('rejects a missing or empty follow-up probe list and more than three probes', () => {
    const { followupProbes: _omit, ...missing } = makeQuestion({ id: 'no_probes' });
    expect(schemaIssue(missing)?.message).toContain('followupProbes');
    expect(schemaIssue(makeQuestion({ id: 'empty_probes', followupProbes: [] }))?.message).toContain('followupProbes');
    const four = [1, 2, 3, 4].map((n) => ({ id: `many_probes.p${n}`, trigger: 't', question: 'q?' }));
    expect(schemaIssue(makeQuestion({ id: 'many_probes', followupProbes: four }))?.message).toContain('followupProbes');
  });

  it('rejects an unknown competency ID', () => {
    const issue = schemaIssue({ ...makeQuestion({ id: 'bad_competency' }), competencyIds: ['ai.vibes'] });
    expect(issue?.message).toContain('competencyIds.0');
  });

  it('rejects a non-AI competency ID from the retired backend ontology', () => {
    const issue = schemaIssue({ ...makeQuestion({ id: 'non_ai_competency' }), competencyIds: ['backend.caching'] });
    expect(issue?.message).toContain('competencyIds.0');
  });

  it('rejects a retired non-AI role', () => {
    const issue = schemaIssue({ ...makeQuestion({ id: 'retired_role' }), roles: ['backend'] });
    expect(issue?.message).toContain('roles.0');
  });

  it('rejects a schemaVersion other than 1', () => {
    expect(schemaIssue({ ...makeQuestion({ id: 'bad_version' }), schemaVersion: 2 })?.message).toContain('schemaVersion');
  });

  it('rejects blank required text and empty expected signals', () => {
    const issue = schemaIssue(makeQuestion({ id: 'blank_text', intent: '   ', expectedSignals: [] }));
    expect(issue?.message).toContain('intent');
    expect(issue?.message).toContain('expectedSignals');
  });

  it('rejects non-slug IDs', () => {
    expect(schemaIssue(makeQuestion({ id: 'Bad-ID' }))?.message).toContain('id');
  });

  it('rejects invented provenance on original records and incomplete licensed records', () => {
    const original = schemaIssue(
      makeQuestion({ id: 'fake_url', source: { kind: 'original', title: 'x', url: 'https://example.com' } }),
    );
    expect(original?.message).toContain('source.url');
    const licensed = schemaIssue(makeQuestion({ id: 'no_license', source: { kind: 'licensed', title: 'x' } }));
    expect(licensed?.message).toContain('source.license');
    expect(licensed?.message).toContain('source.retrievedAt');
  });

  it('accepts a complete licensed record', () => {
    const record = makeQuestion({
      id: 'licensed_ok',
      source: { kind: 'licensed', title: 'x', url: 'https://example.com/a', license: 'CC-BY-4.0', retrievedAt: '2026-11-09' },
    });
    expect(InterviewQuestionSchema.safeParse(record).success).toBe(true);
  });
});

describe('quality and corpus rules', () => {
  it('reports duplicate question IDs, even when the duplicate is malformed', () => {
    const result = validateQuestionBank([
      makeQuestion({ id: 'dup_id' }),
      { ...makeQuestion({ id: 'dup_id' }), roles: [] },
    ]);
    expect(issueFor(result.issues, 'duplicate-id')).toMatchObject({ recordId: 'dup_id', index: 1 });
  });

  it('reports probe IDs that are reused across records', () => {
    const shared = { id: 'alpha_one.shared', trigger: 't', question: 'q?' };
    const result = validateQuestionBank([
      makeQuestion({ id: 'alpha_one', followupProbes: [shared] }),
      makeQuestion({ id: 'beta_two', followupProbes: [shared] }),
    ]);
    expect(rules(result.issues)).toContain('duplicate-probe-id');
    expect(rules(result.issues)).toContain('probe-id-prefix');
    expect(issueFor(result.issues, 'duplicate-probe-id')?.recordId).toBe('beta_two');
  });

  it('requires anchors for levels 1, 3, and 5', () => {
    const result = validateQuestionBank([makeQuestion({ id: 'no_five', scoringAnchors: { '1': 'a', '3': 'b' } })]);
    expect(issueFor(result.issues, 'missing-anchor')?.message).toContain('level 5');
  });

  it(`rejects spoken questions over ${MAX_QUESTION_WORDS} words`, () => {
    const long = Array.from({ length: MAX_QUESTION_WORDS + 1 }, (_, i) => `word${i}`).join(' ');
    const result = validateQuestionBank([makeQuestion({ id: 'too_long', question: long })]);
    expect(issueFor(result.issues, 'word-count')?.message).toContain(`${MAX_QUESTION_WORDS + 1} words`);
  });

  it('rejects duplicate tags, competencies, and signals', () => {
    const result = validateQuestionBank([
      makeQuestion({
        id: 'dupes',
        tags: ['cache', 'cache'],
        competencyIds: ['ai.serving-performance', 'ai.serving-performance'],
        expectedSignals: ['Names a TTL.', 'names a ttl'],
      }),
    ]);
    expect(rules(result.issues)).toEqual(expect.arrayContaining(['duplicate-tag', 'duplicate-competency', 'duplicate-signal']));
  });

  it('rejects difficulty outside the range of a listed seniority', () => {
    const result = validateQuestionBank([makeQuestion({ id: 'too_hard', seniorities: ['junior', 'mid'], difficulty: 4 })]);
    expect(issueFor(result.issues, 'difficulty-seniority')?.message).toContain('junior');
  });

  it('rejects placeholder text but allows the ordinary word "placeholder"', () => {
    // The fixture derives `question` from the ID, so the ID must not itself contain a placeholder token.
    const flagged = validateQuestionBank([makeQuestion({ id: 'leftover_intent', intent: 'TODO write intent' })]);
    const placeholderIssues = flagged.issues.filter((i) => i.rule === 'placeholder');
    expect(placeholderIssues).toHaveLength(1);
    expect(placeholderIssues[0]?.message).toContain('intent');
    const allowed = validateQuestionBank([
      makeQuestion({ id: 'prompt_template', redFlags: ['leaves a placeholder value in the prompt template'] }),
    ]);
    expect(allowed.issues).toEqual([]);
  });

  it('reports exact duplicates after case, punctuation, and whitespace normalization', () => {
    const result = validateQuestionBank([
      makeQuestion({ id: 'first_copy', question: 'How would you design a rate limiter?' }),
      makeQuestion({ id: 'second_copy', question: '  how WOULD you design a rate-limiter!! ' }),
    ]);
    expect(issueFor(result.issues, 'exact-duplicate')).toMatchObject({ recordId: 'second_copy', severity: 'error' });
  });

  it('reports likely near-duplicates as review issues without dropping records', () => {
    const result = validateQuestionBank([
      makeQuestion({ id: 'limiter_a', question: 'How would you design a rate limiter for a public API?' }),
      makeQuestion({ id: 'limiter_b', question: 'How would you design an API rate limiter for public clients?' }),
    ]);
    const issue = issueFor(result.issues, 'near-duplicate');
    expect(issue).toMatchObject({ recordId: 'limiter_b', severity: 'review' });
    expect(issue?.message).toContain('limiter_a');
    expect(result.questions).toHaveLength(2);
  });

  it('enforces seed size and distribution only when seed rules are on', () => {
    const small = [makeQuestion({ id: 'only_one' })];
    expect(validateQuestionBank(small).ok).toBe(true);
    const seeded = validateQuestionBank(small, { seedCorpus: true });
    expect(rules(seeded.issues)).toEqual(expect.arrayContaining(['corpus-size', 'role-distribution', 'seniority-coverage']));
  });

  it('reports a wrong AI track distribution even at the right corpus size', () => {
    const allEngineering = Array.from({ length: 100 }, (_, i) =>
      makeQuestion({ id: `engineering_only_${i}`, seniorities: ['junior', 'mid', 'senior'] }));
    const result = validateQuestionBank(allEngineering, { seedCorpus: true });
    const distribution = result.issues.filter((i) => i.rule === 'role-distribution').map((i) => i.message);
    expect(rules(result.issues)).not.toContain('corpus-size');
    expect(distribution).toEqual(expect.arrayContaining([
      'primary role ai-fundamentals must have 25 records; found 0',
      'primary role ai-engineering must have 27 records; found 100',
    ]));
  });

  it('reports JSON parse failures and non-array input', () => {
    expect(rules(validateQuestionBankJson('{ not json').issues)).toEqual(['json-parse']);
    expect(rules(validateQuestionBank({ questions: [] }).issues)).toEqual(['not-array']);
  });

  it('is deterministic', () => {
    const input = [makeQuestion({ id: 'x_one', roles: [] as never }), makeQuestion({ id: 'x_one' })];
    expect(validateQuestionBank(input)).toEqual(validateQuestionBank(input));
  });
});

describe('text similarity', () => {
  it('normalizes case, punctuation, and diacritics', () => {
    expect(normalizeText('  Café — API,  Design! ')).toBe('cafe api design');
  });

  it('ignores interview boilerplate and stopwords', () => {
    expect(tokenSimilarity('Tell me about a time you led a migration.', 'Describe a situation where you led a migration?')).toBe(1);
    expect(tokenSimilarity('How do you cache data?', 'How do you test components?')).toBe(0);
    expect(NEAR_DUPLICATE_THRESHOLD).toBeGreaterThan(0);
  });
});

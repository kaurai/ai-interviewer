import {
  InterviewPlanSchema,
  contentTokens,
  tokenSet,
  type CompetencyId,
  type InterviewBudget,
  type InterviewPlan,
  type PlanStage,
  type QuestionSelection,
  type QuestionType,
  type ResumeProfile,
  type Role,
  type Seniority,
} from '@ai-interviewer/shared';
import type { QuestionRecord, QuestionRepository } from '../../data/questionRepository';
import { resumeQueryTerms } from '../../resume/profile';
import { retrieveCandidates, type RetrievalCandidate } from '../retriever';
import { tokensMatch } from '../answerText';

/**
 * Level-1 planning (CONTEXT.md 8.1), fully deterministic.
 *
 *   budget -> stage template -> retrieve candidates per stage (existing
 *   lexical retriever, resume terms in queryText) -> pick distinct
 *   competencies/topics -> validated InterviewPlan.
 *
 * The planner only chooses among real bank IDs returned by the retriever. It
 * never rewrites question text and never sees candidate answers.
 */

export class PlanningError extends Error {
  override readonly name = 'PlanningError';
}

/** Rough minutes per main question including one possible follow-up. */
export const MINUTES_PER_QUESTION = 5 / 3;
export const MAX_MAIN_QUESTIONS = 6;
export const RETRIEVAL_TOP_K = 12;

export function mainQuestionCount(budget: InterviewBudget): number {
  if (budget.kind === 'questions') return budget.count;
  return Math.max(1, Math.min(MAX_MAIN_QUESTIONS, Math.round(budget.minutes / MINUTES_PER_QUESTION)));
}

/** Soft time budget. Question-count plans still get one, for follow-up decisions. */
export function budgetSeconds(budget: InterviewBudget): number {
  if (budget.kind === 'duration') return budget.minutes * 60;
  return Math.round(budget.count * MINUTES_PER_QUESTION * 60);
}

interface StageSpec {
  id: string;
  label: string;
  role: Role;
  questionTypes: QuestionType[];
}

/** Role-specific questions first, a behavioral/scenario question last when the budget allows. */
export function stageTemplate(role: Role, count: number): StageSpec[] {
  const roleTypes: QuestionType[] = role === 'behavioral' ? ['behavioral'] : ['technical', 'system-design', 'situational'];
  const behavioralTypes: QuestionType[] = role === 'behavioral' ? ['behavioral'] : ['behavioral', 'situational'];
  const specs: StageSpec[] = [{ id: 'stage-1', label: 'Core role question', role, questionTypes: roleTypes }];
  for (let i = 1; i < count; i += 1) {
    const isLast = i === count - 1;
    specs.push(
      isLast
        ? { id: `stage-${i + 1}`, label: 'Behavioral or scenario question', role: 'behavioral', questionTypes: behavioralTypes }
        : { id: `stage-${i + 1}`, label: 'Second competency', role, questionTypes: roleTypes },
    );
  }
  return specs;
}

function questionVocabulary(q: QuestionRecord): Set<string> {
  return tokenSet([q.topic, q.tags.join(' '), q.question, q.intent, q.expectedSignals.join(' ')].join(' '));
}

/** Resume terms whose content tokens appear in the question's vocabulary. */
export function matchResumeTerms(q: QuestionRecord, terms: readonly string[]): string[] {
  const vocabulary = questionVocabulary(q);
  return terms.filter((term) => contentTokens(term).some((token) => [...vocabulary].some((v) => tokensMatch(token, v))));
}

/** Prefer new competencies and a new topic; relax step by step rather than fail. */
function pickDistinct(candidates: readonly RetrievalCandidate[], usedCompetencies: ReadonlySet<string>, usedTopics: ReadonlySet<string>) {
  const isNew = (id: string) => !usedCompetencies.has(id);
  const fullyNew = candidates.find((c) => c.question.competencyIds.every(isNew) && !usedTopics.has(c.question.topic));
  if (fullyNew) return { candidate: fullyNew, diversity: 'new competencies and topic' };
  const someNew = candidates.find((c) => c.question.competencyIds.some(isNew) && !usedTopics.has(c.question.topic));
  if (someNew) return { candidate: someNew, diversity: 'adds at least one new competency' };
  const first = candidates[0];
  return first ? { candidate: first, diversity: 'best remaining match (pool exhausted for new competencies)' } : null;
}

export interface BuildPlanInput {
  repository: QuestionRepository;
  role: Role;
  seniority: Seniority;
  focusAreas: readonly string[];
  resume: ResumeProfile | null;
  budget: InterviewBudget;
  maxFollowupsPerQuestion: 0 | 1;
  now: Date;
}

export function buildQueryText(focusAreas: readonly string[], resume: ResumeProfile | null): string {
  return [...focusAreas, ...resumeQueryTerms(resume)].join(', ').slice(0, 5000);
}

export function buildInterviewPlan(input: BuildPlanInput): InterviewPlan {
  const count = mainQuestionCount(input.budget);
  const specs = stageTemplate(input.role, count);
  const resumeTerms = resumeQueryTerms(input.resume);
  const queryText = buildQueryText(input.focusAreas, input.resume);
  const totalSeconds = budgetSeconds(input.budget);
  const minutesPerStage = Math.round((totalSeconds / 60 / count) * 10) / 10;

  const selected: QuestionRecord[] = [];
  const selections: QuestionSelection[] = [];
  const stages: PlanStage[] = [];
  const usedCompetencies = new Set<CompetencyId>();
  const usedTopics = new Set<string>();

  for (const spec of specs) {
    const result = retrieveCandidates(input.repository, {
      role: spec.role,
      seniority: input.seniority,
      focusAreas: [...input.focusAreas],
      questionTypes: spec.questionTypes,
      excludeIds: selected.map((q) => q.id),
      queryText: queryText === '' ? undefined : queryText,
      topK: RETRIEVAL_TOP_K,
    });
    const pick = pickDistinct(result.candidates, usedCompetencies, usedTopics);
    if (!pick) continue; // pool exhausted for this stage; later stages may still fill
    const { candidate, diversity } = pick;
    const q = candidate.question;
    selected.push(q);
    q.competencyIds.forEach((id) => usedCompetencies.add(id));
    usedTopics.add(q.topic);

    const resumeTermsMatched = matchResumeTerms(q, resumeTerms).slice(0, 20);
    const reasons = [
      `${spec.label}: rank ${result.candidates.indexOf(candidate) + 1} of ${result.candidates.length} retrieved candidates`,
      `diversity: ${diversity}`,
      ...candidate.factors.filter((f) => f.kind !== 'eligibility' || candidate.pool === 'fallback').map((f) => f.detail),
    ];
    if (resumeTermsMatched.length > 0) reasons.push(`resume terms matched: ${resumeTermsMatched.join(', ')}`);

    selections.push({
      questionId: q.id,
      stageId: spec.id,
      rank: result.candidates.indexOf(candidate) + 1,
      score: candidate.score,
      pool: candidate.pool,
      competencyIds: [...q.competencyIds],
      questionType: q.type,
      topic: q.topic,
      reasons: reasons.map((r) => r.slice(0, 300)).slice(0, 12),
      resumeTermsMatched,
    });
    stages.push({
      id: spec.id,
      label: spec.label,
      questionTypes: spec.questionTypes,
      targetQuestionCount: 1,
      targetMinutes: minutesPerStage,
      competencyIds: [...q.competencyIds],
    });
  }

  if (selected.length === 0) {
    throw new PlanningError(`No questions in the bank match role ${input.role} and seniority ${input.seniority}.`);
  }

  return InterviewPlanSchema.parse({
    createdAt: input.now.toISOString(),
    budget: input.budget,
    budgetSeconds: totalSeconds,
    maxFollowupsPerQuestion: input.maxFollowupsPerQuestion,
    targetCompetencies: [...usedCompetencies].map((id) => ({ id, weight: 1, minimumEvidenceTurns: 1 })),
    stages,
    candidateQuestionIds: selected.map((q) => q.id),
    currentStageIndex: 0,
    selections,
    queryText,
    resumeUsed: input.resume !== null,
  });
}

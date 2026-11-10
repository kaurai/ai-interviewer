import {
  CORE_DIMENSION_IDS,
  DIMENSION_IDS,
  InterviewFeedbackSchema,
  findDanglingReferences,
  validateEvidence,
  type Confidence,
  type DimensionAssessment,
  type DimensionId,
  type Evidence,
  type InterviewFeedback,
  type InterviewSession,
  type PracticeAction,
  type QuestionObservation,
  type Score,
  type SignalCoverage,
  type Strength,
  type TranscriptTurn,
} from '@ai-interviewer/shared';
import type { QuestionRecord, QuestionRepository } from '../data/questionRepository';
import { countWordsIn, matchSignal, splitSentences, topicalOverlap, type AnswerUnit } from './answerText';

/**
 * Conservative deterministic evaluator.
 *
 * It can measure coverage, structure, relevance, and explicit answer features.
 * It deliberately does not decide whether technical claims are true; that
 * dimension remains unassessed unless a validated model/reviewer is added.
 */

const round = (value: number, places = 2) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const answerTurns = (session: InterviewSession, questionId?: string): TranscriptTurn[] =>
  session.transcript.filter(
    (turn) => turn.speaker === 'candidate' && turn.kind === 'answer' && (questionId === undefined || turn.questionId === questionId),
  );

const unitsFor = (turns: readonly TranscriptTurn[]): AnswerUnit[] =>
  turns.map((turn) => ({ turnId: turn.id, sentences: splitSentences(turn.text) }));

interface PassAResult {
  evidence: Evidence[];
  signalCoverage: SignalCoverage[];
  observations: QuestionObservation[];
}

export function extractEvidence(session: InterviewSession, repository: QuestionRepository): PassAResult {
  const evidence: Evidence[] = [];
  const signalCoverage: SignalCoverage[] = [];
  const observations: QuestionObservation[] = [];
  const nextEvidenceId = () => `e${evidence.length + 1}`;

  for (const questionId of session.plan.candidateQuestionIds) {
    const question = repository.require(questionId);
    const allCandidate = session.transcript.filter((turn) => turn.speaker === 'candidate' && turn.questionId === questionId);
    const answers = allCandidate.filter((turn) => turn.kind === 'answer');
    const units = unitsFor(answers);
    let demonstrated = 0;
    let partial = 0;

    for (const [signalIndex, signal] of question.expectedSignals.entries()) {
      const match = matchSignal(signal, units);
      const evidenceIds: string[] = [];
      if (match.best) {
        const id = nextEvidenceId();
        evidence.push({
          id,
          questionId,
          competencyId: question.competencyIds[signalIndex % question.competencyIds.length] ?? question.competencyIds[0] ?? null,
          dimensionIds: ['completeness', 'depth', 'relevance'],
          turnIds: [match.best.turnId],
          quote: match.best.quote,
          interpretation:
            match.status === 'demonstrated'
              ? `Provides lexical evidence for expected signal: ${signal}`
              : `Touches the expected signal but does not fully explain it: ${signal}`,
          signal: match.status === 'demonstrated' ? 'positive' : 'neutral',
        });
        evidenceIds.push(id);
      }
      if (match.status === 'demonstrated') demonstrated += 1;
      if (match.status === 'partial') partial += 1;
      signalCoverage.push({ questionId, signalIndex, signal, status: match.status, evidenceIds });
    }

    // Every substantive answer contributes a directly quotable observation,
    // even when its words do not overlap the private expected-signal wording.
    for (const turn of answers) {
      const firstSentence = splitSentences(turn.text)[0]?.text;
      if (!firstSentence) continue;
      const alreadyQuoted = evidence.some((item) => item.turnIds.includes(turn.id) && item.quote === firstSentence);
      if (!alreadyQuoted) {
        evidence.push({
          id: nextEvidenceId(),
          questionId,
          competencyId: question.competencyIds[0] ?? null,
          dimensionIds: ['relevance', 'structure', 'clarity', 'concision', 'communication', 'examples_evidence', 'seniority_alignment'],
          turnIds: [turn.id],
          quote: firstSentence,
          interpretation: 'Observable opening claim from the candidate answer.',
          signal: 'neutral',
        });
      }
    }

    const skipped = allCandidate.some((turn) => turn.kind === 'skip');
    const silent = allCandidate.some((turn) => turn.kind === 'silence');
    observations.push({
      questionId,
      questionText: question.question,
      status: answers.length > 0 ? 'answered' : skipped ? 'skipped' : silent ? 'silence' : 'not_reached',
      candidateTurnIds: allCandidate.map((turn) => turn.id),
      followupAsked: session.transcript.some((turn) => turn.kind === 'follow_up' && turn.questionId === questionId),
      signalsDemonstrated: demonstrated,
      signalsPartial: partial,
      signalsTotal: question.expectedSignals.length,
      observations: [
        `${demonstrated} of ${question.expectedSignals.length} expected signals demonstrated`,
        ...(partial > 0 ? [`${partial} additional signal(s) partially evidenced`] : []),
        ...(skipped ? ['Question was skipped and is not scored as a weakness'] : []),
        ...(silent ? ['No usable answer was committed; this question is unassessed'] : []),
      ],
    });
  }
  return { evidence, signalCoverage, observations };
}

function firstEvidence(passA: PassAResult, dimension: DimensionId): Evidence | undefined {
  return passA.evidence.find((item) => item.dimensionIds.includes(dimension));
}

function assessed(
  dimensionId: DimensionId,
  score: Score,
  evidenceIds: string[],
  rationale: string,
  confidence: Confidence = 'medium',
  basis: DimensionAssessment['basis'] = 'evidence',
): DimensionAssessment {
  return { dimensionId, score, evidenceIds, basis, rationale, notAssessedReason: null, confidence };
}

function unassessed(dimensionId: DimensionId, reason: DimensionAssessment['notAssessedReason'], rationale: string): DimensionAssessment {
  return { dimensionId, score: null, evidenceIds: [], basis: null, rationale, notAssessedReason: reason, confidence: 'low' };
}

const scoreFromRatio = (ratio: number): Score => (ratio >= 0.95 ? 5 : ratio >= 0.7 ? 4 : ratio >= 0.45 ? 3 : ratio > 0 ? 2 : 1);

function scoreDimensions(session: InterviewSession, repository: QuestionRepository, passA: PassAResult): DimensionAssessment[] {
  const answers = answerTurns(session);
  const text = answers.map((turn) => turn.text).join('\n');
  const words = countWordsIn(text);
  const sentences = splitSentences(text).length;
  const evidenceFor = (dimension: DimensionId) => passA.evidence.filter((item) => item.dimensionIds.includes(dimension)).map((item) => item.id);
  const first = (dimension: DimensionId) => firstEvidence(passA, dimension);
  const scoreOrNull = (dimension: DimensionId, score: Score, rationale: string, confidence: Confidence = 'medium') => {
    const item = first(dimension);
    return item ? assessed(dimension, score, [item.id], rationale, confidence) : unassessed(dimension, answers.length === 0 ? 'no_usable_answer' : 'no_evidence', 'No quotable evidence for this dimension.');
  };

  const demonstrated = passA.signalCoverage.filter((item) => item.status === 'demonstrated').length;
  const partial = passA.signalCoverage.filter((item) => item.status === 'partial').length;
  const totalSignals = passA.signalCoverage.length;
  const coverageRatio = totalSignals === 0 ? 0 : (demonstrated + partial * 0.5) / totalSignals;
  const questionOverlap = session.plan.candidateQuestionIds
    .map((id) => {
      const q = repository.require(id);
      const answer = answerTurns(session, id).map((turn) => turn.text).join(' ');
      return answer === '' ? null : topicalOverlap(answer, q.question);
    })
    .filter((value): value is number => value !== null);
  const avgOverlap = questionOverlap.length ? questionOverlap.reduce((a, b) => a + b, 0) / questionOverlap.length : 0;
  const reasoningMarkers = (text.match(/\b(?:because|trade-?off|alternative|depends|failure|risk|however|instead|versus|vs\.?|if .* then)\b/gi) ?? []).length;
  const exampleMarkers = (text.match(/\b(?:for example|for instance|when i|in my|we built|i built|i led|resulted|improved|reduced|increased|\d+(?:\.\d+)?%?)\b/gi) ?? []).length;
  const communicationMarkers = (text.match(/\b(?:assum(?:e|ing|ption)|scope|clarif|audience|requirement|constraint)\b/gi) ?? []).length;
  const deliveryTurns = answers.filter((turn) => turn.timing);

  const result: DimensionAssessment[] = [];
  result.push(unassessed('technical_accuracy', 'needs_model_review', 'The deterministic evaluator does not label technical claims correct or incorrect.'));
  result.push(scoreOrNull('relevance', avgOverlap >= 0.25 || coverageRatio >= 0.5 ? 4 : avgOverlap > 0.05 || coverageRatio > 0 ? 3 : 2, 'Measures question-term and expected-signal alignment, not technical correctness.'));
  result.push(
    totalSignals === 0 || answers.length === 0
      ? unassessed('completeness', answers.length === 0 ? 'no_usable_answer' : 'no_opportunity', 'No usable signal-coverage opportunity.')
      : assessed('completeness', scoreFromRatio(coverageRatio), evidenceFor('completeness'), `${demonstrated} demonstrated and ${partial} partial of ${totalSignals} expected signals.`, 'high', 'signal-coverage'),
  );
  result.push(words < 25 ? unassessed('depth', 'answer_too_short', 'Fewer than 25 words of substantive answer content.') : scoreOrNull('depth', words >= 240 ? 4 : words >= 90 ? 3 : 2, 'Uses answer length and explained-signal evidence as a conservative depth proxy.'));
  result.push(reasoningMarkers === 0 ? unassessed('reasoning_tradeoffs', 'no_evidence', 'No explicit justification, alternative, risk, or tradeoff marker was observed.') : scoreOrNull('reasoning_tradeoffs', reasoningMarkers >= 5 ? 4 : 3, `${reasoningMarkers} explicit reasoning/tradeoff marker(s) were observed.`));
  result.push(sentences < 3 ? unassessed('structure', 'answer_too_short', 'Too few sentences to judge answer structure.') : scoreOrNull('structure', sentences >= 8 ? 4 : 3, 'The answer has enough ordered units to assess structure.'));
  result.push(scoreOrNull('clarity', 3, 'The committed answer contains a directly quotable, interpretable claim.'));
  result.push(scoreOrNull('concision', words > 700 ? 2 : words > 0 && words <= 400 ? 4 : 3, `${words} committed answer words across the interview.`));
  result.push(communicationMarkers === 0 ? scoreOrNull('communication', 2, 'Answers did not explicitly state assumptions, scope, or constraints.') : scoreOrNull('communication', communicationMarkers >= 3 ? 4 : 3, `${communicationMarkers} scope/assumption marker(s) were observed.`));
  result.push(exampleMarkers === 0 ? unassessed('examples_evidence', 'no_evidence', 'No concrete example, outcome, or quantitative detail was detected.') : scoreOrNull('examples_evidence', exampleMarkers >= 4 ? 4 : 3, `${exampleMarkers} example/outcome marker(s) were observed.`));
  result.push(words < 25 ? unassessed('seniority_alignment', 'answer_too_short', 'Not enough evidence to compare scope with the stated seniority.') : scoreOrNull('seniority_alignment', coverageRatio >= 0.7 && reasoningMarkers >= 2 ? 4 : coverageRatio >= 0.35 ? 3 : 2, `Compared observable depth and tradeoffs with the stated ${session.profile.seniority} practice level.`));
  result.push(unassessed('confidence_calibration', 'needs_model_review', 'Correctness is required before certainty can be judged fairly.'));

  if (deliveryTurns.length === 0) {
    result.push(unassessed('delivery', 'no_delivery_data', 'No reliable audio duration metadata was supplied.'));
  } else {
    const timedWords = deliveryTurns.reduce((sum, turn) => sum + countWordsIn(turn.text), 0);
    const seconds = deliveryTurns.reduce((sum, turn) => sum + (turn.timing?.audioDurationSeconds ?? 0), 0);
    const wpm = seconds > 0 ? (timedWords / seconds) * 60 : 0;
    const item = first('clarity') ?? passA.evidence[0];
    result.push(item ? assessed('delivery', wpm >= 90 && wpm <= 190 ? 3 : 2, [item.id], `Measured speaking rate was ${Math.round(wpm)} words per minute; accent and pronunciation are not assessed.`, 'medium', 'timing-metadata') : unassessed('delivery', 'no_evidence', 'Timing existed but no usable answer evidence was available.'));
  }
  return result;
}

function buildActions(session: InterviewSession, repository: QuestionRepository, passA: PassAResult, assessments: readonly DimensionAssessment[]): PracticeAction[] {
  const actions: PracticeAction[] = [];
  for (const missing of passA.signalCoverage.filter((item) => item.status === 'not_evidenced')) {
    if (actions.length >= 3) break;
    const turns = answerTurns(session, missing.questionId);
    if (turns.length === 0) continue;
    const q = repository.require(missing.questionId);
    const competencyId = q.competencyIds[missing.signalIndex % q.competencyIds.length] ?? q.competencyIds[0] ?? null;
    actions.push({
      priority: actions.length + 1,
      dimensionId: 'completeness',
      competencyId,
      issue: `The answer did not evidence: ${missing.signal}`,
      evidenceIds: [],
      whyItMatters: `This signal is part of what question ${q.id} was designed to assess.`,
      action: `State the mechanism for “${missing.signal}” explicitly, then connect it to one choice or failure mode.`,
      exercise: `Spend 15 minutes outlining ${q.topic}: mechanism, one alternative, one failure mode, and one concrete example.`,
      successCriteria: 'In a two-minute retry, name the mechanism, one tradeoff, and one failure mode without prompting.',
      retryPrompt: q.followupProbes[0]?.question ?? q.question,
      relatedTurnIds: turns.map((turn) => turn.id),
    });
  }
  for (const assessment of assessments.filter((item) => item.score !== null && item.score <= 2)) {
    if (actions.length >= 3 || assessment.dimensionId === 'completeness') continue;
    const firstTurn = answerTurns(session)[0];
    if (!firstTurn) break;
    actions.push({
      priority: actions.length + 1,
      dimensionId: assessment.dimensionId,
      competencyId: null,
      issue: assessment.rationale ?? `${assessment.dimensionId} needs more evidence.`,
      evidenceIds: assessment.evidenceIds,
      whyItMatters: `Stronger ${assessment.dimensionId.replaceAll('_', ' ')} makes interview evidence easier to assess.`,
      action: 'Open with the decision, explain the mechanism, and close with one tradeoff or outcome.',
      exercise: 'Record a 90-second answer using a three-part outline, then check that each part contains a distinct claim.',
      successCriteria: 'The retry has a clear opening, at least two mechanism details, and one explicit tradeoff within 90 seconds.',
      retryPrompt: 'Retry your weakest answer using: decision, mechanism, tradeoff, and concrete example.',
      relatedTurnIds: [firstTurn.id],
    });
  }
  return actions;
}

export function evaluateInterview(session: InterviewSession, repository: QuestionRepository, at: Date = new Date()): InterviewFeedback {
  const passA = extractEvidence(session, repository);
  const validated = validateEvidence(passA.evidence, session.transcript);
  const safePassA = { ...passA, evidence: validated.valid };
  const assessments = scoreDimensions(session, repository, safePassA);
  const assessedCore = assessments.filter((item) => item.dimensionId !== 'delivery' && item.score !== null);
  const coverage = round(assessedCore.length / CORE_DIMENSION_IDS.length);
  const overallScore = coverage < 0.5 || assessedCore.length === 0
    ? null
    : round(assessedCore.reduce((sum, item) => sum + (item.score ?? 0), 0) / assessedCore.length, 1);
  const evidenceCount = safePassA.evidence.length;
  const overallConfidence: Confidence = coverage >= 0.75 && evidenceCount >= 6 ? 'high' : coverage >= 0.5 && evidenceCount >= 3 ? 'medium' : 'low';

  const competencyAssessments = session.plan.targetCompetencies.map(({ id }) => {
    const evidence = safePassA.evidence.filter((item) => item.competencyId === id);
    const relevantSignals = safePassA.signalCoverage.filter((item) => repository.require(item.questionId).competencyIds.includes(id));
    const ratio = relevantSignals.length === 0 ? 0 : relevantSignals.filter((item) => item.status === 'demonstrated').length / relevantSignals.length;
    const score = evidence.length === 0 ? null : scoreFromRatio(Math.max(0.2, ratio));
    return {
      competencyId: id,
      score,
      evidenceIds: evidence.map((item) => item.id),
      strengths: evidence.slice(0, 2).map((item) => item.interpretation),
      improvements: relevantSignals.filter((item) => item.status === 'not_evidenced').slice(0, 2).map((item) => `Add evidence for: ${item.signal}`),
      confidence: (evidence.length >= 2 ? 'medium' : 'low') as Confidence,
    };
  });

  const topStrengths: Strength[] = safePassA.evidence
    .filter((item) => item.signal === 'positive')
    .slice(0, 3)
    .map((item) => ({ text: item.interpretation, evidenceIds: [item.id] }));
  const priorityActions = buildActions(session, repository, safePassA, assessments);
  const feedback = InterviewFeedbackSchema.parse({
    schemaVersion: 1,
    interviewId: session.id,
    rubricVersion: 'answer-eval-v1',
    evaluatedAt: at.toISOString(),
    evaluator: { kind: 'deterministic', model: null, fallbackUsed: false, notes: ['Technical correctness requires model or human review.'] },
    evidence: safePassA.evidence,
    signalCoverage: safePassA.signalCoverage,
    questionObservations: safePassA.observations,
    assessments,
    competencyAssessments,
    overallScore,
    coverage,
    overallConfidence,
    summary:
      overallScore === null
        ? `Evidence coverage was ${Math.round(coverage * 100)}%, so no overall score was computed. Review the per-dimension observations and retry prompts.`
        : `This practice interview produced an overall evidence-based score of ${overallScore}/5 with ${Math.round(coverage * 100)}% dimension coverage.`,
    topStrengths,
    priorityActions,
    caveats: [
      'Practice feedback only, not a hiring assessment or prediction of job readiness.',
      'Missing evidence is not proof of missing knowledge, and the deterministic evaluator does not verify technical correctness.',
      ...(validated.rejected.length ? [`${validated.rejected.length} unsupported evidence item(s) were discarded.`] : []),
      'Accent, pronunciation, personality, and protected traits are not assessed.',
    ],
  });
  const dangling = findDanglingReferences(feedback, session.transcript);
  if (dangling.length > 0) throw new Error(`Invalid feedback references: ${dangling.join('; ')}`);
  return feedback;
}

export const ALL_DIMENSIONS: readonly DimensionId[] = DIMENSION_IDS;

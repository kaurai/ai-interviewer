import { z } from 'zod';
import { CompetencyIdSchema, QuestionIdSchema } from './schemas';
import type { TranscriptTurn } from './interview';

/**
 * Evaluation schemas (CONTEXT.md 5.5 and 9; rubric answer-eval-v1 from
 * .claude/skills/evaluate-interview-answer/references/). The app validates
 * every evaluator output against these, deterministic or model-generated.
 */

export const RUBRIC_VERSION = 'answer-eval-v1';

/** 12 core dimensions in rubric order, then gated delivery. */
export const CORE_DIMENSION_IDS = [
  'technical_accuracy',
  'relevance',
  'completeness',
  'depth',
  'reasoning_tradeoffs',
  'structure',
  'clarity',
  'concision',
  'communication',
  'examples_evidence',
  'seniority_alignment',
  'confidence_calibration',
] as const;
export const DIMENSION_IDS = [...CORE_DIMENSION_IDS, 'delivery'] as const;
export const DimensionIdSchema = z.enum(DIMENSION_IDS);
export type DimensionId = z.infer<typeof DimensionIdSchema>;

export const DIMENSION_LABELS: Readonly<Record<DimensionId, string>> = {
  technical_accuracy: 'Technical accuracy',
  relevance: 'Relevance',
  completeness: 'Completeness',
  depth: 'Depth',
  reasoning_tradeoffs: 'Reasoning and tradeoffs',
  structure: 'Structure',
  clarity: 'Clarity',
  concision: 'Concision',
  communication: 'Communication',
  examples_evidence: 'Examples and evidence',
  seniority_alignment: 'Seniority alignment',
  confidence_calibration: 'Confidence calibration',
  delivery: 'Delivery (time budget only)',
};

export const NOT_ASSESSED_REASONS = [
  'no_evidence',
  'no_opportunity',
  'answer_too_short',
  'no_usable_answer',
  'skipped',
  'seniority_not_supplied',
  'no_delivery_data',
  'delivery_opted_out',
  /** The deterministic evaluator cannot verify this; a reviewer or model must. */
  'needs_model_review',
] as const;
export const NotAssessedReasonSchema = z.enum(NOT_ASSESSED_REASONS);
export type NotAssessedReason = z.infer<typeof NotAssessedReasonSchema>;

export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ScoreSchema = z.literal([1, 2, 3, 4, 5]);
export type Score = z.infer<typeof ScoreSchema>;

const evidenceId = z.string().regex(/^e\d{1,4}$/, 'must look like e1');
const shortText = z.string().min(1).max(400);

// --- Pass A ----------------------------------------------------------------------

export const EvidenceSchema = z.strictObject({
  id: evidenceId,
  questionId: QuestionIdSchema,
  competencyId: CompetencyIdSchema.nullable(),
  dimensionIds: z.array(DimensionIdSchema).min(1),
  /** Candidate turns only. */
  turnIds: z.array(z.string()).min(1),
  /** Exact substring of a cited candidate turn. */
  quote: z.string().min(1).max(600),
  interpretation: shortText,
  signal: z.enum(['positive', 'negative', 'neutral']),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const SignalStatusSchema = z.enum(['demonstrated', 'partial', 'not_evidenced', 'contradicted']);
export type SignalStatus = z.infer<typeof SignalStatusSchema>;

export const SignalCoverageSchema = z
  .strictObject({
    questionId: QuestionIdSchema,
    signalIndex: z.number().int().min(0),
    signal: z.string().min(1).max(400),
    status: SignalStatusSchema,
    evidenceIds: z.array(evidenceId),
  })
  .superRefine((item, ctx) => {
    if (item.status !== 'not_evidenced' && item.evidenceIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['evidenceIds'], message: `${item.status} requires evidence` });
    }
  });
export type SignalCoverage = z.infer<typeof SignalCoverageSchema>;

// --- Pass B ----------------------------------------------------------------------

export const DimensionAssessmentSchema = z
  .strictObject({
    dimensionId: DimensionIdSchema,
    score: ScoreSchema.nullable(),
    evidenceIds: z.array(evidenceId),
    /** What the non-null score rests on. */
    basis: z.enum(['evidence', 'signal-coverage', 'timing-metadata']).nullable(),
    rationale: z.string().max(400).nullable(),
    notAssessedReason: NotAssessedReasonSchema.nullable(),
    confidence: ConfidenceSchema,
  })
  .superRefine((a, ctx) => {
    if (a.score === null) {
      if (a.notAssessedReason === null) ctx.addIssue({ code: 'custom', path: ['notAssessedReason'], message: 'null score needs a reason' });
      return;
    }
    if (a.notAssessedReason !== null) ctx.addIssue({ code: 'custom', path: ['notAssessedReason'], message: 'scored dimension cannot have a not-assessed reason' });
    if (a.basis === null) ctx.addIssue({ code: 'custom', path: ['basis'], message: 'scored dimension needs a basis' });
    if (a.basis === 'evidence' && a.evidenceIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['evidenceIds'], message: 'evidence-based score must cite evidence' });
    }
    if (a.basis === 'signal-coverage' && a.dimensionId !== 'completeness') {
      ctx.addIssue({ code: 'custom', path: ['basis'], message: 'only completeness may rest on signal coverage' });
    }
    if (a.basis === 'timing-metadata' && a.dimensionId !== 'delivery') {
      ctx.addIssue({ code: 'custom', path: ['basis'], message: 'only delivery may rest on timing metadata' });
    }
  });
export type DimensionAssessment = z.infer<typeof DimensionAssessmentSchema>;

/** CONTEXT.md 5.5 CompetencyAssessment. */
export const CompetencyAssessmentSchema = z.strictObject({
  competencyId: CompetencyIdSchema,
  score: ScoreSchema.nullable(),
  evidenceIds: z.array(evidenceId),
  strengths: z.array(z.string().max(300)).max(3),
  improvements: z.array(z.string().max(300)).max(3),
  confidence: ConfidenceSchema,
});
export type CompetencyAssessment = z.infer<typeof CompetencyAssessmentSchema>;

export const QuestionObservationSchema = z.strictObject({
  questionId: QuestionIdSchema,
  questionText: z.string().max(1000),
  status: z.enum(['answered', 'skipped', 'silence', 'not_reached']),
  candidateTurnIds: z.array(z.string()),
  followupAsked: z.boolean(),
  signalsDemonstrated: z.number().int().min(0),
  signalsPartial: z.number().int().min(0),
  signalsTotal: z.number().int().min(0),
  observations: z.array(z.string().max(300)).max(6),
});
export type QuestionObservation = z.infer<typeof QuestionObservationSchema>;

// --- Pass C ----------------------------------------------------------------------

export const StrengthSchema = z.strictObject({
  text: shortText,
  evidenceIds: z.array(evidenceId).min(1),
});
export type Strength = z.infer<typeof StrengthSchema>;

/** CONTEXT.md PracticeAction plus the output contract's priority and retry prompt. */
export const PracticeActionSchema = z.strictObject({
  priority: z.number().int().min(1).max(3),
  dimensionId: DimensionIdSchema,
  competencyId: CompetencyIdSchema.nullable(),
  issue: shortText,
  evidenceIds: z.array(evidenceId),
  whyItMatters: shortText,
  action: shortText,
  /** Standalone, 10-20 minutes. */
  exercise: shortText,
  /** Countable or checkable. */
  successCriteria: shortText,
  retryPrompt: shortText,
  relatedTurnIds: z.array(z.string()).min(1),
});
export type PracticeAction = z.infer<typeof PracticeActionSchema>;

export const EvaluatorInfoSchema = z.strictObject({
  kind: z.enum(['deterministic', 'ollama']),
  model: z.string().max(80).nullable(),
  /** The model was requested but the deterministic coaching was used. */
  fallbackUsed: z.boolean(),
  notes: z.array(z.string().max(200)).max(5),
});
export type EvaluatorInfo = z.infer<typeof EvaluatorInfoSchema>;

export const InterviewFeedbackSchema = z.strictObject({
  schemaVersion: z.literal(1),
  interviewId: z.string(),
  rubricVersion: z.literal(RUBRIC_VERSION),
  evaluatedAt: z.iso.datetime({ offset: true }),
  evaluator: EvaluatorInfoSchema,
  evidence: z.array(EvidenceSchema),
  signalCoverage: z.array(SignalCoverageSchema),
  questionObservations: z.array(QuestionObservationSchema),
  /** Exactly one per dimension, rubric order, delivery last. */
  assessments: z.array(DimensionAssessmentSchema).length(DIMENSION_IDS.length),
  competencyAssessments: z.array(CompetencyAssessmentSchema),
  overallScore: z.number().min(1).max(5).nullable(),
  coverage: z.number().min(0).max(1),
  overallConfidence: ConfidenceSchema,
  summary: z.string().min(1).max(800),
  topStrengths: z.array(StrengthSchema).max(3),
  priorityActions: z.array(PracticeActionSchema).max(3),
  caveats: z.array(z.string().max(400)).min(1),
});
export type InterviewFeedback = z.infer<typeof InterviewFeedbackSchema>;

// --- Validators --------------------------------------------------------------------

export type EvidenceIssue = { evidenceId: string; problem: string };

/** Collapse runs of whitespace; the only normalization quotes are allowed. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** True when `quote` occurs in `text`, exactly or after whitespace normalization. */
export function isExactQuote(quote: string, text: string): boolean {
  if (quote.trim() === '') return false;
  return text.includes(quote) || normalizeWhitespace(text).includes(normalizeWhitespace(quote));
}

/**
 * Pass A validator (CONTEXT.md 9.1): every turn ID exists and belongs to a
 * candidate, and every quote is an exact substring of at least one cited turn.
 * Returns the valid items and a list of rejected ones; never repairs silently.
 */
export function validateEvidence(
  evidence: readonly Evidence[],
  transcript: readonly TranscriptTurn[],
): { valid: Evidence[]; rejected: EvidenceIssue[] } {
  const turns = new Map(transcript.map((t) => [t.id, t]));
  const valid: Evidence[] = [];
  const rejected: EvidenceIssue[] = [];
  const seenIds = new Set<string>();
  for (const item of evidence) {
    const parsed = EvidenceSchema.safeParse(item);
    if (!parsed.success) {
      rejected.push({ evidenceId: String(item?.id), problem: 'does not match the evidence schema' });
      continue;
    }
    if (seenIds.has(item.id)) {
      rejected.push({ evidenceId: item.id, problem: 'duplicate evidence ID' });
      continue;
    }
    const cited = item.turnIds.map((id) => turns.get(id));
    const unknown = item.turnIds.filter((_, i) => cited[i] === undefined);
    if (unknown.length > 0) {
      rejected.push({ evidenceId: item.id, problem: `unknown turn ID ${unknown.join(', ')}` });
      continue;
    }
    if (cited.some((t) => t!.speaker !== 'candidate' || t!.kind !== 'answer')) {
      rejected.push({ evidenceId: item.id, problem: 'cites a turn that is not a candidate answer' });
      continue;
    }
    if (!cited.some((t) => isExactQuote(item.quote, t!.text))) {
      rejected.push({ evidenceId: item.id, problem: 'quote is not an exact substring of a cited turn' });
      continue;
    }
    seenIds.add(item.id);
    valid.push(item);
  }
  return { valid, rejected };
}

/**
 * Cross-reference check for a complete report: every cited evidence and turn
 * ID must be defined in the same report or transcript.
 */
export function findDanglingReferences(feedback: InterviewFeedback, transcript: readonly TranscriptTurn[]): string[] {
  const evidenceIds = new Set(feedback.evidence.map((e) => e.id));
  const candidateTurnIds = new Set(transcript.filter((t) => t.speaker === 'candidate').map((t) => t.id));
  const problems: string[] = [];
  const checkEvidence = (ids: readonly string[], where: string) => {
    for (const id of ids) if (!evidenceIds.has(id)) problems.push(`${where} cites unknown evidence ${id}`);
  };
  feedback.signalCoverage.forEach((s, i) => checkEvidence(s.evidenceIds, `signalCoverage[${i}]`));
  feedback.assessments.forEach((a) => checkEvidence(a.evidenceIds, `assessment ${a.dimensionId}`));
  feedback.competencyAssessments.forEach((a) => checkEvidence(a.evidenceIds, `competency ${a.competencyId}`));
  feedback.topStrengths.forEach((s, i) => checkEvidence(s.evidenceIds, `topStrengths[${i}]`));
  feedback.priorityActions.forEach((a, i) => {
    checkEvidence(a.evidenceIds, `priorityActions[${i}]`);
    for (const t of a.relatedTurnIds) if (!candidateTurnIds.has(t)) problems.push(`priorityActions[${i}] cites non-candidate turn ${t}`);
  });
  return problems;
}

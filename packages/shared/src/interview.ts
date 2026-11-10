import { z } from 'zod';
import {
  CandidateProfileSchema,
  CompetencyIdSchema,
  QuestionIdSchema,
  QuestionTypeSchema,
  RoleSchema,
  SenioritySchema,
} from './schemas';

/**
 * Interview pipeline schemas (CONTEXT.md 5.1, 5.3, 5.4).
 *
 * Zod is the runtime source of truth: the CLI, the domain service, the session
 * store, and the tests all parse through these. Do not add parallel types.
 */

const nonBlank = z.string().regex(/\S/, 'must not be blank');
const isoDateTime = z.iso.datetime({ offset: true });

/** Generated session IDs: `iv_` + 24 lowercase hex characters. Never user text. */
export const SESSION_ID_PATTERN = /^iv_[a-f0-9]{24}$/;
export const SessionIdSchema = z.string().regex(SESSION_ID_PATTERN, 'must look like iv_<24 hex characters>');

/** Client turn IDs make retries idempotent. Opaque, short, URL-safe. */
export const ClientTurnIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be 1-64 URL-safe characters');

// --- Derived resume profile ----------------------------------------------------

export const RESUME_SOURCE_KINDS = ['text', 'markdown', 'pdf', 'docx'] as const;
export const ResumeSourceKindSchema = z.enum(RESUME_SOURCE_KINDS);
export type ResumeSourceKind = z.infer<typeof ResumeSourceKindSchema>;

const boundedTerm = z.string().trim().min(1).max(60);

/**
 * Bounded, job-relevant signals derived from a resume. This is the ONLY resume
 * data that may be persisted: no raw text, file name, path, contact details,
 * or demographic information. Every list is built from an allowlist.
 */
export const ResumeProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sourceKind: ResumeSourceKindSchema,
  /** Characters of extracted text that were analyzed (after limits). */
  analyzedChars: z.number().int().min(0),
  truncated: z.boolean(),
  skills: z.array(boundedTerm).max(30),
  titles: z.array(boundedTerm).max(5),
  domains: z.array(boundedTerm).max(10),
  /** Only when the resume states years explicitly, e.g. "6 years of experience". */
  explicitYearsExperience: z.number().int().min(0).max(60).nullable(),
  inferredRole: RoleSchema.nullable(),
  inferredSeniority: SenioritySchema.nullable(),
  /** Neutral summary generated from the fields above, never copied text. */
  summary: z.string().max(400),
  /** Count only: instruction-like lines were found and ignored. */
  ignoredInstructionLikeLines: z.number().int().min(0),
  warnings: z.array(z.string().max(200)).max(10),
});
export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;

// --- Budget and plan -------------------------------------------------------------

export const InterviewBudgetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('questions'), count: z.number().int().min(1).max(6) }),
  z.strictObject({ kind: z.literal('duration'), minutes: z.number().int().min(2).max(15) }),
]);
export type InterviewBudget = z.infer<typeof InterviewBudgetSchema>;

export const PlanStageSchema = z.strictObject({
  id: nonBlank,
  label: nonBlank,
  questionTypes: z.array(QuestionTypeSchema).min(1),
  targetQuestionCount: z.number().int().min(1),
  targetMinutes: z.number().positive(),
  competencyIds: z.array(CompetencyIdSchema),
});
export type PlanStage = z.infer<typeof PlanStageSchema>;

/** Why one question was chosen. Shown only in the final report. */
export const QuestionSelectionSchema = z.strictObject({
  questionId: QuestionIdSchema,
  stageId: nonBlank,
  rank: z.number().int().min(1),
  score: z.number(),
  pool: z.enum(['primary', 'fallback']),
  competencyIds: z.array(CompetencyIdSchema).min(1),
  questionType: QuestionTypeSchema,
  topic: nonBlank,
  reasons: z.array(z.string().max(300)).max(12),
  /** Resume-derived terms that matched this question's vocabulary. */
  resumeTermsMatched: z.array(z.string().max(60)).max(20),
});
export type QuestionSelection = z.infer<typeof QuestionSelectionSchema>;

export const InterviewPlanSchema = z.strictObject({
  createdAt: isoDateTime,
  budget: InterviewBudgetSchema,
  /** Soft time budget used for follow-up and close decisions. */
  budgetSeconds: z.number().int().positive(),
  maxFollowupsPerQuestion: z.number().int().min(0).max(1),
  targetCompetencies: z.array(
    z.strictObject({ id: CompetencyIdSchema, weight: z.number().positive(), minimumEvidenceTurns: z.number().int().min(1) }),
  ),
  stages: z.array(PlanStageSchema).min(1),
  /** Main questions in order. Every ID exists in the validated bank. */
  candidateQuestionIds: z.array(QuestionIdSchema).min(1),
  currentStageIndex: z.number().int().min(0),
  selections: z.array(QuestionSelectionSchema),
  /** Tokenized only; derived from focus areas and resume signals. */
  queryText: z.string().max(5000),
  resumeUsed: z.boolean(),
});
export type InterviewPlan = z.infer<typeof InterviewPlanSchema>;

// --- Transcript ------------------------------------------------------------------

export const TurnKindSchema = z.enum(['question', 'follow_up', 'answer', 'skip', 'silence', 'closing']);
export type TurnKind = z.infer<typeof TurnKindSchema>;

export const SttTurnMetaSchema = z.strictObject({
  provider: z.string().max(40),
  fallbackUsed: z.boolean(),
  fallbackReason: z.string().max(40).nullable(),
  /** The candidate changed the draft before committing it. */
  edited: z.boolean(),
});
export type SttTurnMeta = z.infer<typeof SttTurnMetaSchema>;

/** Only reliable, measured timing (e.g. a WAV header), never guessed from text. */
export const TurnTimingSchema = z.strictObject({
  audioDurationSeconds: z.number().positive().max(600),
  source: z.enum(['wav-header', 'declared']),
});
export type TurnTiming = z.infer<typeof TurnTimingSchema>;

export const TranscriptTurnSchema = z
  .strictObject({
    id: z.string().regex(/^t\d{2,4}$/, 'must look like t01'),
    sequence: z.number().int().min(1),
    speaker: z.enum(['interviewer', 'candidate']),
    kind: TurnKindSchema,
    /** Main bank question this turn belongs to (also for follow-ups). */
    questionId: QuestionIdSchema.optional(),
    /** Bank follow-up probe that produced or answers this turn. */
    probeId: z.string().max(160).optional(),
    /** Canonical committed text. For candidates this is the corrected transcript. */
    text: z.string().max(8000),
    timestamp: isoDateTime,
    inputMethod: z.enum(['voice', 'text']).optional(),
    clientTurnId: ClientTurnIdSchema.optional(),
    stt: SttTurnMetaSchema.optional(),
    timing: TurnTimingSchema.optional(),
  })
  .superRefine((turn, ctx) => {
    const candidateKinds: TurnKind[] = ['answer', 'skip', 'silence'];
    if ((turn.speaker === 'candidate') !== candidateKinds.includes(turn.kind)) {
      ctx.addIssue({ code: 'custom', path: ['kind'], message: `kind ${turn.kind} does not match speaker ${turn.speaker}` });
    }
  });
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

// --- Turn decision (CONTEXT.md 5.4) ----------------------------------------------

export const TurnDecisionSchema = z.strictObject({
  action: z.enum(['follow_up', 'next_question', 'clarify', 'close']),
  reasonCode: z.enum([
    'missing_signal',
    'strong_answer',
    'off_topic',
    'time_budget',
    'coverage_complete',
    'insufficient_answer',
    'normal_progress',
    'candidate_skipped',
    'candidate_ended',
    'followup_cap',
  ]),
  selectedQuestionId: QuestionIdSchema.optional(),
  probeId: z.string().optional(),
  addressedCompetencyIds: z.array(CompetencyIdSchema),
  confidence: z.number().min(0).max(1),
});
export type TurnDecision = z.infer<typeof TurnDecisionSchema>;

// --- Prompts shown to the candidate ----------------------------------------------

/** Public prompt: spoken text only, never signals, triggers, or anchors. */
export const InterviewerPromptSchema = z.strictObject({
  kind: z.enum(['question', 'follow_up', 'closing']),
  turnId: z.string(),
  questionId: QuestionIdSchema.optional(),
  text: nonBlank,
  /** 1-based main-question number and total planned. */
  questionNumber: z.number().int().min(0),
  totalQuestions: z.number().int().min(0),
});
export type InterviewerPrompt = z.infer<typeof InterviewerPromptSchema>;

export const TurnOutcomeSchema = z.strictObject({
  clientTurnId: ClientTurnIdSchema,
  /** SHA-256 of the request content; a reused ID with different content is rejected. */
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  candidateTurnId: z.string(),
  decision: TurnDecisionSchema,
  next: InterviewerPromptSchema,
});
export type TurnOutcome = z.infer<typeof TurnOutcomeSchema>;

// --- Session ---------------------------------------------------------------------

export const SessionStatusSchema = z.enum([
  'created',
  'planning',
  'asking',
  'awaiting_answer',
  'deciding',
  'closing',
  'evaluating',
  'completed',
  'cancelled',
  'failed',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const ProviderInfoSchema = z.strictObject({
  answerMode: z.enum(['text', 'voice']),
  stt: z.array(z.string().max(40)),
  tts: z.string().max(40),
  evaluator: z.string().max(80),
});
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

export const InterviewSessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: SessionIdSchema,
  status: SessionStatusSchema,
  profile: CandidateProfileSchema,
  /** Derived professional signals only; null when no resume was used. */
  resume: ResumeProfileSchema.nullable(),
  plan: InterviewPlanSchema,
  transcript: z.array(TranscriptTurnSchema),
  askedQuestionIds: z.array(QuestionIdSchema),
  followupCountByQuestion: z.record(z.string(), z.number().int().min(0)),
  currentQuestionId: QuestionIdSchema.nullable(),
  /** Index into plan.candidateQuestionIds of the current main question. */
  currentQuestionIndex: z.number().int().min(0),
  /** Interviewer turn that is awaiting an answer, or null when closed. */
  pendingPromptTurnId: z.string().nullable(),
  turnOutcomes: z.record(z.string(), TurnOutcomeSchema),
  providers: ProviderInfoSchema,
  startedAt: isoDateTime,
  endedAt: isoDateTime.nullable(),
  endReason: z.enum(['completed_plan', 'time_budget', 'candidate_ended']).nullable(),
});
export type InterviewSession = z.infer<typeof InterviewSessionSchema>;

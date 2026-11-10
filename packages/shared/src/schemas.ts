import { z } from 'zod';
import { COMPETENCY_IDS } from './competencies';

/**
 * Zod schemas are the runtime source of truth (CONTEXT.md section 5).
 * TypeScript types are derived from them; do not declare parallel types.
 */

const nonBlank = z.string().regex(/\S/, 'must not be blank');
const kebabSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case');

/**
 * The interview assesses AI skills only. Each role is an AI interview track;
 * `ai-problem-solving` is the shared fallback pool for every track.
 */
export const RoleSchema = z.enum(['ai-fundamentals', 'ai-engineering', 'ai-evaluation', 'ai-problem-solving']);
export type Role = z.infer<typeof RoleSchema>;
export const ROLES = RoleSchema.options;

export const SenioritySchema = z.enum(['junior', 'mid', 'senior']);
export type Seniority = z.infer<typeof SenioritySchema>;
export const SENIORITIES = SenioritySchema.options;

export const QuestionTypeSchema = z.enum(['technical', 'system-design', 'behavioral', 'situational']);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const DifficultySchema = z.literal([1, 2, 3, 4, 5]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const CompetencyIdSchema = z.enum(COMPETENCY_IDS);
export type CompetencyId = z.infer<typeof CompetencyIdSchema>;

// --- 5.1 Candidate profile -------------------------------------------------

export const CandidateProfileSchema = z.strictObject({
  role: RoleSchema,
  seniority: SenioritySchema,
  focusAreas: z.array(z.string().trim().min(1).max(80)).max(10),
  yearsExperience: z.number().min(0).max(60).optional(),
  contextSummary: z.string().max(2000).optional(),
  jobDescription: z.string().max(5000).optional(),
  durationMinutes: z.literal([5, 10, 15]),
  mode: z.enum(['voice', 'text']),
});
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;

// --- 5.2 Interview question bank -------------------------------------------

/** Question IDs are stable snake_case slugs, e.g. `ai_eval_rag_support_bot_01`. */
export const QuestionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'must be a snake_case slug such as ai_eval_rag_support_bot_01');

/** Probe IDs are `<questionId>.<kebab-slug>`, e.g. `ai_eval_rag_support_bot_01.judge-agreement`. */
export const ProbeIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'must be <questionId>.<kebab-slug>',
  );

export const FollowupProbeSchema = z.strictObject({
  id: ProbeIdSchema,
  /** Private: the missing concept or strong signal that makes this probe useful. */
  trigger: nonBlank,
  question: nonBlank,
});
export type FollowupProbe = z.infer<typeof FollowupProbeSchema>;

export const ScoringAnchorLevelSchema = z.enum(['1', '2', '3', '4', '5']);
export type ScoringAnchorLevel = z.infer<typeof ScoringAnchorLevelSchema>;

export const ScoringAnchorsSchema = z.strictObject({
  '1': nonBlank.optional(),
  '2': nonBlank.optional(),
  '3': nonBlank.optional(),
  '4': nonBlank.optional(),
  '5': nonBlank.optional(),
});
export type ScoringAnchors = z.infer<typeof ScoringAnchorsSchema>;

export const QuestionSourceSchema = z
  .strictObject({
    kind: z.enum(['original', 'licensed', 'user-supplied']),
    url: z.url().optional(),
    title: nonBlank,
    license: nonBlank.optional(),
    attribution: nonBlank.optional(),
    retrievedAt: z.iso.date().optional(),
  })
  .superRefine((source, ctx) => {
    if (source.kind === 'original') {
      // Original records must not carry invented external provenance.
      for (const field of ['url', 'license', 'attribution', 'retrievedAt'] as const) {
        if (source[field] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `original sources must not declare ${field}`,
          });
        }
      }
    }
    if (source.kind === 'licensed') {
      for (const field of ['url', 'license', 'retrievedAt'] as const) {
        if (source[field] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `licensed sources must declare ${field}`,
          });
        }
      }
    }
  });
export type QuestionSource = z.infer<typeof QuestionSourceSchema>;

export const InterviewQuestionSchema = z.strictObject({
  id: QuestionIdSchema,
  schemaVersion: z.literal(1),
  roles: z.array(RoleSchema).min(1),
  seniorities: z.array(SenioritySchema).min(1),
  type: QuestionTypeSchema,
  topic: kebabSlug,
  tags: z.array(kebabSlug).min(1),
  difficulty: DifficultySchema,
  competencyIds: z.array(CompetencyIdSchema).min(1),
  /** Spoken aloud to the candidate. */
  question: nonBlank,
  /** What the question should assess. */
  intent: nonBlank,
  /** Private: never shown in the UI during an interview. */
  expectedSignals: z.array(nonBlank).min(1),
  /** Private prompts for investigation; never automatic penalties. */
  redFlags: z.array(nonBlank).optional(),
  followupProbes: z.array(FollowupProbeSchema).min(1).max(3),
  /** Private, question-specific rubric anchors. */
  scoringAnchors: ScoringAnchorsSchema.optional(),
  source: QuestionSourceSchema,
});
export type InterviewQuestion = z.infer<typeof InterviewQuestionSchema>;

import { createHash } from 'node:crypto';
import {
  CandidateProfileSchema,
  InterviewSessionSchema,
  type InterviewBudget,
  type InterviewSession,
  type InterviewerPrompt,
  type ProviderInfo,
  type ResumeProfile,
  type SttTurnMeta,
  type TranscriptTurn,
  type TurnOutcome,
  type TurnTiming,
} from '@ai-interviewer/shared';
import type { QuestionRepository } from '../../data/questionRepository';
import { createKeyedQueue, newSessionId, type SessionStore } from '../../data/sessionStore';
import { splitSentences, type AnswerUnit } from '../answerText';
import { buildInterviewPlan } from './planner';
import { decideFollowUp } from './followUp';

export class InterviewStateError extends Error {
  override readonly name = 'InterviewStateError';
}

export class TurnConflictError extends Error {
  override readonly name = 'TurnConflictError';
}

export interface CreateInterviewInput {
  profile: unknown;
  resume: ResumeProfile | null;
  budget: InterviewBudget;
  providers: ProviderInfo;
}

export interface SubmitAnswerInput {
  clientTurnId: string;
  text: string;
  inputMethod: 'voice' | 'text';
  stt?: SttTurnMeta;
  timing?: TurnTiming;
}

export interface CreatedInterview {
  session: InterviewSession;
  prompt: InterviewerPrompt;
}

export interface InterviewService {
  create(input: CreateInterviewInput): Promise<CreatedInterview>;
  submit(sessionId: string, input: SubmitAnswerInput): Promise<{ session: InterviewSession; outcome: TurnOutcome }>;
  end(sessionId: string, reason?: 'candidate_ended' | 'time_budget'): Promise<InterviewSession>;
  get(sessionId: string): Promise<InterviewSession>;
}

const turnId = (session: InterviewSession): string => `t${String(session.transcript.length + 1).padStart(2, '0')}`;

function appendTurn(session: InterviewSession, turn: Omit<TranscriptTurn, 'id' | 'sequence' | 'timestamp'>, now: Date): TranscriptTurn {
  const complete = {
    ...turn,
    id: turnId(session),
    sequence: session.transcript.length + 1,
    timestamp: now.toISOString(),
  } as TranscriptTurn;
  session.transcript.push(complete);
  return complete;
}

function publicPrompt(session: InterviewSession, turn: TranscriptTurn): InterviewerPrompt {
  return {
    kind: turn.kind === 'follow_up' ? 'follow_up' : turn.kind === 'closing' ? 'closing' : 'question',
    turnId: turn.id,
    ...(turn.questionId ? { questionId: turn.questionId } : {}),
    text: turn.text,
    questionNumber: session.currentQuestionId === null ? session.plan.candidateQuestionIds.length : session.currentQuestionIndex + 1,
    totalQuestions: session.plan.candidateQuestionIds.length,
  };
}

function fingerprint(input: SubmitAnswerInput): string {
  return createHash('sha256')
    .update(JSON.stringify({ text: input.text, inputMethod: input.inputMethod, stt: input.stt ?? null, timing: input.timing ?? null }))
    .digest('hex');
}

function answersFor(session: InterviewSession, questionId: string): AnswerUnit[] {
  return session.transcript
    .filter((turn) => turn.speaker === 'candidate' && turn.kind === 'answer' && turn.questionId === questionId)
    .map((turn) => ({ turnId: turn.id, sentences: splitSentences(turn.text) }));
}

export function createInterviewService(options: {
  repository: QuestionRepository;
  store: SessionStore;
  maxFollowupsPerQuestion: 0 | 1;
  now?: () => Date;
}): InterviewService {
  const { repository, store } = options;
  const now = options.now ?? (() => new Date());
  const enqueue = createKeyedQueue();

  const addMainQuestion = (session: InterviewSession, at: Date): InterviewerPrompt => {
    const questionId = session.plan.candidateQuestionIds[session.currentQuestionIndex];
    if (!questionId) throw new InterviewStateError('Interview plan has no question at the current position.');
    const question = repository.require(questionId);
    session.currentQuestionId = questionId;
    if (!session.askedQuestionIds.includes(questionId)) session.askedQuestionIds.push(questionId);
    session.status = 'awaiting_answer';
    const turn = appendTurn(session, { speaker: 'interviewer', kind: 'question', questionId, text: question.question }, at);
    session.pendingPromptTurnId = turn.id;
    return publicPrompt(session, turn);
  };

  const close = (session: InterviewSession, reason: InterviewSession['endReason'], at: Date): InterviewerPrompt => {
    session.status = 'closing';
    session.currentQuestionId = null;
    session.pendingPromptTurnId = null;
    session.endedAt = at.toISOString();
    session.endReason = reason;
    const turn = appendTurn(session, {
      speaker: 'interviewer',
      kind: 'closing',
      text: 'Thanks. That completes this practice interview. I will prepare your evidence-based feedback now.',
    }, at);
    return publicPrompt(session, turn);
  };

  return {
    async create(input) {
      const profile = CandidateProfileSchema.parse(input.profile);
      const at = now();
      const plan = buildInterviewPlan({
        repository,
        role: profile.role,
        seniority: profile.seniority,
        focusAreas: profile.focusAreas,
        resume: input.resume,
        budget: input.budget,
        maxFollowupsPerQuestion: options.maxFollowupsPerQuestion,
        now: at,
      });
      const session = InterviewSessionSchema.parse({
        schemaVersion: 1,
        id: newSessionId(),
        status: 'asking',
        profile,
        resume: input.resume,
        plan,
        transcript: [],
        askedQuestionIds: [],
        followupCountByQuestion: {},
        currentQuestionId: null,
        currentQuestionIndex: 0,
        pendingPromptTurnId: null,
        turnOutcomes: {},
        providers: input.providers,
        startedAt: at.toISOString(),
        endedAt: null,
        endReason: null,
      });
      const prompt = addMainQuestion(session, at);
      const valid = InterviewSessionSchema.parse(session);
      await store.save(valid);
      return { session: valid, prompt };
    },

    async submit(sessionId, input) {
      return enqueue(sessionId, async () => {
        const session = await store.load(sessionId);
        const requestFingerprint = fingerprint(input);
        const cached = session.turnOutcomes[input.clientTurnId];
        if (cached) {
          if (cached.fingerprint !== requestFingerprint) throw new TurnConflictError('clientTurnId was reused with different answer content.');
          return { session, outcome: cached };
        }
        if (session.status !== 'awaiting_answer' || !session.currentQuestionId || !session.pendingPromptTurnId) {
          throw new InterviewStateError('This interview is not waiting for an answer.');
        }
        const at = now();
        const questionId = session.currentQuestionId;
        const pending = session.transcript.find((turn) => turn.id === session.pendingPromptTurnId);
        if (!pending) throw new InterviewStateError('The pending interviewer prompt is missing.');
        const trimmed = input.text.trim();
        const lower = trimmed.toLowerCase();
        const kind: TranscriptTurn['kind'] = lower === '/skip' || lower === 'skip' ? 'skip' : trimmed === '' ? 'silence' : 'answer';
        const candidate = appendTurn(session, {
          speaker: 'candidate',
          kind,
          questionId,
          ...(pending.probeId ? { probeId: pending.probeId } : {}),
          text: kind === 'skip' ? '[skipped]' : trimmed,
          inputMethod: input.inputMethod,
          clientTurnId: input.clientTurnId,
          ...(input.stt ? { stt: input.stt } : {}),
          ...(input.timing ? { timing: input.timing } : {}),
        }, at);
        session.status = 'deciding';

        let decision: TurnOutcome['decision'];
        let next: InterviewerPrompt;
        const isFollowupAnswer = pending.kind === 'follow_up';
        const elapsedSeconds = Math.max(0, (at.getTime() - new Date(session.startedAt).getTime()) / 1000);
        const remainingSeconds = Math.max(0, session.plan.budgetSeconds - elapsedSeconds);
        const remainingMainQuestions = Math.max(0, session.plan.candidateQuestionIds.length - session.currentQuestionIndex - 1);

        if (kind === 'answer' && !isFollowupAnswer) {
          const question = repository.require(questionId);
          const followup = decideFollowUp({
            question,
            answers: answersFor(session, questionId),
            followupsUsed: session.followupCountByQuestion[questionId] ?? 0,
            maxFollowups: session.plan.maxFollowupsPerQuestion,
            remainingSeconds,
            remainingMainQuestions,
          });
          if (followup.kind === 'follow_up') {
            session.followupCountByQuestion[questionId] = (session.followupCountByQuestion[questionId] ?? 0) + 1;
            const interviewer = appendTurn(session, {
              speaker: 'interviewer', kind: 'follow_up', questionId, probeId: followup.probe.id, text: followup.probe.question,
            }, at);
            session.pendingPromptTurnId = interviewer.id;
            session.status = 'awaiting_answer';
            decision = {
              action: 'follow_up', reasonCode: 'missing_signal', probeId: followup.probe.id,
              addressedCompetencyIds: [...question.competencyIds], confidence: 0.75,
            };
            next = publicPrompt(session, interviewer);
          } else {
            session.currentQuestionIndex += 1;
            if (session.currentQuestionIndex < session.plan.candidateQuestionIds.length && remainingSeconds > 0) {
              next = addMainQuestion(session, at);
              decision = {
                action: 'next_question', reasonCode: followup.reason === 'time_budget' ? 'time_budget' : 'normal_progress',
                selectedQuestionId: next.questionId, addressedCompetencyIds: [...question.competencyIds], confidence: 1,
              };
            } else {
              next = close(session, remainingSeconds <= 0 ? 'time_budget' : 'completed_plan', at);
              decision = { action: 'close', reasonCode: remainingSeconds <= 0 ? 'time_budget' : 'coverage_complete', addressedCompetencyIds: [...question.competencyIds], confidence: 1 };
            }
          }
        } else {
          const question = repository.require(questionId);
          session.currentQuestionIndex += 1;
          if (session.currentQuestionIndex < session.plan.candidateQuestionIds.length && remainingSeconds > 0) {
            next = addMainQuestion(session, at);
            decision = {
              action: 'next_question',
              reasonCode: kind === 'skip' ? 'candidate_skipped' : kind === 'silence' ? 'insufficient_answer' : 'followup_cap',
              selectedQuestionId: next.questionId,
              addressedCompetencyIds: [...question.competencyIds], confidence: 1,
            };
          } else {
            next = close(session, remainingSeconds <= 0 ? 'time_budget' : 'completed_plan', at);
            decision = { action: 'close', reasonCode: remainingSeconds <= 0 ? 'time_budget' : 'coverage_complete', addressedCompetencyIds: [...question.competencyIds], confidence: 1 };
          }
        }

        const outcome: TurnOutcome = {
          clientTurnId: input.clientTurnId,
          fingerprint: requestFingerprint,
          candidateTurnId: candidate.id,
          decision,
          next,
        };
        session.turnOutcomes[input.clientTurnId] = outcome;
        const valid = InterviewSessionSchema.parse(session);
        await store.save(valid);
        return { session: valid, outcome };
      });
    },

    async end(sessionId, reason = 'candidate_ended') {
      return enqueue(sessionId, async () => {
        const session = await store.load(sessionId);
        if (session.endedAt !== null) return session;
        close(session, reason, now());
        const valid = InterviewSessionSchema.parse(session);
        await store.save(valid);
        return valid;
      });
    },

    get: (sessionId) => store.load(sessionId),
  };
}

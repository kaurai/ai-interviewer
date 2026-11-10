import { tokenSimilarity, type FollowupProbe } from '@ai-interviewer/shared';
import type { QuestionRecord } from '../../data/questionRepository';
import { matchSignal, signalTokens, tokensMatch, type AnswerUnit, type SignalMatch } from '../answerText';

/**
 * Level-2 decision after a main answer (CONTEXT.md 8.2), deterministic.
 *
 * Hard rules enforced here:
 *  - at most `maxFollowups` (0 or 1) follow-ups per main question;
 *  - only when a high-value expected signal is missing AND a bank probe
 *    targets it, so the probe ID always exists in the bank;
 *  - only when the remaining time budget allows;
 *  - never a probe that paraphrases the main question.
 */

/** Seconds that must remain (after reserving time for unasked questions) to allow a follow-up. */
export const FOLLOWUP_MIN_REMAINING_SECONDS = 45;
export const RESERVED_SECONDS_PER_REMAINING_QUESTION = 60;
/** Signals listed first in a bank record are treated as the core ones. */
export const HIGH_VALUE_SIGNAL_COUNT = 3;
/** At or above this demonstrated share the answer is strong; no follow-up. */
export const STRONG_ANSWER_RATIO = 0.8;

export type FollowUpDecision =
  | { kind: 'follow_up'; probe: FollowupProbe; targetSignalIndex: number }
  | { kind: 'advance'; reason: 'followup_cap' | 'time_budget' | 'strong_answer' | 'no_matching_probe' | 'insufficient_answer' };

export interface FollowUpInput {
  question: QuestionRecord;
  answers: readonly AnswerUnit[];
  followupsUsed: number;
  maxFollowups: number;
  remainingSeconds: number;
  remainingMainQuestions: number;
}

export function timeAllowsFollowUp(remainingSeconds: number, remainingMainQuestions: number): boolean {
  return remainingSeconds - remainingMainQuestions * RESERVED_SECONDS_PER_REMAINING_QUESTION >= FOLLOWUP_MIN_REMAINING_SECONDS;
}

/** Probes written for strong answers ("strong answer that ...") are extensions, not gap probes. */
function isGapProbe(probe: FollowupProbe): boolean {
  return !/^\s*(?:strong|excellent|complete)\b/i.test(probe.trigger);
}

function overlap(probe: FollowupProbe, signal: string): number {
  const probeTokens = signalTokens(`${probe.trigger} ${probe.question}`);
  return signalTokens(signal).filter((t) => probeTokens.some((p) => tokensMatch(t, p))).length;
}

export function decideFollowUp(input: FollowUpInput): FollowUpDecision {
  const { question } = input;
  if (input.followupsUsed >= input.maxFollowups) return { kind: 'advance', reason: 'followup_cap' };
  if (input.answers.every((a) => a.sentences.length === 0)) return { kind: 'advance', reason: 'insufficient_answer' };
  if (!timeAllowsFollowUp(input.remainingSeconds, input.remainingMainQuestions)) return { kind: 'advance', reason: 'time_budget' };

  const matches: SignalMatch[] = question.expectedSignals.map((s) => matchSignal(s, input.answers));
  const demonstrated = matches.filter((m) => m.status === 'demonstrated').length;
  if (demonstrated / Math.max(1, matches.length) >= STRONG_ANSWER_RATIO) return { kind: 'advance', reason: 'strong_answer' };

  // Missing core signals first (not_evidenced before partial), then bank order.
  const gaps = matches
    .map((m, index) => ({ index, status: m.status }))
    .filter((g) => g.index < HIGH_VALUE_SIGNAL_COUNT && g.status !== 'demonstrated')
    .sort((a, b) => (a.status === b.status ? a.index - b.index : a.status === 'not_evidenced' ? -1 : 1));

  for (const gap of gaps) {
    const signal = question.expectedSignals[gap.index]!;
    let best: { probe: FollowupProbe; score: number } | null = null;
    for (const probe of question.followupProbes) {
      if (!isGapProbe(probe)) continue;
      if (tokenSimilarity(probe.question, question.question) >= 0.5) continue;
      const score = overlap(probe, signal);
      if (score > 0 && (best === null || score > best.score)) best = { probe, score };
    }
    if (best) return { kind: 'follow_up', probe: best.probe, targetSignalIndex: gap.index };
  }
  return { kind: 'advance', reason: 'no_matching_probe' };
}

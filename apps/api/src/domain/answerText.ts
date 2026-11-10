import { contentTokens, tokenSet, type SignalStatus } from '@ai-interviewer/shared';

/**
 * Deterministic answer-text helpers shared by the follow-up policy and the
 * evaluator. Everything here is lexical: it can say "this answer uses the
 * words of an expected signal", never "this answer is correct".
 */

export interface SentenceSpan {
  /** Exact substring of the source text (trimmed), so it is always quotable. */
  text: string;
  start: number;
  end: number;
}

/** Split on sentence punctuation or newlines, keeping exact source offsets. */
export function splitSentences(source: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const pattern = /[^.!?\n]+(?:[.!?]+|$)/g;
  for (const match of source.matchAll(pattern)) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text.length === 0 || !/[A-Za-z0-9]/.test(text)) continue;
    const start = (match.index ?? 0) + leading;
    spans.push({ text, start, end: start + text.length });
  }
  return spans;
}

export function countWordsIn(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Words that describe *how a signal is phrased* in the bank ("mentions",
 * "explains", "such as") rather than its content. Ignored when matching.
 */
const SIGNAL_FILLER = new Set([
  'mention', 'mentions', 'describe', 'describes', 'explain', 'explains', 'identifie', 'identify', 'identifies', 'propose', 'proposes',
  'choose', 'chooses', 'use', 'uses', 'using', 'decide', 'decides', 'consider', 'considers',
  'candidate', 'such', 'clear', 'clearly', 'way', 'thing', 'concrete', 'specific', 'like', 'rather', 'least', 'well', 'whether',
  'make', 'makes', 'name', 'names', 'show', 'shows', 'give', 'gives', 'discusse', 'discuss', 'discusses', 'talk', 'talks',
]);

/** Content tokens of an expected signal, minus phrasing filler. Unique, in order. */
export function signalTokens(signal: string): string[] {
  return [...new Set(contentTokens(signal).filter((t) => !SIGNAL_FILLER.has(t)))];
}

/** Equal tokens, or a shared stem of at least 5 characters ("atomic"/"atomicity"). */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 5 && longer.startsWith(shorter);
}

function matchedTokens(wanted: readonly string[], available: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const token of wanted) {
    for (const candidate of available) {
      if (tokensMatch(token, candidate)) {
        out.push(token);
        break;
      }
    }
  }
  return out;
}

export interface AnswerUnit {
  turnId: string;
  sentences: SentenceSpan[];
}

export interface SignalMatch {
  status: Exclude<SignalStatus, 'contradicted'>;
  /** Fraction of the signal's content tokens found anywhere in the answer. */
  ratio: number;
  matched: string[];
  /** Best supporting sentence, present for demonstrated/partial. */
  best: { turnId: string; quote: string } | null;
}

/** Thresholds are teaching heuristics, not validated constants. */
export const SIGNAL_THRESHOLDS = { demonstratedRatio: 0.5, demonstratedSentenceHits: 2, partialRatio: 0.25 } as const;

/**
 * Lexical signal check. `contradicted` is never produced here: deciding that
 * a claim is wrong needs judgment this matcher does not have. Absence is
 * `not_evidenced`, never "incorrect".
 */
export function matchSignal(signal: string, units: readonly AnswerUnit[]): SignalMatch {
  const wanted = signalTokens(signal);
  if (wanted.length === 0 || units.length === 0) return { status: 'not_evidenced', ratio: 0, matched: [], best: null };

  const allTokens = new Set<string>();
  let best: { turnId: string; quote: string; hits: number } | null = null;
  for (const unit of units) {
    for (const sentence of unit.sentences) {
      const tokens = tokenSet(sentence.text);
      for (const t of tokens) allTokens.add(t);
      const hits = matchedTokens(wanted, tokens).length;
      if (hits > 0 && (best === null || hits > best.hits)) best = { turnId: unit.turnId, quote: sentence.text, hits };
    }
  }
  const matched = matchedTokens(wanted, allTokens);
  const ratio = Math.round((matched.length / wanted.length) * 100) / 100;
  const sentenceHitsNeeded = Math.min(SIGNAL_THRESHOLDS.demonstratedSentenceHits, wanted.length);

  let status: SignalMatch['status'] = 'not_evidenced';
  if (best && ratio >= SIGNAL_THRESHOLDS.demonstratedRatio && best.hits >= sentenceHitsNeeded) status = 'demonstrated';
  else if (best && ratio >= SIGNAL_THRESHOLDS.partialRatio) status = 'partial';
  return { status, ratio, matched, best: status === 'not_evidenced' || !best ? null : { turnId: best.turnId, quote: best.quote } };
}

/** Share of the question's own content words that the answer uses (0..1). */
export function topicalOverlap(answer: string, questionText: string): number {
  const wanted = [...tokenSet(questionText)];
  if (wanted.length === 0) return 0;
  return matchedTokens(wanted, tokenSet(answer)).length / wanted.length;
}

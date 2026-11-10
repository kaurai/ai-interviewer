import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  CandidateProfileSchema,
  InterviewSessionSchema,
  ROLES,
  SENIORITIES,
  type InterviewBudget,
  type InterviewSession,
  type ResumeProfile,
  type Role,
  type Seniority,
} from '@ai-interviewer/shared';
import { loadConfig } from '../../api/src/config';
import { loadQuestionRepository } from '../../api/src/data/questionRepository';
import { createFileSessionStore, createMemorySessionStore, type SessionStore } from '../../api/src/data/sessionStore';
import { evaluateInterview } from '../../api/src/domain/evaluator';
import { createInterviewService } from '../../api/src/domain/interview/service';
import { renderFeedbackJson, renderFeedbackMarkdown } from '../../api/src/domain/report';
import { loadPipelineConfig } from '../../api/src/pipelineConfig';
import { createSttFromConfig } from '../../api/src/providers/stt/factory';
import { loadResumeFile } from '../../api/src/resume/loadResume';
import { extractResumeProfile } from '../../api/src/resume/profile';
import { transcribeAudioFile } from './audioAnswer';
import { createSpeechOutput, type SpeechOutput } from './speech';

export interface CliOptions {
  command: 'run' | 'delete';
  deleteId?: string;
  resume?: string;
  role?: Role;
  seniority?: Seniority;
  focus?: string[];
  years?: number;
  mode?: 'voice' | 'text';
  questions?: number;
  duration?: 5 | 10 | 15;
  noSave: boolean;
  answers?: string;
  tts?: 'none' | 'say' | 'espeak' | 'spd-say';
  yes: boolean;
}

export function usage(): string {
  return [
    'AI Interviewer',
    '',
    'Usage:',
    '  npm run interview -- [--resume FILE] [--role ROLE] [--seniority LEVEL]',
    '    [--focus a,b] [--years N] [--mode text|voice] [--questions 1..6]',
    '    [--duration 5|10|15] [--answers FILE.json] [--tts PROVIDER] [--no-save] [--yes]',
    '  npm run interview -- delete <session-id>',
    '',
    'During an interview: /repeat, /skip, /end, /help.',
    'In voice mode, type /audio <file> [duration-seconds], or type an answer.',
  ].join('\n');
}

function valueAfter(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value after ${args[index]}.`);
  return value;
}

export function parseCliArgs(args: string[]): CliOptions {
  if (args[0] === 'delete') {
    if (!args[1] || args.length !== 2) throw new Error('Usage: npm run interview -- delete <session-id>');
    return { command: 'delete', deleteId: args[1], noSave: false, yes: false };
  }
  const result: CliOptions = { command: 'run', noSave: false, yes: false };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === '--no-save') result.noSave = true;
    else if (flag === '--yes') result.yes = true;
    else if (flag === '--help' || flag === '-h') throw new Error(usage());
    else {
      const value = valueAfter(args, i);
      i += 1;
      switch (flag) {
        case '--resume': result.resume = value; break;
        case '--role':
          if (!ROLES.includes(value as Role)) throw new Error(`--role must be one of: ${ROLES.join(', ')}`);
          result.role = value as Role; break;
        case '--seniority':
          if (!SENIORITIES.includes(value as Seniority)) throw new Error(`--seniority must be one of: ${SENIORITIES.join(', ')}`);
          result.seniority = value as Seniority; break;
        case '--focus': result.focus = value.split(',').map((item) => item.trim()).filter(Boolean); break;
        case '--years': {
          const years = Number(value);
          if (!Number.isFinite(years) || years < 0 || years > 60) throw new Error('--years must be between 0 and 60.');
          result.years = years; break;
        }
        case '--mode':
          if (value !== 'text' && value !== 'voice') throw new Error('--mode must be text or voice.');
          result.mode = value; break;
        case '--questions': {
          const count = Number(value);
          if (!Number.isInteger(count) || count < 1 || count > 6) throw new Error('--questions must be an integer from 1 to 6.');
          result.questions = count; break;
        }
        case '--duration': {
          const minutes = Number(value);
          if (![5, 10, 15].includes(minutes)) throw new Error('--duration must be 5, 10, or 15.');
          result.duration = minutes as 5 | 10 | 15; break;
        }
        case '--answers': result.answers = value; break;
        case '--tts':
          if (!['none', 'say', 'espeak', 'spd-say'].includes(value)) throw new Error('--tts must be none, say, espeak, or spd-say.');
          result.tts = value as CliOptions['tts']; break;
        default: throw new Error(`Unknown option: ${flag}\n\n${usage()}`);
      }
    }
  }
  if (result.questions !== undefined && result.duration !== undefined) {
    throw new Error('Choose either --questions or --duration, not both.');
  }
  return result;
}

interface ConsoleLike {
  log(message?: unknown): void;
  error(message?: unknown): void;
}

export interface RunDeps {
  console?: ConsoleLike;
  readline?: ReadlineInterface;
  now?: () => Date;
  store?: SessionStore;
  speech?: SpeechOutput;
}

async function ask(rl: ReadlineInterface, label: string, fallback?: string): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || fallback || '';
}

async function choose<T extends string>(rl: ReadlineInterface, label: string, values: readonly T[], fallback: T): Promise<T> {
  const answer = await ask(rl, `${label} (${values.join('/')})`, fallback);
  if (!values.includes(answer as T)) throw new Error(`${label} must be one of: ${values.join(', ')}`);
  return answer as T;
}

async function loadScriptedAnswers(filePath: string | undefined): Promise<string[] | null> {
  if (!filePath) return null;
  const absolute = path.resolve(filePath);
  const parsed: unknown = JSON.parse(await readFile(absolute, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('--answers must point to a JSON array of strings.');
  }
  return parsed;
}

async function resumeFrom(options: CliOptions, rl: ReadlineInterface | null, limits: Parameters<typeof loadResumeFile>[1]['limits']): Promise<ResumeProfile | null> {
  const resumePath = options.resume ?? (rl ? await ask(rl, 'Resume path (optional; .txt, .md, .pdf, .docx)') : '');
  if (!resumePath) return null;
  const loaded = await loadResumeFile(resumePath, { limits });
  return extractResumeProfile({
    text: loaded.text,
    sourceKind: loaded.kind,
    truncated: loaded.truncated,
    warnings: loaded.warnings,
  });
}

function printPrompt(log: ConsoleLike['log'], prompt: { kind: string; text: string; questionNumber: number; totalQuestions: number }): void {
  const prefix = prompt.kind === 'follow_up' ? 'Follow-up' : prompt.kind === 'closing' ? 'Interviewer' : `Question ${prompt.questionNumber}/${prompt.totalQuestions}`;
  log(`\n${prefix}: ${prompt.text}`);
}

export async function runCli(options: CliOptions, deps: RunDeps = {}): Promise<{ session?: InterviewSession; exitCode: number }> {
  const terminal = deps.console ?? console;
  const ownsReadline = !deps.readline;
  const scripted = await loadScriptedAnswers(options.answers);
  const interactive = scripted === null;
  const rl = deps.readline ?? (interactive ? createInterface({ input, output }) : null);
  const pipelineConfig = loadPipelineConfig(process.env);
  const store = deps.store ?? (options.noSave ? createMemorySessionStore() : createFileSessionStore(pipelineConfig.interview.sessionsDir));

  try {
    if (options.command === 'delete') {
      const removed = await store.delete(options.deleteId ?? '');
      terminal.log(removed ? `Deleted ${options.deleteId} and its reports.` : `No saved session found for ${options.deleteId}.`);
      return { exitCode: removed ? 0 : 1 };
    }

    terminal.log('AI Interviewer — private practice, not a hiring assessment.');
    terminal.log('Raw resume text and audio are never saved. Corrected answer text is saved unless --no-save is used.');
    if (!options.yes && rl) {
      const consent = (await ask(rl, 'Continue? (yes/no)', 'yes')).toLowerCase();
      if (!['yes', 'y'].includes(consent)) return { exitCode: 0 };
    }

    const resume = await resumeFrom(options, rl, pipelineConfig.resume);
    if (resume) terminal.log(`Resume signals: ${resume.summary || 'no recognized professional signals'}`);

    const role = options.role ?? (rl ? await choose(rl, 'Target role', ROLES, resume?.inferredRole ?? 'backend') : resume?.inferredRole ?? 'backend');
    const seniority = options.seniority ?? (rl ? await choose(rl, 'Seniority', SENIORITIES, resume?.inferredSeniority ?? 'mid') : resume?.inferredSeniority ?? 'mid');
    const focus = options.focus ?? (rl ? (await ask(rl, 'Focus areas, comma-separated (optional)')).split(',').map((v) => v.trim()).filter(Boolean) : []);
    const yearsAnswer = options.years !== undefined
      ? String(options.years)
      : rl
        ? await ask(rl, 'Years of experience (optional)', resume?.explicitYearsExperience?.toString() ?? '')
        : resume?.explicitYearsExperience?.toString() ?? '';
    const years = yearsAnswer === '' ? undefined : Number(yearsAnswer);
    if (years !== undefined && (!Number.isFinite(years) || years < 0 || years > 60)) throw new Error('Years of experience must be between 0 and 60.');
    const mode = options.mode ?? (rl ? await choose(rl, 'Answer mode', ['text', 'voice'] as const, 'text') : 'text');
    let budget: InterviewBudget;
    if (options.questions !== undefined) budget = { kind: 'questions', count: options.questions };
    else if (options.duration !== undefined) budget = { kind: 'duration', minutes: options.duration };
    else if (rl) {
      const kind = await choose(rl, 'Interview budget', ['questions', 'duration'] as const, 'questions');
      if (kind === 'questions') {
        const count = Number(await ask(rl, 'Number of main questions (1-6)', String(pipelineConfig.interview.defaultQuestions)));
        if (!Number.isInteger(count) || count < 1 || count > 6) throw new Error('Question count must be an integer from 1 to 6.');
        budget = { kind, count };
      } else {
        const minutes = Number(await choose(rl, 'Duration in minutes', ['5', '10', '15'] as const, String(pipelineConfig.interview.defaultMinutes) as '5' | '10' | '15'));
        budget = { kind, minutes };
      }
    } else budget = { kind: 'questions', count: pipelineConfig.interview.defaultQuestions };
    const duration = budget.kind === 'duration' ? budget.minutes as 5 | 10 | 15 : 5;

    const profile = CandidateProfileSchema.parse({
      role, seniority, focusAreas: focus, ...(years === undefined ? {} : { yearsExperience: years }),
      durationMinutes: duration, mode,
    });
    const repository = await loadQuestionRepository();
    const service = createInterviewService({
      repository,
      store,
      maxFollowupsPerQuestion: pipelineConfig.interview.maxFollowupsPerQuestion,
      now: deps.now,
    });
    const sttConfig = loadConfig(process.env);
    const stt = createSttFromConfig(sttConfig.stt);
    const speech = deps.speech ?? createSpeechOutput({ ...pipelineConfig.tts, ...(options.tts ? { provider: options.tts } : {}) });
    const providers = {
      answerMode: mode,
      stt: mode === 'voice' ? [...stt.providerIds] : [],
      tts: speech.id,
      evaluator: 'deterministic-answer-eval-v1',
    } as const;
    let { session, prompt } = await service.create({ profile, resume, budget, providers });
    terminal.log(`\nSession ${session.id}${store.persistent ? ` (saved under ${pipelineConfig.interview.sessionsDir})` : ' (memory only)'}`);

    let scriptedIndex = 0;
    while (prompt.kind !== 'closing') {
      printPrompt(terminal.log.bind(terminal), prompt);
      await speech.speak(prompt.text).catch((error) => terminal.error(`TTS unavailable: ${(error as Error).message}`));
      let answer = scripted ? scripted[scriptedIndex++] : await ask(rl!, mode === 'voice' ? 'Answer or /audio <file> [seconds]' : 'Answer');
      if (answer === undefined) answer = '/end';
      if (answer === '/repeat') continue;
      if (answer === '/help') {
        terminal.log('Commands: /repeat, /skip, /end, /help. Voice: /audio <file> [duration-seconds].');
        continue;
      }
      if (answer === '/end') {
        session = await service.end(session.id);
        break;
      }

      let inputMethod: 'voice' | 'text' = 'text';
      let sttMeta: { provider: string; fallbackUsed: boolean; fallbackReason: string | null; edited: boolean } | undefined;
      let timing: { audioDurationSeconds: number; source: 'wav-header' | 'declared' } | undefined;
      if (answer.startsWith('/audio ')) {
        if (mode !== 'voice') throw new Error('/audio is available only in voice mode.');
        const parts = answer.slice('/audio '.length).trim().split(/\s+/);
        const declared = parts.length > 1 ? Number(parts.at(-1)) : undefined;
        const hasDuration = declared !== undefined && Number.isFinite(declared);
        const audioPath = hasDuration ? parts.slice(0, -1).join(' ') : parts.join(' ');
        if (stt.providerIds.includes('elevenlabs')) {
          terminal.log('Privacy: this audio may be sent to ElevenLabs Scribe; audio bytes are not persisted by this app.');
        }
        const transcribed = await transcribeAudioFile({
          filePath: audioPath,
          ...(hasDuration ? { durationSeconds: declared } : {}),
          orchestrator: stt,
          limits: sttConfig.stt.limits,
        });
        answer = transcribed.outcome.result.text;
        inputMethod = 'voice';
        terminal.log(`Draft (${transcribed.outcome.provider}${transcribed.outcome.fallbackUsed ? ` fallback after ${transcribed.outcome.fallbackReason}` : ''}): ${answer}`);
        const corrected = rl ? await ask(rl, 'Press Enter to accept, or type a corrected transcript', answer) : answer;
        sttMeta = {
          provider: transcribed.outcome.provider,
          fallbackUsed: transcribed.outcome.fallbackUsed,
          fallbackReason: transcribed.outcome.fallbackReason,
          edited: corrected !== answer,
        };
        answer = corrected;
        timing = {
          audioDurationSeconds: transcribed.durationSeconds,
          source: path.extname(audioPath).toLowerCase() === '.wav' ? 'wav-header' : 'declared',
        };
      }

      const submitted = await service.submit(session.id, {
        clientTurnId: `cli_${String(scriptedIndex || session.transcript.length).padStart(3, '0')}_${Date.now().toString(36)}`,
        text: answer,
        inputMethod,
        ...(sttMeta ? { stt: sttMeta } : {}),
        ...(timing ? { timing } : {}),
      });
      session = submitted.session;
      prompt = submitted.outcome.next;
    }

    const evaluating = InterviewSessionSchema.parse({ ...session, status: 'evaluating' });
    await store.save(evaluating);
    const feedback = evaluateInterview(evaluating, repository, deps.now?.() ?? new Date());
    const completed = InterviewSessionSchema.parse({ ...evaluating, status: 'completed' });
    await store.save(completed);
    const markdown = renderFeedbackMarkdown(completed, feedback);
    const paths = await store.saveReports(completed.id, { json: renderFeedbackJson(feedback), markdown });
    terminal.log(`\n${markdown}`);
    if (paths) terminal.log(`Reports saved:\n- ${paths.markdownPath}\n- ${paths.jsonPath}`);
    return { session: completed, exitCode: 0 };
  } finally {
    if (ownsReadline) rl?.close();
  }
}

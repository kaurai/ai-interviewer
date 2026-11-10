/**
 * Preflight checks: `npm run doctor`.
 *
 * Currently covers the speech-to-text module and the question bank. Never
 * prints secrets and never calls a paid API. Exits 1 only for blocking
 * problems (unsupported Node, invalid configuration, invalid question bank);
 * missing optional providers are warnings because typed answers still work.
 */
import { existsSync } from 'node:fs';
import { formatDoctorReport, runSttDoctor } from '../apps/api/src/diagnostics/sttDoctor';
import { loadQuestionRepository } from '../apps/api/src/data/questionRepository';
import { loadPipelineConfig } from '../apps/api/src/pipelineConfig';
import { createSpeechOutput } from '../apps/cli/src/speech';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
} else {
  console.log('[INFO] No .env file found; using defaults (copy .env.example to .env to configure).');
}

console.log('AI interviewer preflight\n');

const report = await runSttDoctor({ env: process.env });
console.log(formatDoctorReport(report));

let questionsOk = true;
try {
  const repository = await loadQuestionRepository();
  console.log(`[OK]   ${repository.size} validated seed questions`);
} catch (error) {
  questionsOk = false;
  console.log(`[FAIL] Question bank - ${(error as Error).message.split('\n')[0]}`);
}

let pipelineOk = true;
try {
  const pipeline = loadPipelineConfig(process.env);
  console.log(`[OK]   Interview pipeline - ${pipeline.interview.defaultQuestions} questions, sessions: ${pipeline.interview.sessionsDir}`);
  console.log(`[OK]   Resume parsers - txt/md + PDF (pdf-parse) + DOCX (mammoth), limit ${pipeline.resume.maxMb} MB`);
  const speech = createSpeechOutput(pipeline.tts);
  const readiness = await speech.checkReadiness();
  console.log(`${readiness.ready ? '[OK]  ' : '[WARN]'} TTS ${speech.id} - ${readiness.detail}`);
  if (pipeline.llm.provider === 'ollama') {
    try {
      const response = await fetch(`${pipeline.llm.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      console.log(`${response.ok ? '[OK]  ' : '[WARN]'} Ollama - ${response.ok ? 'local service is reachable' : `HTTP ${response.status}`}`);
    } catch {
      console.log('[WARN] Ollama - local service is not reachable; deterministic evaluation remains available');
    }
  } else {
    console.log('[OK]   Evaluator - deterministic, offline, evidence-grounded');
  }
} catch (error) {
  pipelineOk = false;
  console.log(`[FAIL] Interview pipeline - ${(error as Error).message.split('\n')[0]}`);
}

process.exit(report.passed && questionsOk && pipelineOk ? 0 : 1);

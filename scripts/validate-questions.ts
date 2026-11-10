/**
 * Offline, deterministic question-bank validator.
 *
 *   npm run validate:questions                       # committed seed bank, seed rules on
 *   npm run validate:questions -- path/to/bank.json  # another file
 *   npm run validate:questions -- --no-seed-rules    # skip 60-record/distribution rules
 *
 * Exits 1 with record IDs and reasons when any error or review issue exists.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  NEAR_DUPLICATE_THRESHOLD,
  ROLES,
  SENIORITIES,
  formatIssue,
  validateQuestionBankJson,
} from '@ai-interviewer/shared';
import { DEFAULT_SEED_QUESTIONS_PATH } from '../apps/api/src/data/questionRepository';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'no-seed-rules': { type: 'boolean', default: false } },
});

const filePath = positionals[0] ? path.resolve(positionals[0]) : DEFAULT_SEED_QUESTIONS_PATH;
const seedCorpus = !values['no-seed-rules'];

let text: string;
try {
  text = await readFile(filePath, 'utf8');
} catch (error) {
  console.error(`Cannot read ${filePath}: ${(error as Error).message}`);
  process.exit(1);
}

const result = validateQuestionBankJson(text, { seedCorpus });
const relative = path.relative(process.cwd(), filePath) || filePath;

console.log(`Question bank: ${relative}`);
console.log(`Seed corpus rules: ${seedCorpus ? 'on' : 'off'}; near-duplicate threshold: ${NEAR_DUPLICATE_THRESHOLD}`);
console.log(`Schema-valid records: ${result.stats.total}`);
for (const role of ROLES) {
  const perSeniority = SENIORITIES.map((s) => `${s} ${result.stats.byPrimaryRoleAndSeniority[role][s]}`).join(', ');
  console.log(`  ${role.padEnd(10)} ${String(result.stats.byPrimaryRole[role]).padStart(3)}  (${perSeniority})`);
}

if (result.ok) {
  console.log('\nOK: no validation issues.');
  process.exit(0);
}

const errors = result.issues.filter((i) => i.severity === 'error').length;
const reviews = result.issues.length - errors;
console.error(`\nFAILED: ${errors} error(s), ${reviews} review issue(s)`);
for (const issue of result.issues) console.error(`  ${formatIssue(issue)}`);
process.exit(1);

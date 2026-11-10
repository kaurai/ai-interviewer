/**
 * Developer-only inspection of one record, including PRIVATE criteria.
 *
 *   npm run questions:show -- backend_rate_limiter_01
 *
 * Expected signals, red flags, probe triggers, and anchors are server-side
 * assessment material. Never send this output to the interview UI.
 */
import { loadQuestionRepository, UnknownQuestionError } from '../apps/api/src/data/questionRepository';

const id = process.argv[2];
const repository = await loadQuestionRepository();

if (!id) {
  console.error('Usage: npm run questions:show -- <questionId>\n\nAvailable IDs:');
  for (const q of repository.all()) console.error(`  ${q.id}`);
  process.exit(1);
}

try {
  const q = repository.require(id);
  console.log(`${q.id}  [${q.roles.join(', ')} | ${q.seniorities.join(', ')} | ${q.type} | difficulty ${q.difficulty}]`);
  console.log(`topic: ${q.topic}   tags: ${q.tags.join(', ')}`);
  console.log(`competencies: ${q.competencyIds.join(', ')}`);
  console.log(`\nSpoken question:\n  ${q.question}`);
  console.log(`\nIntent:\n  ${q.intent}`);
  console.log('\n--- PRIVATE (server-side only) ---');
  console.log('Expected signals:');
  for (const s of q.expectedSignals) console.log(`  - ${s}`);
  if (q.redFlags?.length) {
    console.log('Red flags (prompts to investigate, not automatic penalties):');
    for (const s of q.redFlags) console.log(`  - ${s}`);
  }
  console.log('Follow-up probes:');
  for (const p of q.followupProbes) console.log(`  ${p.id}\n    when: ${p.trigger}\n    ask:  ${p.question}`);
  console.log('Scoring anchors:');
  for (const [level, text] of Object.entries(q.scoringAnchors ?? {})) console.log(`  ${level}: ${text}`);
  console.log(`\nSource: ${q.source.kind} — ${q.source.title}`);
} catch (error) {
  if (error instanceof UnknownQuestionError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

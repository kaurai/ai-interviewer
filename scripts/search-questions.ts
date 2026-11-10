/**
 * Run a lexical retrieval query against the committed bank and explain the ranking.
 *
 *   npm run questions:search -- --role ai-evaluation --seniority mid --focus llm-as-judge
 *   npm run questions:search -- --role ai-engineering --seniority senior \
 *     --competency ai.reliability-safety --exclude ai_eng_prompt_injection_01 --top 5
 *   npm run questions:search -- --role ai-fundamentals --seniority junior --json
 *
 * Repeat --focus, --competency, --exclude, and --type as needed.
 */
import { parseArgs } from 'node:util';
import { loadQuestionRepository } from '../apps/api/src/data/questionRepository';
import { retrieveCandidates, type RetrievalQueryInput } from '../apps/api/src/domain/retriever';

const { values } = parseArgs({
  options: {
    role: { type: 'string' },
    seniority: { type: 'string' },
    focus: { type: 'string', multiple: true, default: [] },
    competency: { type: 'string', multiple: true, default: [] },
    exclude: { type: 'string', multiple: true, default: [] },
    type: { type: 'string', multiple: true },
    text: { type: 'string' },
    difficulty: { type: 'string' },
    top: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

if (!values.role || !values.seniority) {
  console.error('Usage: npm run questions:search -- --role <ai-fundamentals|ai-engineering|ai-evaluation|ai-problem-solving> --seniority <junior|mid|senior> [--focus topic] [--competency id] [--exclude id] [--type t] [--text "..."] [--difficulty n] [--top k] [--json]');
  process.exit(1);
}

const query = {
  role: values.role,
  seniority: values.seniority,
  focusAreas: values.focus,
  missingCompetencyIds: values.competency,
  excludeIds: values.exclude,
  ...(values.type ? { questionTypes: values.type } : {}),
  ...(values.text ? { queryText: values.text } : {}),
  ...(values.difficulty ? { targetDifficulty: Number(values.difficulty) } : {}),
  ...(values.top ? { topK: Number(values.top) } : {}),
} as RetrievalQueryInput; // validated by RetrievalQuerySchema inside retrieveCandidates

const repository = await loadQuestionRepository();
const result = (() => {
  try {
    return retrieveCandidates(repository, query);
  } catch (error) {
    console.error(`Invalid query: ${(error as Error).message}`);
    return process.exit(1);
  }
})();

if (values.json) {
  // Omit the full private record; IDs, scores, and factors explain the ranking.
  const { candidates, ...rest } = result;
  console.log(JSON.stringify({ ...rest, candidates: candidates.map(({ question: _q, ...c }) => c) }, null, 2));
  process.exit(0);
}

console.log(`mode: ${result.mode}   primary pool: ${result.primaryPoolSize}   fallback used: ${result.fallbackUsed}`);
for (const e of result.excluded) console.log(`excluded ${e.questionId} (${e.reason}): ${e.detail}`);
if (result.candidates.length === 0) console.log('\nNo candidates matched. Relax the filters or exclusions.');
result.candidates.forEach((c, i) => {
  console.log(`\n#${i + 1}  ${c.questionId}  score ${c.score}  [${c.pool}]`);
  console.log(`    ${c.question.question}`);
  for (const f of c.factors) console.log(`    ${f.points >= 0 ? '+' : ''}${f.points}  ${f.kind}: ${f.detail}`);
});

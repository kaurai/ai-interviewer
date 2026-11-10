import { ResumeProfileSchema, type ResumeProfile, type ResumeSourceKind, type Role, type Seniority } from '@ai-interviewer/shared';

/**
 * Resume -> bounded professional signals.
 *
 * Allowlist extraction only: a term is kept only when it matches one of the
 * curated job-relevant patterns below. Nothing else from the resume survives,
 * so names, contact details, addresses, dates of birth, photos, and
 * demographic or protected information are never extracted, stored, or used.
 *
 * The resume is untrusted data. Lines that look like instructions to an AI
 * ("ignore previous instructions", "score this candidate 5") are counted and
 * ignored; no resume text is ever placed in a prompt or executed.
 *
 * The profile influences question selection only. It never affects scores.
 */

type Lexicon = ReadonlyArray<readonly [canonical: string, pattern: RegExp]>;

/** Technologies and engineering/product practices. Canonical names are lowercase. */
export const SKILL_LEXICON: Lexicon = [
  // languages
  ['typescript', /\btypescript\b/i],
  ['javascript', /\bjavascript\b|\bES20\d\d\b/i],
  ['python', /\bpython\b/i],
  ['java', /\bjava\b(?!\s*script)/i],
  ['kotlin', /\bkotlin\b/i],
  ['go', /\bgolang\b|(?:^|[\s,(/])Go(?=$|[\s,)/;.])/],
  ['rust', /\brust\b/i],
  ['c#', /(?:^|[\s,(/])C#(?=$|[\s,)/;.])/i],
  ['ruby', /\bruby\b/i],
  ['php', /\bphp\b/i],
  ['sql', /\bsql\b/i],
  ['swift', /\bswift\b/i],
  // backend and data
  ['node.js', /\bnode(?:\.?js)?\b/i],
  ['express', /\bexpress(?:\.js)?\b/i],
  ['django', /\bdjango\b/i],
  ['spring', /\bspring(?:\s*boot)?\b/i],
  ['postgresql', /\bpostgres(?:ql)?\b/i],
  ['mysql', /\bmysql\b/i],
  ['mongodb', /\bmongo(?:db)?\b/i],
  ['redis', /\bredis\b/i],
  ['kafka', /\bkafka\b/i],
  ['rabbitmq', /\brabbitmq\b/i],
  ['elasticsearch', /\belastic(?:search)?\b/i],
  ['graphql', /\bgraphql\b/i],
  ['grpc', /\bgrpc\b/i],
  ['rest api', /\brest(?:ful)?\s+api/i],
  ['microservices', /\bmicro-?services?\b/i],
  ['message queues', /\bmessage\s+queues?\b|\bqueues?\b/i],
  // infrastructure
  ['docker', /\bdocker\b/i],
  ['kubernetes', /\bkubernetes\b|\bk8s\b/i],
  ['terraform', /\bterraform\b/i],
  ['aws', /\baws\b|amazon web services/i],
  ['gcp', /\bgcp\b|google cloud/i],
  ['azure', /\bazure\b/i],
  ['ci/cd', /\bci\/cd\b|continuous (?:integration|delivery|deployment)/i],
  ['linux', /\blinux\b/i],
  // frontend
  ['react', /\breact(?:\.js)?\b/i],
  ['vue', /\bvue(?:\.js)?\b/i],
  ['angular', /\bangular\b/i],
  ['next.js', /\bnext\.js\b|\bnextjs\b/i],
  ['css', /\bcss\b/i],
  ['html', /\bhtml5?\b/i],
  ['web components', /\bweb components?\b/i],
  ['state management', /\bredux\b|\bstate management\b|\bzustand\b|\bmobx\b/i],
  // practices
  ['rate limiting', /\brate[- ]limit(?:ing|er|s)?\b|\bthrottling\b/i],
  ['caching', /\bcach(?:e|es|ing)\b|\bcdn\b/i],
  ['distributed systems', /\bdistributed (?:systems?|counters?|locks?)\b/i],
  ['concurrency', /\bconcurren(?:cy|t)\b|\brace conditions?\b|\batomic(?:ity)?\b/i],
  ['idempotency', /\bidempoten(?:t|cy)\b|\bexactly[- ]once\b|\bduplicate (?:jobs?|processing)\b/i],
  ['data modeling', /\bdata model(?:ing|ling)?\b|\bschema design\b|\bdatabase design\b/i],
  ['database migrations', /\b(?:schema|database|online) migrations?\b/i],
  ['observability', /\bobservability\b|\bmonitoring\b|\btracing\b|\bopentelemetry\b|\bprometheus\b|\bgrafana\b/i],
  ['alerting', /\balert(?:s|ing)\b|\bon-?call\b|\bslos?\b/i],
  ['incident response', /\bincidents?\b|\bpostmortems?\b|\bpost-mortems?\b/i],
  ['reliability', /\breliability\b|\bresilien(?:ce|t)\b|\bcircuit breakers?\b|\bretries\b|\btimeouts?\b/i],
  ['security', /\bsecurity\b|\bauthenticat(?:ion|e)\b|\boauth\b|\bauthoriz(?:ation|e)\b|\bmulti-?tenan(?:t|cy)\b/i],
  ['performance', /\bperformance\b|\blatency\b|\bprofiling\b/i],
  ['testing', /\bunit tests?\b|\bintegration tests?\b|\bend-to-end tests?\b|\be2e\b|\btest automation\b|\bjest\b|\bplaywright\b|\bcypress\b|\bvitest\b/i],
  ['accessibility', /\baccessib(?:ility|le)\b|\ba11y\b|\bwcag\b|\bscreen readers?\b|\baria\b/i],
  ['web performance', /\bcore web vitals\b|\bbundle size\b|\blazy[- ]loading\b|\bcode[- ]splitting\b/i],
  ['design systems', /\bdesign systems?\b|\bcomponent librar(?:y|ies)\b/i],
  ['experimentation', /\ba\/b test(?:s|ing)?\b|\bexperiment(?:s|ation)\b/i],
  ['product metrics', /\bmetrics\b|\bkpis?\b|\bretention\b|\bconversion\b|\bfunnels?\b/i],
  ['prioritization', /\bprioriti[sz](?:ation|ed|ing)\b|\broadmaps?\b|\bbacklogs?\b/i],
  ['user research', /\buser research\b|\bcustomer interviews?\b|\bdiscovery\b|\busability\b/i],
  ['stakeholder management', /\bstakeholders?\b/i],
  ['mentoring', /\bmentor(?:ed|ing|s)?\b|\bcoach(?:ed|ing)\b/i],
  ['technical leadership', /\btech(?:nical)? lead\b|\bled (?:a|the) team\b|\barchitecture decisions?\b/i],
];

/** Business domains the candidate has worked in. */
export const DOMAIN_LEXICON: Lexicon = [
  ['payments', /\bpayments?\b|\bbilling\b|\bcheckout\b/i],
  ['e-commerce', /\be-?commerce\b|\bonline retail\b|\bmarketplace\b|\binventory\b|\borders?\b/i],
  ['fintech', /\bfintech\b|\bbanking\b|\blending\b/i],
  ['healthcare technology', /\bhealth ?tech\b|\bhealthcare software\b|\bclinical software\b/i],
  ['education technology', /\bed ?tech\b|\be-?learning\b/i],
  ['saas', /\bsaas\b|\bb2b\b/i],
  ['developer tools', /\bdeveloper tools?\b|\bdev ?tools\b|\bsdks?\b/i],
  ['logistics', /\blogistics\b|\bshipping\b|\bsupply chain\b/i],
  ['media and streaming', /\bstreaming\b|\bvideo platform\b/i],
  ['gaming', /\bgam(?:e|ing) (?:platform|studio|backend)\b/i],
  ['travel', /\btravel\b|\bbookings?\b/i],
  ['analytics', /\banalytics\b|\bdata pipelines?\b|\betl\b/i],
  ['mobile apps', /\bmobile apps?\b|\bios\b|\bandroid\b/i],
  ['search', /\bsearch (?:engine|ranking|relevance)\b/i],
  ['social platforms', /\bsocial (?:network|platform|feed)s?\b/i],
];

const TITLE_PATTERN =
  /\b(?:(junior|associate|mid[- ]level|senior|staff|principal|lead)\s+)?(software|backend|back[- ]end|frontend|front[- ]end|full[- ]stack|platform|data|site reliability|web|mobile|infrastructure|devops|qa|test|product|ui|ux|machine learning)\s+(engineer|developer|manager|designer|architect|owner)\b|\b(engineering manager|tech lead|technical lead|product owner|product manager)\b/gi;

/** Only years explicitly described as experience; never ages or dates. */
const YEARS_PATTERN =
  /\b(\d{1,2})\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:professional\s+|industry\s+|hands-on\s+|software\s+|engineering\s+|product\s+)?experience\b/gi;

const INSTRUCTION_LIKE =
  /\b(?:ignore (?:all |any )?(?:previous|prior|above|earlier) (?:instructions|prompts?)|system prompt|disregard (?:the|all|any)|you are now|act as (?:an?|the)|score (?:me|this|the candidate)|rate (?:me|this|the candidate)|give (?:me|this candidate) (?:a )?(?:5|five|top|perfect)|hire (?:me|this candidate)|assistant:|developer message)\b/i;

const MAX_SKILLS = 30;
const MAX_DOMAINS = 10;
const MAX_TITLES = 5;

function matchLexicon(text: string, lexicon: Lexicon, max: number): string[] {
  const found: string[] = [];
  for (const [name, pattern] of lexicon) {
    if (found.length >= max) break;
    if (pattern.test(text)) found.push(name);
  }
  return found;
}

function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/back end/g, 'backend')
    .replace(/front end/g, 'frontend')
    .replace(/back-end/g, 'backend')
    .replace(/front-end/g, 'frontend')
    .trim();
}

const BACKEND_SKILLS = new Set([
  'node.js', 'express', 'django', 'spring', 'postgresql', 'mysql', 'mongodb', 'redis', 'kafka', 'rabbitmq', 'grpc', 'rest api',
  'microservices', 'message queues', 'rate limiting', 'distributed systems', 'concurrency', 'idempotency', 'data modeling',
  'database migrations', 'observability', 'alerting', 'reliability', 'go', 'java', 'kotlin', 'rust', 'sql',
]);
const FRONTEND_SKILLS = new Set([
  'react', 'vue', 'angular', 'next.js', 'css', 'html', 'web components', 'state management', 'accessibility', 'web performance',
  'design systems',
]);
const PRODUCT_SKILLS = new Set(['experimentation', 'product metrics', 'prioritization', 'user research', 'stakeholder management']);

export function inferRole(titles: readonly string[], skills: readonly string[]): Role | null {
  for (const title of titles) {
    if (/product (?:manager|owner)/.test(title)) return 'product';
    if (/\b(?:backend|platform|infrastructure|site reliability|devops|data)\b/.test(title)) return 'backend';
    if (/\b(?:frontend|web|ui)\b/.test(title)) return 'frontend';
  }
  const count = (set: ReadonlySet<string>) => skills.filter((s) => set.has(s)).length;
  const scores: Array<[Role, number]> = [
    ['backend', count(BACKEND_SKILLS)],
    ['frontend', count(FRONTEND_SKILLS)],
    ['product', count(PRODUCT_SKILLS)],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  // Require a clear majority; otherwise leave the role to the candidate.
  if (best && best[1] >= 3 && best[1] >= 2 * (second?.[1] ?? 0)) return best[0];
  return null;
}

export function inferSeniority(titles: readonly string[], years: number | null): Seniority | null {
  for (const title of titles) {
    if (/^(?:senior|staff|principal|lead)\b|engineering manager|tech lead|technical lead/.test(title)) return 'senior';
    if (/^(?:junior|associate)\b/.test(title)) return 'junior';
  }
  if (years === null) return null;
  if (years < 2) return 'junior';
  if (years < 6) return 'mid';
  return 'senior';
}

function buildSummary(profile: Pick<ResumeProfile, 'titles' | 'skills' | 'domains' | 'explicitYearsExperience'>): string {
  const parts: string[] = [];
  if (profile.titles.length > 0) parts.push(`titles: ${profile.titles.slice(0, 3).join(', ')}`);
  if (profile.skills.length > 0) {
    const more = profile.skills.length > 10 ? ` (+${profile.skills.length - 10} more)` : '';
    parts.push(`skills: ${profile.skills.slice(0, 10).join(', ')}${more}`);
  }
  if (profile.domains.length > 0) parts.push(`domains: ${profile.domains.slice(0, 5).join(', ')}`);
  if (profile.explicitYearsExperience !== null) parts.push(`${profile.explicitYearsExperience} years of experience stated`);
  const summary = parts.length > 0 ? `Professional signals: ${parts.join('; ')}.` : 'No recognized professional signals were found.';
  return summary.length > 400 ? `${summary.slice(0, 397)}...` : summary;
}

export interface ExtractProfileInput {
  /** Untrusted resume text, already bounded by the loader. */
  text: string;
  sourceKind: ResumeSourceKind;
  truncated: boolean;
  warnings?: readonly string[];
}

export function extractResumeProfile(input: ExtractProfileInput): ResumeProfile {
  const lines = input.text.split('\n');
  const ignored = lines.filter((line) => INSTRUCTION_LIKE.test(line));
  // Instruction-like lines are removed before matching so they cannot add terms.
  const analyzed = lines.filter((line) => !INSTRUCTION_LIKE.test(line)).join('\n');

  const titles: string[] = [];
  for (const match of analyzed.matchAll(TITLE_PATTERN)) {
    const title = normalizeTitle(match[0]);
    if (!titles.includes(title)) titles.push(title);
    if (titles.length >= MAX_TITLES) break;
  }

  let years: number | null = null;
  for (const match of analyzed.matchAll(YEARS_PATTERN)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value <= 60) years = Math.max(years ?? 0, value);
  }

  const skills = matchLexicon(analyzed, SKILL_LEXICON, MAX_SKILLS);
  const domains = matchLexicon(analyzed, DOMAIN_LEXICON, MAX_DOMAINS);
  const warnings = [...(input.warnings ?? [])];
  if (ignored.length > 0) warnings.push(`${ignored.length} instruction-like line(s) in the resume were ignored.`);
  if (skills.length === 0 && titles.length === 0) warnings.push('No recognized skills or titles; questions use your explicit choices only.');

  const base = { titles, skills, domains, explicitYearsExperience: years };
  return ResumeProfileSchema.parse({
    schemaVersion: 1,
    sourceKind: input.sourceKind,
    analyzedChars: input.text.length,
    truncated: input.truncated,
    ...base,
    inferredRole: inferRole(titles, skills),
    inferredSeniority: inferSeniority(titles, years),
    summary: buildSummary(base),
    ignoredInstructionLikeLines: ignored.length,
    warnings: warnings.slice(0, 10).map((w) => w.slice(0, 200)),
  });
}

/** Terms used in retrieval `queryText`: skills first, then domains. */
export function resumeQueryTerms(profile: ResumeProfile | null): string[] {
  if (!profile) return [];
  return [...profile.skills, ...profile.domains];
}

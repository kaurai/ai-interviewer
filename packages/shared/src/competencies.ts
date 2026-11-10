/**
 * Normalized competency taxonomy.
 *
 * IDs are stable, namespaced keys referenced by question records, interview
 * plans, and feedback reports. Add a new ID only when its evidence and scoring
 * meaning are distinct from every existing one; never add aliases.
 */
export const COMPETENCY_IDS = [
  'backend.api-design',
  'backend.data-modeling',
  'backend.concurrency',
  'backend.caching',
  'backend.reliability',
  'backend.observability',
  'backend.security',
  'backend.system-tradeoffs',
  'frontend.accessibility',
  'frontend.performance',
  'frontend.state-management',
  'frontend.testing',
  'frontend.component-design',
  'frontend.browser-platform',
  'product.prioritization',
  'product.metrics',
  'product.stakeholder-management',
  'product.experimentation',
  'product.discovery',
  'product.strategy',
  'behavioral.communication',
  'behavioral.ownership',
  'behavioral.collaboration',
  'behavioral.conflict-resolution',
  'behavioral.learning-agility',
  'behavioral.adaptability',
  'behavioral.decision-making',
  'shared.problem-solving',
  'shared.tradeoff-reasoning',
] as const;

/**
 * Normalized AI competency taxonomy.
 *
 * IDs are stable, namespaced keys referenced by question records, interview
 * plans, and feedback reports. Every ID uses the `ai.` or `shared.` namespace
 * because the interview assesses AI skills only. Add a new ID only when its
 * evidence and scoring meaning are distinct from every existing one; never add
 * aliases.
 */
export const COMPETENCY_IDS = [
  // AI fundamentals
  'ai.ml-foundations',
  'ai.training-optimization',
  'ai.representations',
  'ai.neural-architectures',
  'ai.llm-behavior',
  'ai.adaptation-methods',
  // Building AI systems
  'ai.data-pipelines',
  'ai.retrieval-systems',
  'ai.agents-tool-use',
  'ai.serving-performance',
  'ai.reliability-safety',
  'ai.mlops-monitoring',
  // Evaluating AI models
  'ai.metric-selection',
  'ai.eval-design',
  'ai.generative-evaluation',
  'ai.online-experimentation',
  'ai.error-analysis',
  'ai.responsible-ai',
  // Applied problem solving
  'ai.problem-framing',
  'ai.debugging',
  'ai.ownership',
  'ai.stakeholder-communication',
  // Shared
  'shared.problem-solving',
  'shared.tradeoff-reasoning',
] as const;

/** Namespaces a competency ID may use. */
export const COMPETENCY_NAMESPACES = ['ai', 'shared'] as const;

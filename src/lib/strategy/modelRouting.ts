/**
 * Strategy Model Routing — Simplified 3-Provider Architecture
 *
 * STRICT RULES:
 * 1. OpenAI  = DEFAULT ENGINE — chat, workflows, rollups, reasoning
 * 2. Claude  = ARTIFACT ENGINE — transform, regenerate, refine ONLY
 * 3. Perplexity = RESEARCH ENGINE — deep_research ONLY (never for chat)
 *
 * FALLBACK (single attempt, no chaining):
 *   OpenAI  → Claude
 *   Claude  → OpenAI
 *   Perplexity → OpenAI
 */

export type StrategyTaskType =
  | 'chat_general'
  | 'deep_research'
  | 'email_evaluation'
  | 'territory_tiering'
  | 'account_plan'
  | 'opportunity_strategy'
  | 'brainstorm'
  | 'rollup'
  | 'transform_output'
  | 'regenerate_artifact'
  | 'refine_artifact';

export type ProviderKey = 'openai' | 'anthropic' | 'perplexity';

export interface StrategyModelRoute {
  provider: ProviderKey;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoning?: { effort: string };
  fallbackProvider: ProviderKey;
  fallbackModel: string;
}

// ── Artifact tasks that MUST use Claude ──────────────────────────
const ARTIFACT_TASKS: ReadonlySet<StrategyTaskType> = new Set([
  'transform_output',
  'regenerate_artifact',
  'refine_artifact',
]);

// ── Research tasks that MUST use Perplexity ──────────────────────
const RESEARCH_TASKS: ReadonlySet<StrategyTaskType> = new Set([
  'deep_research',
]);

const STRATEGY_MODEL_ROUTES: Record<StrategyTaskType, StrategyModelRoute> = {
  // ── OpenAI = DEFAULT ENGINE ───────────────────────────────────
  chat_general:         { provider: 'openai', model: 'gpt-4o',  temperature: 0.7, maxTokens: 4096,  fallbackProvider: 'anthropic', fallbackModel: 'claude-sonnet-4-20250514' },
  email_evaluation:     { provider: 'openai', model: 'gpt-4o',  temperature: 0.4, maxTokens: 4096,  fallbackProvider: 'anthropic', fallbackModel: 'claude-sonnet-4-20250514' },
  territory_tiering:    { provider: 'openai', model: 'gpt-4o',  temperature: 0.2, maxTokens: 8192,  reasoning: { effort: 'medium' }, fallbackProvider: 'anthropic', fallbackModel: 'claude-sonnet-4-20250514' },
  account_plan:         { provider: 'openai', model: 'gpt-4o',  temperature: 0.5, maxTokens: 8192,  fallbackProvider: 'anthropic', fallbackModel: 'claude-sonnet-4-20250514' },
  opportunity_strategy: { provider: 'openai', model: 'gpt-4o',  temperature: 0.5, maxTokens: 8192,  fallbackProvider: 'anthropic', fallbackModel: 'claude-sonnet-4-20250514' },
  brainstorm:           { provider: 'openai', model: 'gpt-4o',  temperature: 0.9, maxTokens: 4096,  fallbackProvider: 'anthropic', fallbackModel: 'claude-sonnet-4-20250514' },
  rollup:               { provider: 'openai', model: 'gpt-4o',  temperature: 0.3, maxTokens: 4096,  fallbackProvider: 'anthropic', fallbackModel: 'claude-sonnet-4-20250514' },

  // ── Perplexity = RESEARCH ENGINE (explicit only) ──────────────
  deep_research:        { provider: 'perplexity', model: 'sonar-pro', temperature: 0.3, maxTokens: 8192, fallbackProvider: 'openai', fallbackModel: 'gpt-4o' },

  // ── Claude = ARTIFACT ENGINE ──────────────────────────────────
  transform_output:     { provider: 'anthropic', model: 'claude-sonnet-4-20250514', temperature: 0.5, maxTokens: 4096, fallbackProvider: 'openai', fallbackModel: 'gpt-4o' },
  regenerate_artifact:  { provider: 'anthropic', model: 'claude-sonnet-4-20250514', temperature: 0.5, maxTokens: 4096, fallbackProvider: 'openai', fallbackModel: 'gpt-4o' },
  refine_artifact:      { provider: 'anthropic', model: 'claude-sonnet-4-20250514', temperature: 0.5, maxTokens: 4096, fallbackProvider: 'openai', fallbackModel: 'gpt-4o' },
};

/**
 * Resolve a task type to its model route with guardrails enforced.
 *
 * Guardrails:
 * - If task ≠ deep_research → NEVER returns Perplexity
 * - If task is an artifact task → NEVER returns OpenAI as primary
 */
export function getModelRoute(taskType: StrategyTaskType): StrategyModelRoute {
  const route = STRATEGY_MODEL_ROUTES[taskType] ?? STRATEGY_MODEL_ROUTES.chat_general;

  // Guardrail: non-research tasks must never resolve to Perplexity
  if (!RESEARCH_TASKS.has(taskType) && route.provider === 'perplexity') {
    console.warn(`[routing] guardrail: blocked Perplexity for non-research task "${taskType}", falling back to OpenAI`);
    return STRATEGY_MODEL_ROUTES.chat_general;
  }

  // Guardrail: artifact tasks must never resolve to OpenAI as primary
  if (ARTIFACT_TASKS.has(taskType) && route.provider === 'openai') {
    console.warn(`[routing] guardrail: blocked OpenAI primary for artifact task "${taskType}", using Claude`);
    return STRATEGY_MODEL_ROUTES.transform_output;
  }

  return route;
}

/** Check if a task is an artifact task */
export function isArtifactTask(taskType: StrategyTaskType): boolean {
  return ARTIFACT_TASKS.has(taskType);
}

/** Check if a task is a research task */
export function isResearchTask(taskType: StrategyTaskType): boolean {
  return RESEARCH_TASKS.has(taskType);
}

/** Human-readable model display names */
export function getModelDisplayName(model: string): string {
  const names: Record<string, string> = {
    'gpt-4o': 'GPT-4o',
    'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    'sonar-pro': 'Sonar Pro',
  };
  return names[model] || model;
}

/** Provider display names */
export function getProviderDisplayName(provider: string): string {
  const names: Record<string, string> = {
    openai: 'ChatGPT',
    anthropic: 'Claude',
    perplexity: 'Perplexity',
  };
  return names[provider] || provider;
}

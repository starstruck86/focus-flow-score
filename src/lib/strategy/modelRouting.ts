/**
 * Strategy Model Routing Config — Production Multi-LLM Architecture
 * 
 * MODEL ROLES (NON-NEGOTIABLE):
 * - OpenAI (ChatGPT) = DEFAULT ENGINE — all chat, workflows, reasoning
 * - Perplexity = EXTERNAL RESEARCH ONLY — fresh web data
 * - Anthropic (Claude) = ARTIFACT ENGINE — transform, regenerate, refine
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
  temperature?: number;
  maxTokens?: number;
  reasoning?: { effort: string };
  fallbackProvider: ProviderKey;
  fallbackModel: string;
}

export const STRATEGY_MODEL_ROUTES: Record<StrategyTaskType, StrategyModelRoute> = {
  // ChatGPT = DEFAULT ENGINE — Claude NEVER used as fallback here
  chat_general:         { provider: 'openai', model: 'openai/gpt-5-mini', temperature: 0.7, maxTokens: 4096, fallbackProvider: 'openai', fallbackModel: 'openai/gpt-5' },
  email_evaluation:     { provider: 'openai', model: 'openai/gpt-5-mini', temperature: 0.4, maxTokens: 4096, fallbackProvider: 'openai', fallbackModel: 'openai/gpt-5' },
  territory_tiering:    { provider: 'openai', model: 'openai/gpt-5',      temperature: 0.2, maxTokens: 8192, reasoning: { effort: 'medium' }, fallbackProvider: 'openai', fallbackModel: 'openai/gpt-5-mini' },
  account_plan:         { provider: 'openai', model: 'openai/gpt-5-mini', temperature: 0.5, maxTokens: 8192, fallbackProvider: 'openai', fallbackModel: 'openai/gpt-5' },
  opportunity_strategy: { provider: 'openai', model: 'openai/gpt-5-mini', temperature: 0.5, maxTokens: 8192, fallbackProvider: 'openai', fallbackModel: 'openai/gpt-5' },
  brainstorm:           { provider: 'openai', model: 'openai/gpt-5-mini', temperature: 0.9, maxTokens: 4096, fallbackProvider: 'openai', fallbackModel: 'openai/gpt-5' },
  rollup:               { provider: 'openai', model: 'openai/gpt-5-mini', temperature: 0.3, maxTokens: 4096, fallbackProvider: 'openai', fallbackModel: 'openai/gpt-5' },

  // Perplexity = EXTERNAL RESEARCH ONLY
  deep_research:        { provider: 'perplexity', model: 'sonar-pro', temperature: 0.3, maxTokens: 8192, fallbackProvider: 'openai', fallbackModel: 'openai/gpt-5-mini' },

  // Claude = ARTIFACT ENGINE ONLY (used in strategy-transform-output, NOT in strategy-chat)
  transform_output:     { provider: 'anthropic', model: 'claude-sonnet-4-20250514', temperature: 0.5, maxTokens: 4096, fallbackProvider: 'openai', fallbackModel: 'openai/gpt-5-mini' },
  regenerate_artifact:  { provider: 'anthropic', model: 'claude-sonnet-4-20250514', temperature: 0.5, maxTokens: 4096, fallbackProvider: 'openai', fallbackModel: 'openai/gpt-5-mini' },
  refine_artifact:      { provider: 'anthropic', model: 'claude-sonnet-4-20250514', temperature: 0.5, maxTokens: 4096, fallbackProvider: 'openai', fallbackModel: 'openai/gpt-5-mini' },
};

export function getModelRoute(taskType: StrategyTaskType): StrategyModelRoute {
  return STRATEGY_MODEL_ROUTES[taskType] ?? STRATEGY_MODEL_ROUTES.chat_general;
}

/** Human-readable model display names */
export function getModelDisplayName(model: string): string {
  const names: Record<string, string> = {
    'openai/gpt-5': 'GPT-5',
    'openai/gpt-5-mini': 'GPT-5 Mini',
    'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    'sonar-pro': 'Sonar Pro',
  };
  return names[model] || model.split('/').pop() || model;
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

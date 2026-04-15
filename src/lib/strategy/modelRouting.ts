/**
 * Strategy Model Routing Config
 * 
 * Central config for routing strategy tasks to the right model/provider.
 * Ready for multi-model orchestration — swap providers per task type.
 */

export type StrategyTaskType =
  | 'chat_general'
  | 'deep_research'
  | 'email_evaluation'
  | 'territory_tiering'
  | 'account_plan'
  | 'opportunity_strategy'
  | 'brainstorm';

export interface StrategyModelRoute {
  provider: 'lovable_ai' | 'openai' | 'anthropic' | 'perplexity';
  model: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: { effort: string };
}

/**
 * Default routing config. All routes currently use Lovable AI gateway.
 * To add a new provider, add a new provider key and update the route.
 */
export const STRATEGY_MODEL_ROUTES: Record<StrategyTaskType, StrategyModelRoute> = {
  chat_general: {
    provider: 'lovable_ai',
    model: 'google/gemini-3-flash-preview',
    temperature: 0.7,
    maxTokens: 4096,
  },
  deep_research: {
    provider: 'lovable_ai',
    model: 'google/gemini-2.5-pro',
    temperature: 0.3,
    maxTokens: 8192,
  },
  email_evaluation: {
    provider: 'lovable_ai',
    model: 'google/gemini-3-flash-preview',
    temperature: 0.4,
    maxTokens: 4096,
  },
  territory_tiering: {
    provider: 'lovable_ai',
    model: 'google/gemini-2.5-pro',
    temperature: 0.2,
    maxTokens: 8192,
    reasoning: { effort: 'medium' },
  },
  account_plan: {
    provider: 'lovable_ai',
    model: 'google/gemini-2.5-flash',
    temperature: 0.5,
    maxTokens: 8192,
  },
  opportunity_strategy: {
    provider: 'lovable_ai',
    model: 'google/gemini-2.5-flash',
    temperature: 0.5,
    maxTokens: 8192,
  },
  brainstorm: {
    provider: 'lovable_ai',
    model: 'google/gemini-3-flash-preview',
    temperature: 0.9,
    maxTokens: 4096,
  },
};

export function getModelRoute(taskType: StrategyTaskType): StrategyModelRoute {
  return STRATEGY_MODEL_ROUTES[taskType] ?? STRATEGY_MODEL_ROUTES.chat_general;
}

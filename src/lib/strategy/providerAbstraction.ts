/**
 * Strategy Provider Abstraction Layer
 * 
 * Defines the shape for multi-provider orchestration.
 * Currently all routes use Lovable AI gateway, but the architecture
 * is ready for ChatGPT, Claude, Perplexity, etc.
 */

export type ProviderKey = 'lovable_ai' | 'openai' | 'anthropic' | 'perplexity';

export interface ProviderConfig {
  key: ProviderKey;
  label: string;
  gateway: string;
  authHeader: string; // header name for auth
  capabilities: ('chat' | 'research' | 'structured' | 'streaming' | 'reasoning')[];
  isAvailable: boolean;
}

export const PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  lovable_ai: {
    key: 'lovable_ai',
    label: 'Lovable AI',
    gateway: 'https://ai.gateway.lovable.dev/v1/chat/completions',
    authHeader: 'Authorization',
    capabilities: ['chat', 'research', 'structured', 'streaming', 'reasoning'],
    isAvailable: true,
  },
  openai: {
    key: 'openai',
    label: 'ChatGPT',
    gateway: 'https://api.openai.com/v1/chat/completions',
    authHeader: 'Authorization',
    capabilities: ['chat', 'structured', 'streaming', 'reasoning'],
    isAvailable: false, // enable when API key configured
  },
  anthropic: {
    key: 'anthropic',
    label: 'Claude',
    gateway: 'https://api.anthropic.com/v1/messages',
    authHeader: 'x-api-key',
    capabilities: ['chat', 'structured', 'reasoning'],
    isAvailable: false,
  },
  perplexity: {
    key: 'perplexity',
    label: 'Perplexity',
    gateway: 'https://api.perplexity.ai/chat/completions',
    authHeader: 'Authorization',
    capabilities: ['chat', 'research'],
    isAvailable: false,
  },
};

export interface ResolvedRoute {
  provider: ProviderConfig;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoning?: { effort: string };
}

/**
 * Resolve a task type to a concrete provider + model route.
 * Falls back to lovable_ai if preferred provider is unavailable.
 */
export function resolveRoute(
  taskType: string,
  routes: Record<string, { provider: ProviderKey; model: string; temperature: number; maxTokens: number; reasoning?: { effort: string } }>,
): ResolvedRoute {
  const route = routes[taskType] || routes['chat_general'];
  const provider = PROVIDERS[route.provider];
  
  // Fallback if provider unavailable
  if (!provider.isAvailable) {
    const fallback = PROVIDERS.lovable_ai;
    console.log(`[routing] ${route.provider} unavailable for ${taskType}, falling back to lovable_ai`);
    return { provider: fallback, model: route.model, temperature: route.temperature, maxTokens: route.maxTokens, reasoning: route.reasoning };
  }

  return { provider, model: route.model, temperature: route.temperature, maxTokens: route.maxTokens, reasoning: route.reasoning };
}

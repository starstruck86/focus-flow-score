/**
 * Strategy Provider Abstraction Layer
 * 
 * Defines the shape for multi-provider orchestration.
 * Architecture ready for ChatGPT, Claude, Perplexity, etc.
 */

export type ProviderKey = 'lovable_ai' | 'openai' | 'anthropic' | 'perplexity';

export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  reasoning: boolean;
  maxContextTokens: number;
}

export interface ProviderConfig {
  key: ProviderKey;
  label: string;
  gateway: string;
  authHeader: string;
  capabilities: ProviderCapabilities;
  isAvailable: boolean;
}

export const PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  lovable_ai: {
    key: 'lovable_ai',
    label: 'Lovable AI',
    gateway: 'https://ai.gateway.lovable.dev/v1/chat/completions',
    authHeader: 'Authorization',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      reasoning: true,
      maxContextTokens: 128000,
    },
    isAvailable: true,
  },
  openai: {
    key: 'openai',
    label: 'ChatGPT',
    gateway: 'https://api.openai.com/v1/chat/completions',
    authHeader: 'Authorization',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      reasoning: true,
      maxContextTokens: 128000,
    },
    isAvailable: false,
  },
  anthropic: {
    key: 'anthropic',
    label: 'Claude',
    gateway: 'https://api.anthropic.com/v1/messages',
    authHeader: 'x-api-key',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      reasoning: true,
      maxContextTokens: 200000,
    },
    isAvailable: false,
  },
  perplexity: {
    key: 'perplexity',
    label: 'Perplexity',
    gateway: 'https://api.perplexity.ai/chat/completions',
    authHeader: 'Authorization',
    capabilities: {
      streaming: true,
      toolCalling: false,
      vision: false,
      reasoning: false,
      maxContextTokens: 128000,
    },
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
  
  if (!provider.isAvailable) {
    const fallback = PROVIDERS.lovable_ai;
    console.log(`[routing] ${route.provider} unavailable for ${taskType}, falling back to lovable_ai`);
    return { provider: fallback, model: route.model, temperature: route.temperature, maxTokens: route.maxTokens, reasoning: route.reasoning };
  }

  return { provider, model: route.model, temperature: route.temperature, maxTokens: route.maxTokens, reasoning: route.reasoning };
}

/**
 * Check if a provider supports a specific capability.
 */
export function providerSupports(key: ProviderKey, capability: keyof ProviderCapabilities): boolean {
  const provider = PROVIDERS[key];
  if (!provider) return false;
  return !!provider.capabilities[capability];
}

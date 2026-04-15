/**
 * Strategy Provider Abstraction Layer
 * 
 * All providers use DIRECT API calls with dedicated API keys.
 * - OpenAI: api.openai.com with OPENAI_API_KEY
 * - Anthropic: api.anthropic.com with ANTHROPIC_API_KEY
 * - Perplexity: api.perplexity.ai with PERPLEXITY_API_KEY
 * No Lovable gateway in the request path.
 */

export type ProviderKey = 'openai' | 'anthropic' | 'perplexity';

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
    isAvailable: true,
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
    isAvailable: true,
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
    isAvailable: true,
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
 * All providers are direct — no gateway intermediaries.
 */
export function resolveRoute(
  taskType: string,
  routes: Record<string, { provider: ProviderKey; model: string; temperature: number; maxTokens: number; reasoning?: { effort: string } }>,
): ResolvedRoute {
  const route = routes[taskType] || routes['chat_general'];
  const provider = PROVIDERS[route.provider];

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

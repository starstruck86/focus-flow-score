/**
 * Strategy Provider Abstraction Layer — Simplified 3-Provider Architecture
 *
 * Direct API calls only. No gateway intermediaries.
 *   OpenAI:     api.openai.com     + OPENAI_API_KEY
 *   Anthropic:  api.anthropic.com  + ANTHROPIC_API_KEY
 *   Perplexity: api.perplexity.ai  + PERPLEXITY_API_KEY
 */

export type ProviderKey = 'openai' | 'anthropic' | 'perplexity';

export interface ProviderConfig {
  key: ProviderKey;
  label: string;
  endpoint: string;
  authHeader: string;
}

/** Normalized response shape for ALL providers */
export interface LLMResponse {
  text: string;
  structured?: Record<string, unknown>;
  provider: ProviderKey;
  model: string;
  latencyMs: number;
  fallbackUsed: boolean;
  error?: string;
}

export const PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  openai: {
    key: 'openai',
    label: 'ChatGPT',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    authHeader: 'Authorization',
  },
  anthropic: {
    key: 'anthropic',
    label: 'Claude',
    endpoint: 'https://api.anthropic.com/v1/messages',
    authHeader: 'x-api-key',
  },
  perplexity: {
    key: 'perplexity',
    label: 'Perplexity',
    endpoint: 'https://api.perplexity.ai/chat/completions',
    authHeader: 'Authorization',
  },
};

/**
 * Check if a provider key is valid.
 */
export function isValidProvider(key: string): key is ProviderKey {
  return key in PROVIDERS;
}

/**
 * Get provider config, throws if invalid.
 */
export function getProvider(key: ProviderKey): ProviderConfig {
  const provider = PROVIDERS[key];
  if (!provider) throw new Error(`Unknown provider: ${key}`);
  return provider;
}

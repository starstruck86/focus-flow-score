/**
 * Predictive Resource Strategy Planner
 *
 * Before first enrichment attempt, selects the optimal strategy based on:
 *   - Source type and content characteristics
 *   - Per-resource history
 *   - Per-pattern (domain/type) history
 *   - Cost/latency budget
 *
 * Goal: maximize first-pass trusted success, not raw completion.
 */

import { createLogger } from './logger';
import { classifySource, getSourcePolicy, type SourceCategory } from './resourceTrust';

const log = createLogger('StrategyPlanner');

// ── Strategy Types ─────────────────────────────────────────
export type EnrichStrategy =
  | 'full_enrich'
  | 'summary_first'
  | 'lightweight_extract'
  | 'metadata_only';

export interface StrategyPlan {
  primaryStrategy: EnrichStrategy;
  fallbackChain: EnrichStrategy[];
  estimatedCost: number;           // relative units (1 = cheapest)
  estimatedTimeMs: number;
  reasoning: string[];
  confidence: number;              // 0-1, how confident the planner is
}

// ── Per-Resource Memory ────────────────────────────────────
export interface ResourceMemory {
  resourceId: string;
  lastSuccessfulStrategy: EnrichStrategy | null;
  lastFailureCategory: string | null;
  successfulTimeoutMs: number | null;
  fallbackPathUsed: EnrichStrategy | null;
  lifetimeAttempts: number;
  lifetimeSuccesses: number;
  lastAttemptAt: string | null;
}

// ── Per-Pattern Memory ─────────────────────────────────────
export interface PatternMemory {
  patternKey: string;              // e.g. "youtube_transcript" or "blog:hubspot.com"
  totalAttempts: number;
  totalSuccesses: number;
  firstPassSuccessRate: number;    // 0-1
  avgCostPerSuccess: number;
  preferredStrategy: EnrichStrategy | null;
  avgTimeMs: number;
  commonFailures: string[];
  lastUpdated: string;
}

// ── Cost Model ─────────────────────────────────────────────
const STRATEGY_COSTS: Record<EnrichStrategy, number> = {
  full_enrich: 10,
  summary_first: 6,
  lightweight_extract: 3,
  metadata_only: 1,
};

const STRATEGY_TIME_MS: Record<EnrichStrategy, number> = {
  full_enrich: 90_000,
  summary_first: 60_000,
  lightweight_extract: 30_000,
  metadata_only: 10_000,
};

// ── In-memory pattern store (session-scoped) ───────────────
const patternStore = new Map<string, PatternMemory>();
const resourceStore = new Map<string, ResourceMemory>();

// ── Pattern key generation ─────────────────────────────────
function getPatternKey(sourceCategory: SourceCategory, url?: string | null): string {
  if (url) {
    try {
      const hostname = new URL(url).hostname.replace('www.', '');
      return `${sourceCategory}:${hostname}`;
    } catch { /* ignore */ }
  }
  return sourceCategory;
}

// ── Strategy Selection ─────────────────────────────────────
export function planStrategy(input: {
  resourceId: string;
  sourceUrl: string | null;
  resourceType?: string;
  contentSize: number;
  failureCount: number;
  enrichmentStatus: string;
  priority?: 'high' | 'normal' | 'low';
}): StrategyPlan {
  const sourceCategory = classifySource(input.sourceUrl, input.resourceType);
  const policy = getSourcePolicy(sourceCategory);
  const patternKey = getPatternKey(sourceCategory, input.sourceUrl);
  const reasoning: string[] = [];

  // Check resource memory
  const resourceMem = resourceStore.get(input.resourceId);
  const patternMem = patternStore.get(patternKey);

  let primaryStrategy: EnrichStrategy = 'full_enrich';
  let confidence = 0.5;

  // Rule 1: If resource previously succeeded with a strategy, reuse it
  if (resourceMem?.lastSuccessfulStrategy) {
    primaryStrategy = resourceMem.lastSuccessfulStrategy;
    confidence = 0.9;
    reasoning.push(`Reusing last successful strategy: ${primaryStrategy}`);
  }
  // Rule 2: If pattern has high success rate with a preferred strategy
  else if (patternMem?.preferredStrategy && patternMem.firstPassSuccessRate > 0.7) {
    primaryStrategy = patternMem.preferredStrategy;
    confidence = 0.7 + (patternMem.firstPassSuccessRate * 0.2);
    reasoning.push(`Pattern "${patternKey}" prefers ${primaryStrategy} (${Math.round(patternMem.firstPassSuccessRate * 100)}% success)`);
  }
  // Rule 3: Auth-gated sources → metadata only
  else if (policy.authGatedLikelihood >= 0.8) {
    primaryStrategy = 'metadata_only';
    confidence = 0.8;
    reasoning.push(`Auth-gated source (${Math.round(policy.authGatedLikelihood * 100)}% likelihood) → metadata_only`);
  }
  // Rule 4: Large content → summary first
  else if (input.contentSize > 50000 && policy.supportsSummaryFirst) {
    primaryStrategy = 'summary_first';
    confidence = 0.6;
    reasoning.push(`Large content (${Math.round(input.contentSize / 1000)}k chars) → summary_first`);
  }
  // Rule 5: Previous failures → try lighter strategy
  else if (input.failureCount >= 2) {
    primaryStrategy = policy.supportsLightweight ? 'lightweight_extract' : 'summary_first';
    confidence = 0.4;
    reasoning.push(`${input.failureCount} prior failures → downgrading to ${primaryStrategy}`);
  }
  // Rule 6: Default by source type
  else {
    reasoning.push(`Default strategy for ${sourceCategory}: full_enrich`);
  }

  // Build fallback chain
  const fallbackChain = buildFallbackChain(primaryStrategy, policy);

  // Estimate cost
  const estimatedCost = STRATEGY_COSTS[primaryStrategy]
    + fallbackChain.reduce((sum, s) => sum + STRATEGY_COSTS[s] * 0.3, 0);

  return {
    primaryStrategy,
    fallbackChain,
    estimatedCost,
    estimatedTimeMs: STRATEGY_TIME_MS[primaryStrategy],
    reasoning,
    confidence,
  };
}

function buildFallbackChain(primary: EnrichStrategy, policy: { supportsSummaryFirst: boolean; supportsLightweight: boolean }): EnrichStrategy[] {
  const chain: EnrichStrategy[] = [];

  if (primary === 'full_enrich') {
    if (policy.supportsSummaryFirst) chain.push('summary_first');
    if (policy.supportsLightweight) chain.push('lightweight_extract');
    chain.push('metadata_only');
  } else if (primary === 'summary_first') {
    if (policy.supportsLightweight) chain.push('lightweight_extract');
    chain.push('metadata_only');
  } else if (primary === 'lightweight_extract') {
    chain.push('metadata_only');
  }

  return chain;
}

// ── Memory Recording ───────────────────────────────────────
export function recordSuccess(
  resourceId: string,
  sourceUrl: string | null,
  resourceType: string | undefined,
  strategy: EnrichStrategy,
  timeMs: number,
  cost: number,
): void {
  // Update resource memory
  const existing = resourceStore.get(resourceId) ?? createDefaultResourceMemory(resourceId);
  existing.lastSuccessfulStrategy = strategy;
  existing.successfulTimeoutMs = timeMs;
  existing.lifetimeAttempts++;
  existing.lifetimeSuccesses++;
  existing.lastAttemptAt = new Date().toISOString();
  resourceStore.set(resourceId, existing);

  // Update pattern memory
  const sourceCategory = classifySource(sourceUrl, resourceType);
  const patternKey = getPatternKey(sourceCategory, sourceUrl);
  const pattern = patternStore.get(patternKey) ?? createDefaultPatternMemory(patternKey);
  pattern.totalAttempts++;
  pattern.totalSuccesses++;
  pattern.firstPassSuccessRate = pattern.totalSuccesses / pattern.totalAttempts;
  pattern.avgCostPerSuccess = ((pattern.avgCostPerSuccess * (pattern.totalSuccesses - 1)) + cost) / pattern.totalSuccesses;
  pattern.avgTimeMs = ((pattern.avgTimeMs * (pattern.totalSuccesses - 1)) + timeMs) / pattern.totalSuccesses;
  pattern.preferredStrategy = strategy;
  pattern.lastUpdated = new Date().toISOString();
  patternStore.set(patternKey, pattern);

  log.debug('Strategy success recorded', { resourceId, strategy, patternKey });
}

export function recordFailure(
  resourceId: string,
  sourceUrl: string | null,
  resourceType: string | undefined,
  failureCategory: string,
): void {
  const existing = resourceStore.get(resourceId) ?? createDefaultResourceMemory(resourceId);
  existing.lastFailureCategory = failureCategory;
  existing.lifetimeAttempts++;
  existing.lastAttemptAt = new Date().toISOString();
  resourceStore.set(resourceId, existing);

  const sourceCategory = classifySource(sourceUrl, resourceType);
  const patternKey = getPatternKey(sourceCategory, sourceUrl);
  const pattern = patternStore.get(patternKey) ?? createDefaultPatternMemory(patternKey);
  pattern.totalAttempts++;
  pattern.firstPassSuccessRate = pattern.totalSuccesses / pattern.totalAttempts;
  if (!pattern.commonFailures.includes(failureCategory)) {
    pattern.commonFailures = [...pattern.commonFailures.slice(-4), failureCategory];
  }
  pattern.lastUpdated = new Date().toISOString();
  patternStore.set(patternKey, pattern);
}

// ── Memory Accessors ───────────────────────────────────────
export function getResourceMemory(resourceId: string): ResourceMemory | null {
  return resourceStore.get(resourceId) ?? null;
}

export function getPatternMemory(patternKey: string): PatternMemory | null {
  return patternStore.get(patternKey) ?? null;
}

export function getAllPatternMemories(): PatternMemory[] {
  return [...patternStore.values()];
}

// ── Cost Tracking Summary ──────────────────────────────────
export interface CostSummary {
  totalAttempts: number;
  totalSuccesses: number;
  totalEstimatedCost: number;
  costPerTrustedSuccess: number;
  strategyBreakdown: Record<EnrichStrategy, { attempts: number; successes: number; avgCost: number }>;
}

export function getCostSummary(): CostSummary {
  const patterns = getAllPatternMemories();
  let totalAttempts = 0;
  let totalSuccesses = 0;
  let totalCost = 0;

  for (const p of patterns) {
    totalAttempts += p.totalAttempts;
    totalSuccesses += p.totalSuccesses;
    totalCost += p.avgCostPerSuccess * p.totalSuccesses;
  }

  return {
    totalAttempts,
    totalSuccesses,
    totalEstimatedCost: Math.round(totalCost),
    costPerTrustedSuccess: totalSuccesses > 0 ? Math.round(totalCost / totalSuccesses) : 0,
    strategyBreakdown: {
      full_enrich: { attempts: 0, successes: 0, avgCost: STRATEGY_COSTS.full_enrich },
      summary_first: { attempts: 0, successes: 0, avgCost: STRATEGY_COSTS.summary_first },
      lightweight_extract: { attempts: 0, successes: 0, avgCost: STRATEGY_COSTS.lightweight_extract },
      metadata_only: { attempts: 0, successes: 0, avgCost: STRATEGY_COSTS.metadata_only },
    },
  };
}

// ── Helpers ────────────────────────────────────────────────
function createDefaultResourceMemory(resourceId: string): ResourceMemory {
  return {
    resourceId,
    lastSuccessfulStrategy: null,
    lastFailureCategory: null,
    successfulTimeoutMs: null,
    fallbackPathUsed: null,
    lifetimeAttempts: 0,
    lifetimeSuccesses: 0,
    lastAttemptAt: null,
  };
}

function createDefaultPatternMemory(patternKey: string): PatternMemory {
  return {
    patternKey,
    totalAttempts: 0,
    totalSuccesses: 0,
    firstPassSuccessRate: 0,
    avgCostPerSuccess: 0,
    preferredStrategy: null,
    avgTimeMs: 0,
    commonFailures: [],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Resource Firewall — read-time validation, hard downstream gates,
 * kill switches, rate limiting, burst protection, environment awareness,
 * and cross-session idempotency.
 *
 * This is the FINAL safety layer between stored resources and downstream systems.
 * Every consumer MUST call `gateForPurpose()` before using a resource.
 */

import { createLogger } from './logger';
import {
  assessTrust,
  computeTrustScore,
  classifyTrustStatus,
  computeEligibility,
  type ResourceForTrust,
  type TrustStatus,
  type DownstreamPurpose,
  type TrustOverride,
} from './resourceTrust';
import type { EnrichmentStatus } from './resourceEligibility';

const log = createLogger('ResourceFirewall');

// ═══════════════════════════════════════════════════════════
// SECTION 1 — Kill Switches (global feature flags)
// ═══════════════════════════════════════════════════════════

export interface KillSwitches {
  enrichment_enabled: boolean;
  retry_enabled: boolean;
  fallback_enabled: boolean;
  reconciliation_enabled: boolean;
  downstream_trust_enforcement_enabled: boolean;
}

const DEFAULTS: KillSwitches = {
  enrichment_enabled: true,
  retry_enabled: true,
  fallback_enabled: true,
  reconciliation_enabled: true,
  downstream_trust_enforcement_enabled: true,
};

let _switches: KillSwitches = { ...DEFAULTS };

export function getKillSwitches(): Readonly<KillSwitches> {
  return _switches;
}

export function setKillSwitch<K extends keyof KillSwitches>(key: K, value: boolean): void {
  log.info('Kill switch changed', { key, from: _switches[key], to: value });
  _switches = { ..._switches, [key]: value };
}

export function resetKillSwitches(): void {
  _switches = { ...DEFAULTS };
}

// ═══════════════════════════════════════════════════════════
// SECTION 2 — Environment Awareness
// ═══════════════════════════════════════════════════════════

export type EnvironmentProfile = 'production' | 'preview' | 'offline' | 'degraded';

export interface EnvironmentPolicy {
  maxConcurrentEnrich: number;
  maxRetriesPerWindow: number;
  retryWindowMs: number;
  defaultTimeoutMs: number;
  enableBackgroundProcessing: boolean;
}

const ENV_POLICIES: Record<EnvironmentProfile, EnvironmentPolicy> = {
  production: {
    maxConcurrentEnrich: 3,
    maxRetriesPerWindow: 10,
    retryWindowMs: 60_000,
    defaultTimeoutMs: 90_000,
    enableBackgroundProcessing: true,
  },
  preview: {
    maxConcurrentEnrich: 2,
    maxRetriesPerWindow: 6,
    retryWindowMs: 60_000,
    defaultTimeoutMs: 60_000,
    enableBackgroundProcessing: true,
  },
  offline: {
    maxConcurrentEnrich: 0,
    maxRetriesPerWindow: 0,
    retryWindowMs: 0,
    defaultTimeoutMs: 0,
    enableBackgroundProcessing: false,
  },
  degraded: {
    maxConcurrentEnrich: 1,
    maxRetriesPerWindow: 3,
    retryWindowMs: 120_000,
    defaultTimeoutMs: 120_000,
    enableBackgroundProcessing: false,
  },
};

export function detectEnvironment(): EnvironmentProfile {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';

  const hostname = typeof window !== 'undefined' ? window.location?.hostname ?? '' : '';
  if (hostname.includes('preview') || hostname.includes('localhost')) return 'preview';

  // Check for slow connection
  if (typeof navigator !== 'undefined' && 'connection' in navigator) {
    const conn = (navigator as any).connection;
    if (conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return 'degraded';
  }

  return 'production';
}

export function getEnvironmentPolicy(profile?: EnvironmentProfile): EnvironmentPolicy {
  return ENV_POLICIES[profile ?? detectEnvironment()];
}

// ═══════════════════════════════════════════════════════════
// SECTION 3 — Rate Limiting & Burst Protection
// ═══════════════════════════════════════════════════════════

interface RateLimitState {
  activeJobs: Set<string>;
  retryTimestamps: number[];
  perResourceCooldowns: Map<string, number>; // resourceId → last attempt time
}

const _rateState: RateLimitState = {
  activeJobs: new Set(),
  retryTimestamps: [],
  perResourceCooldowns: new Map(),
};

const PER_RESOURCE_COOLDOWN_MS = 15_000;

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

export function checkRateLimit(resourceId: string): RateLimitResult {
  const policy = getEnvironmentPolicy();

  if (!_switches.enrichment_enabled) {
    return { allowed: false, reason: 'Enrichment disabled via kill switch' };
  }

  // Concurrency check
  if (_rateState.activeJobs.size >= policy.maxConcurrentEnrich) {
    return { allowed: false, reason: `Max concurrent jobs reached (${policy.maxConcurrentEnrich})`, retryAfterMs: 5000 };
  }

  // Per-resource cooldown
  const lastAttempt = _rateState.perResourceCooldowns.get(resourceId);
  if (lastAttempt) {
    const elapsed = Date.now() - lastAttempt;
    if (elapsed < PER_RESOURCE_COOLDOWN_MS) {
      return { allowed: false, reason: 'Per-resource cooldown active', retryAfterMs: PER_RESOURCE_COOLDOWN_MS - elapsed };
    }
  }

  // Retry storm prevention
  const now = Date.now();
  const windowStart = now - policy.retryWindowMs;
  _rateState.retryTimestamps = _rateState.retryTimestamps.filter(t => t > windowStart);
  if (_rateState.retryTimestamps.length >= policy.maxRetriesPerWindow) {
    return { allowed: false, reason: `Retry storm prevention: ${_rateState.retryTimestamps.length} retries in window`, retryAfterMs: policy.retryWindowMs };
  }

  return { allowed: true };
}

export function acquireJobSlot(resourceId: string): boolean {
  const check = checkRateLimit(resourceId);
  if (!check.allowed) return false;
  _rateState.activeJobs.add(resourceId);
  _rateState.perResourceCooldowns.set(resourceId, Date.now());
  return true;
}

export function releaseJobSlot(resourceId: string): void {
  _rateState.activeJobs.delete(resourceId);
}

export function recordRetryAttempt(): void {
  _rateState.retryTimestamps.push(Date.now());
}

export function getActiveJobCount(): number {
  return _rateState.activeJobs.size;
}

export function getRateLimitStats(): { activeJobs: number; retriesInWindow: number; cooldownCount: number } {
  const policy = getEnvironmentPolicy();
  const windowStart = Date.now() - policy.retryWindowMs;
  return {
    activeJobs: _rateState.activeJobs.size,
    retriesInWindow: _rateState.retryTimestamps.filter(t => t > windowStart).length,
    cooldownCount: _rateState.perResourceCooldowns.size,
  };
}

// ═══════════════════════════════════════════════════════════
// SECTION 4 — Cross-Session Idempotency
// ═══════════════════════════════════════════════════════════

const LOCK_STORAGE_KEY = 'resource_enrich_locks';
const LOCK_TTL_MS = 5 * 60_000; // 5 minutes

interface LockEntry {
  resourceId: string;
  acquiredAt: number;
  sessionId: string;
}

function getSessionId(): string {
  if (typeof sessionStorage === 'undefined') return 'server';
  let id = sessionStorage.getItem('_session_id');
  if (!id) {
    id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    sessionStorage.setItem('_session_id', id);
  }
  return id;
}

function readLocks(): LockEntry[] {
  try {
    const raw = localStorage.getItem(LOCK_STORAGE_KEY);
    if (!raw) return [];
    const locks: LockEntry[] = JSON.parse(raw);
    // Prune expired
    const now = Date.now();
    return locks.filter(l => now - l.acquiredAt < LOCK_TTL_MS);
  } catch { return []; }
}

function writeLocks(locks: LockEntry[]): void {
  try { localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify(locks)); } catch { /* quota */ }
}

export function acquireCrossSessionLock(resourceId: string): boolean {
  const locks = readLocks();
  const existing = locks.find(l => l.resourceId === resourceId);
  if (existing && existing.sessionId !== getSessionId()) {
    log.warn('Cross-session lock conflict', { resourceId, heldBy: existing.sessionId });
    return false;
  }
  if (existing) return true; // already held by this session
  locks.push({ resourceId, acquiredAt: Date.now(), sessionId: getSessionId() });
  writeLocks(locks);
  return true;
}

export function releaseCrossSessionLock(resourceId: string): void {
  const locks = readLocks().filter(l => l.resourceId !== resourceId);
  writeLocks(locks);
}

export function releaseAllSessionLocks(): void {
  const sid = getSessionId();
  const locks = readLocks().filter(l => l.sessionId !== sid);
  writeLocks(locks);
}

// ═══════════════════════════════════════════════════════════
// SECTION 5 — Read-Time Validation & Hard Downstream Firewall
// ═══════════════════════════════════════════════════════════

export interface GateResult {
  allowed: boolean;
  resource: ResourceForTrust | null;
  reason: string;
  trustStatus?: TrustStatus;
  trustScore?: number;
}

/**
 * THE mandatory gate function. Every downstream consumer MUST call this.
 * Returns `allowed: false` with a reason if the resource is not eligible.
 */
export function gateForPurpose(
  resource: ResourceForTrust,
  purpose: DownstreamPurpose,
  override?: TrustOverride | null,
): GateResult {
  // Kill switch bypass
  if (!_switches.downstream_trust_enforcement_enabled) {
    return { allowed: true, resource, reason: 'Trust enforcement disabled' };
  }

  // Quarantine hard block (except library_display)
  if (resource.enrichment_status === 'quarantined' && purpose !== 'library_display') {
    log.warn('Firewall BLOCKED quarantined resource', { id: resource.id, purpose });
    return { allowed: false, resource: null, reason: 'Resource is quarantined', trustStatus: 'quarantined', trustScore: 0 };
  }

  // Full assessment
  const trustScore = computeTrustScore(resource);
  const trustStatus = classifyTrustStatus(trustScore, resource, override);
  const eligibility = computeEligibility(trustStatus, trustScore, resource, override);

  if (!eligibility[purpose]) {
    log.debug('Firewall BLOCKED resource', { id: resource.id, purpose, trustStatus, score: trustScore.overall });
    return {
      allowed: false,
      resource: null,
      reason: `Trust status "${trustStatus}" (score ${trustScore.overall}) not eligible for ${purpose}`,
      trustStatus,
      trustScore: trustScore.overall,
    };
  }

  return { allowed: true, resource, reason: 'Passed', trustStatus, trustScore: trustScore.overall };
}

/**
 * Filter a list of resources for a specific purpose.
 * Returns only those that pass the firewall.
 */
export function filterForPurpose(
  resources: ResourceForTrust[],
  purpose: DownstreamPurpose,
): { eligible: ResourceForTrust[]; blocked: number; reasons: Map<string, string> } {
  const eligible: ResourceForTrust[] = [];
  const reasons = new Map<string, string>();
  let blocked = 0;

  for (const r of resources) {
    const gate = gateForPurpose(r, purpose);
    if (gate.allowed) {
      eligible.push(r);
    } else {
      blocked++;
      reasons.set(r.id, gate.reason);
    }
  }

  return { eligible, blocked, reasons };
}

// ═══════════════════════════════════════════════════════════
// SECTION 6 — Per-Resource Event Timeline
// ═══════════════════════════════════════════════════════════

export type TimelineEventType =
  | 'queued' | 'preflight_start' | 'preflight_result'
  | 'enrich_attempt' | 'enrich_success' | 'enrich_failure'
  | 'fallback_triggered' | 'verification_result'
  | 'trust_assigned' | 'eligibility_changed'
  | 'quarantine_enter' | 'quarantine_exit'
  | 'reconciliation_check' | 'reconciliation_action'
  | 'rate_limited' | 'lock_acquired' | 'lock_released'
  | 'contamination_rollback' | 'trust_decay'
  | 'downstream_blocked' | 'manual_override';

export interface TimelineEvent {
  timestamp: string;
  type: TimelineEventType;
  detail: string;
  metadata?: Record<string, unknown>;
}

const TIMELINE_STORAGE_KEY = 'resource_timelines';
const MAX_EVENTS_PER_RESOURCE = 50;

function readTimelines(): Record<string, TimelineEvent[]> {
  try {
    const raw = localStorage.getItem(TIMELINE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeTimelines(data: Record<string, TimelineEvent[]>): void {
  try { localStorage.setItem(TIMELINE_STORAGE_KEY, JSON.stringify(data)); } catch { /* quota */ }
}

export function appendTimelineEvent(
  resourceId: string,
  type: TimelineEventType,
  detail: string,
  metadata?: Record<string, unknown>,
): void {
  const timelines = readTimelines();
  const events = timelines[resourceId] ?? [];
  events.push({ timestamp: new Date().toISOString(), type, detail, metadata });
  // Keep only last N
  timelines[resourceId] = events.slice(-MAX_EVENTS_PER_RESOURCE);
  writeTimelines(timelines);
}

export function getTimeline(resourceId: string): TimelineEvent[] {
  return readTimelines()[resourceId] ?? [];
}

export function clearTimeline(resourceId: string): void {
  const timelines = readTimelines();
  delete timelines[resourceId];
  writeTimelines(timelines);
}

// ═══════════════════════════════════════════════════════════
// SECTION 7 — Trust Decay
// ═══════════════════════════════════════════════════════════

const DECAY_RATE_PER_DAY = 0.15;  // trust points lost per day past freshness
const USAGE_REINFORCEMENT = 2;     // trust points gained per downstream use
const MAX_USAGE_REINFORCEMENT = 10;

export interface DecayResult {
  originalScore: number;
  decayedScore: number;
  decayAmount: number;
  reinforcementAmount: number;
  reason: string;
}

export function computeTrustDecay(resource: ResourceForTrust): DecayResult {
  const baseScore = computeTrustScore(resource);
  let decayAmount = 0;
  let reinforcementAmount = 0;

  // Time-based decay
  if (resource.enriched_at) {
    const daysSince = Math.floor((Date.now() - new Date(resource.enriched_at).getTime()) / 86400000);
    if (daysSince > 90) {
      decayAmount = Math.min(30, Math.floor((daysSince - 90) * DECAY_RATE_PER_DAY));
    }
  } else {
    decayAmount = 15; // never enriched
  }

  // Usage reinforcement
  if (resource.downstream_use_count && resource.downstream_use_count > 0) {
    reinforcementAmount = Math.min(MAX_USAGE_REINFORCEMENT, resource.downstream_use_count * USAGE_REINFORCEMENT);
  }

  const decayedScore = Math.max(0, baseScore.overall - decayAmount + reinforcementAmount);

  const reason = decayAmount > 0
    ? `Decayed ${decayAmount} points from staleness${reinforcementAmount > 0 ? `, reinforced +${reinforcementAmount} from usage` : ''}`
    : reinforcementAmount > 0
      ? `Reinforced +${reinforcementAmount} from downstream usage`
      : 'No decay or reinforcement';

  return { originalScore: baseScore.overall, decayedScore, decayAmount, reinforcementAmount, reason };
}

// ═══════════════════════════════════════════════════════════
// SECTION 8 — Downstream Contamination Tracking
// ═══════════════════════════════════════════════════════════

export interface ContaminationRecord {
  resourceId: string;
  affectedArtifacts: Array<{
    artifactType: 'playbook' | 'recommendation' | 'dave_grounding' | 'insight' | 'strategy';
    artifactId?: string;
    markedStaleAt: string;
    reason: string;
  }>;
}

const CONTAMINATION_KEY = 'resource_contamination_log';

function readContamination(): ContaminationRecord[] {
  try {
    const raw = localStorage.getItem(CONTAMINATION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeContamination(records: ContaminationRecord[]): void {
  try { localStorage.setItem(CONTAMINATION_KEY, JSON.stringify(records.slice(-200))); } catch { /* quota */ }
}

export function markDownstreamContaminated(
  resourceId: string,
  reason: string,
  affectedTypes: Array<'playbook' | 'recommendation' | 'dave_grounding' | 'insight' | 'strategy'>,
): ContaminationRecord {
  const record: ContaminationRecord = {
    resourceId,
    affectedArtifacts: affectedTypes.map(t => ({
      artifactType: t,
      markedStaleAt: new Date().toISOString(),
      reason,
    })),
  };

  const records = readContamination();
  records.push(record);
  writeContamination(records);

  appendTimelineEvent(resourceId, 'contamination_rollback', reason, {
    affectedTypes,
  });

  log.info('Downstream contamination marked', { resourceId, reason, affectedTypes });
  return record;
}

export function getContaminationLog(): ContaminationRecord[] {
  return readContamination();
}

export function getContaminationForResource(resourceId: string): ContaminationRecord | undefined {
  return readContamination().find(r => r.resourceId === resourceId);
}

// ═══════════════════════════════════════════════════════════
// SECTION 9 — Contradiction Detection (lightweight)
// ═══════════════════════════════════════════════════════════

export interface ContradictionResult {
  hasContradiction: boolean;
  pairs: Array<{ resourceA: string; resourceB: string; reason: string }>;
}

/**
 * Lightweight contradiction detection based on tag/category overlap
 * with divergent trust statuses or conflicting descriptions.
 */
export function detectContradictions(resources: ResourceForTrust[]): ContradictionResult {
  const pairs: ContradictionResult['pairs'] = [];

  // Group by tags/category for comparison
  const enriched = resources.filter(r => r.enrichment_status === 'deep_enriched' && r.description);
  if (enriched.length < 2) return { hasContradiction: false, pairs };

  // Simple heuristic: same resource_type resources with very different quality
  for (let i = 0; i < enriched.length; i++) {
    for (let j = i + 1; j < Math.min(enriched.length, i + 20); j++) {
      const a = enriched[i];
      const b = enriched[j];

      if (a.resource_type !== b.resource_type) continue;

      const scoreA = a.last_quality_score ?? 0;
      const scoreB = b.last_quality_score ?? 0;

      // Large quality divergence in same type = potential conflict
      if (Math.abs(scoreA - scoreB) > 40) {
        pairs.push({
          resourceA: a.id,
          resourceB: b.id,
          reason: `Same type "${a.resource_type}" but quality divergence: ${scoreA} vs ${scoreB}`,
        });
      }
    }
  }

  return { hasContradiction: pairs.length > 0, pairs };
}

// ═══════════════════════════════════════════════════════════
// SECTION 10 — Dashboard Stats
// ═══════════════════════════════════════════════════════════

export interface FirewallStats {
  blockedDownstreamCount: number;
  staleTrustedCount: number;
  quarantinedCount: number;
  contradictionCount: number;
  rateLimitActivations: number;
  contaminationRollbacks: number;
  activeJobs: number;
  retriesInWindow: number;
}

export function computeFirewallStats(resources: ResourceForTrust[]): FirewallStats {
  let blockedDownstreamCount = 0;
  let staleTrustedCount = 0;
  let quarantinedCount = 0;

  const strategicPurposes: DownstreamPurpose[] = ['dave_grounding', 'playbook_generation', 'strategic_recommendations'];

  for (const r of resources) {
    const assessment = assessTrust(r);

    if (assessment.trustStatus === 'quarantined') quarantinedCount++;
    if (assessment.trustStatus === 'stale' && r.enrichment_status === 'deep_enriched') staleTrustedCount++;

    for (const purpose of strategicPurposes) {
      if (!assessment.eligibility[purpose] && r.enrichment_status === 'deep_enriched') {
        blockedDownstreamCount++;
        break;
      }
    }
  }

  const contradictions = detectContradictions(resources);
  const rateStats = getRateLimitStats();
  const contamination = getContaminationLog();

  return {
    blockedDownstreamCount,
    staleTrustedCount,
    quarantinedCount,
    contradictionCount: contradictions.pairs.length,
    rateLimitActivations: rateStats.retriesInWindow,
    contaminationRollbacks: contamination.length,
    activeJobs: rateStats.activeJobs,
    retriesInWindow: rateStats.retriesInWindow,
  };
}

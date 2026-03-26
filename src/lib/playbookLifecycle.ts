/**
 * Playbook Lifecycle & Trust Engine
 *
 * Canonical model, trust scoring, eligibility gating, clustering,
 * dependency tracking, and reconciliation for the self-healing playbook OS.
 *
 * Playbooks are living strategic assets derived from resource clusters.
 */

import { createLogger } from './logger';
import type { TrustStatus as ResourceTrustStatus, TrustScore as ResourceTrustScore } from './resourceTrust';

const log = createLogger('PlaybookLifecycle');

// ── Canonical Playbook Statuses ────────────────────────────
export const PLAYBOOK_STATUSES = [
  'candidate',
  'draft_generated',
  'awaiting_validation',
  'active',
  'active_limited',
  'stale',
  'needs_regeneration',
  'quarantined',
  'retired',
] as const;

export type PlaybookStatus = typeof PLAYBOOK_STATUSES[number];

// ── Valid state transitions ────────────────────────────────
const VALID_TRANSITIONS: Record<PlaybookStatus, PlaybookStatus[]> = {
  candidate:            ['draft_generated', 'retired'],
  draft_generated:      ['awaiting_validation', 'active', 'active_limited', 'retired'],
  awaiting_validation:  ['active', 'active_limited', 'needs_regeneration', 'quarantined', 'retired'],
  active:               ['active_limited', 'stale', 'needs_regeneration', 'quarantined', 'retired'],
  active_limited:       ['active', 'stale', 'needs_regeneration', 'quarantined', 'retired'],
  stale:                ['needs_regeneration', 'active', 'active_limited', 'retired', 'quarantined'],
  needs_regeneration:   ['draft_generated', 'active', 'active_limited', 'retired', 'quarantined'],
  quarantined:          ['needs_regeneration', 'retired', 'candidate'],
  retired:              ['candidate'], // can be revived
};

export function isValidPlaybookTransition(from: PlaybookStatus, to: PlaybookStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Playbook Trust ─────────────────────────────────────────
export type PlaybookTrustStatus = 'trusted' | 'limited' | 'experimental' | 'stale' | 'quarantined' | 'retired';

export interface PlaybookTrustScore {
  overall: number;            // 0-100
  evidenceStrength: number;   // 0-25: avg trust of supporting resources
  evidenceDiversity: number;  // 0-25: number of distinct supporting resources
  usageSuccess: number;       // 0-25: acceptance rate + downstream usage
  stability: number;          // 0-25: low contradiction, consistent regeneration
}

// ── Downstream Purposes ────────────────────────────────────
export type PlaybookPurpose =
  | 'dave_suggestion'
  | 'dave_grounding'
  | 'roleplay_generation'
  | 'prep_recommendations'
  | 'weekly_coaching'
  | 'strategic_recommendations'
  | 'deal_intelligence'
  | 'library_display';

// ── Canonical Playbook Model ───────────────────────────────
export interface PlaybookModel {
  id: string;
  title: string;
  problem_type: string;
  trigger_conditions: string;
  use_cases: string[];
  target_personas: string[];
  applicable_stages: string[];
  talk_tracks: string[];
  questions: string[];
  objection_handles: string[];
  pressure_tactics: string[];
  minimum_effective_version: string;
  success_criteria: string;
  failure_consequences: string[];
  common_mistakes: string[];
  what_great_looks_like: string[];
  anti_patterns: string[];

  // Trust & lifecycle
  confidence_score: number;
  trust_status: PlaybookTrustStatus;
  trust_score: PlaybookTrustScore;
  status: PlaybookStatus;
  version: number;

  // Usage
  usage_count: number;
  acceptance_rate: number;

  // Provenance
  derived_from_resource_ids: string[];
  derived_from_cluster_id: string | null;

  // Timestamps
  last_generated_at: string;
  last_reconciled_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Resource Cluster ───────────────────────────────────────
export interface ResourceCluster {
  id: string;
  theme: string;               // e.g. "create_urgency", "competitor_defense"
  problem_type: string;
  resource_ids: string[];
  resource_weights: Record<string, number>; // resourceId → relevance 0-1
  stage_relevance: string[];
  persona_relevance: string[];
  support_strength: number;    // 0-100
  coherence_score: number;     // 0-100: how internally consistent
  last_updated: string;
}

// ── Cluster Themes (canonical) ─────────────────────────────
export const CLUSTER_THEMES = [
  'create_urgency',
  'recover_stalled_deal',
  'pricing_pushback',
  'early_credibility',
  'competitor_defense',
  'next_step_control',
  'multithreading',
  'discovery_depth',
  'demo_execution',
  'champion_building',
  'negotiation_leverage',
  'renewal_expansion',
  'objection_handling',
  'closing_commitment',
] as const;

export type ClusterTheme = typeof CLUSTER_THEMES[number];

// ── Trust Scoring ──────────────────────────────────────────

const TRUST_THRESHOLDS = {
  TRUSTED_MIN: 70,
  LIMITED_MIN: 45,
  EXPERIMENTAL_MIN: 20,
  STALE_DECAY_DAYS: 90,
  MIN_RESOURCES_FOR_TRUSTED: 3,
  MIN_RESOURCES_FOR_LIMITED: 2,
};

export function scorePlaybookTrust(
  supportingResourceTrusts: { trustScore: number; trustStatus: ResourceTrustStatus }[],
  usageData: { usageCount: number; acceptanceRate: number; roleplaysCompleted: number },
  contradictionCount: number,
  regenerationCount: number,
  lastGeneratedAt: string | null,
): PlaybookTrustScore {
  // Evidence strength: avg resource trust
  const avgResourceTrust = supportingResourceTrusts.length > 0
    ? supportingResourceTrusts.reduce((s, r) => s + r.trustScore, 0) / supportingResourceTrusts.length
    : 0;
  const evidenceStrength = Math.min(25, (avgResourceTrust / 100) * 25);

  // Evidence diversity
  const diversityRaw = Math.min(supportingResourceTrusts.length, 6) / 6;
  const trustedCount = supportingResourceTrusts.filter(r => r.trustStatus === 'trusted').length;
  const diversityBonus = Math.min(trustedCount, 3) / 3;
  const evidenceDiversity = Math.min(25, (diversityRaw * 0.6 + diversityBonus * 0.4) * 25);

  // Usage success
  const usageRaw = Math.min(usageData.usageCount, 20) / 20;
  const acceptanceRaw = usageData.acceptanceRate / 100;
  const roleplayBonus = Math.min(usageData.roleplaysCompleted, 5) / 5;
  const usageSuccess = Math.min(25, (usageRaw * 0.3 + acceptanceRaw * 0.5 + roleplayBonus * 0.2) * 25);

  // Stability
  const contradictionPenalty = Math.min(contradictionCount * 5, 15);
  const regenerationPenalty = regenerationCount > 3 ? Math.min((regenerationCount - 3) * 3, 10) : 0;
  let stabilityRaw = 25 - contradictionPenalty - regenerationPenalty;

  // Freshness decay
  if (lastGeneratedAt) {
    const daysSince = (Date.now() - new Date(lastGeneratedAt).getTime()) / 86400000;
    if (daysSince > TRUST_THRESHOLDS.STALE_DECAY_DAYS) {
      stabilityRaw -= Math.min((daysSince - TRUST_THRESHOLDS.STALE_DECAY_DAYS) / 30 * 5, 15);
    }
  }
  const stability = Math.max(0, Math.min(25, stabilityRaw));

  const overall = Math.round(evidenceStrength + evidenceDiversity + usageSuccess + stability);

  return { overall, evidenceStrength, evidenceDiversity, usageSuccess, stability };
}

export function classifyPlaybookTrust(
  score: PlaybookTrustScore,
  resourceCount: number,
  status: PlaybookStatus,
): PlaybookTrustStatus {
  if (status === 'retired') return 'retired';
  if (status === 'quarantined') return 'quarantined';

  if (score.overall >= TRUST_THRESHOLDS.TRUSTED_MIN && resourceCount >= TRUST_THRESHOLDS.MIN_RESOURCES_FOR_TRUSTED) {
    return 'trusted';
  }
  if (score.overall >= TRUST_THRESHOLDS.LIMITED_MIN && resourceCount >= TRUST_THRESHOLDS.MIN_RESOURCES_FOR_LIMITED) {
    return 'limited';
  }
  if (score.overall >= TRUST_THRESHOLDS.EXPERIMENTAL_MIN) {
    return 'experimental';
  }
  if (score.stability < 5) {
    return 'stale';
  }
  return 'experimental';
}

// ── Purpose Eligibility ────────────────────────────────────

const PURPOSE_REQUIREMENTS: Record<PlaybookPurpose, {
  minTrust: PlaybookTrustStatus[];
  minStatuses: PlaybookStatus[];
  minScore: number;
}> = {
  dave_suggestion:           { minTrust: ['trusted', 'limited'], minStatuses: ['active', 'active_limited'], minScore: 50 },
  dave_grounding:            { minTrust: ['trusted'], minStatuses: ['active'], minScore: 65 },
  roleplay_generation:       { minTrust: ['trusted', 'limited'], minStatuses: ['active', 'active_limited'], minScore: 45 },
  prep_recommendations:      { minTrust: ['trusted', 'limited'], minStatuses: ['active', 'active_limited'], minScore: 50 },
  weekly_coaching:           { minTrust: ['trusted'], minStatuses: ['active'], minScore: 60 },
  strategic_recommendations: { minTrust: ['trusted'], minStatuses: ['active'], minScore: 70 },
  deal_intelligence:         { minTrust: ['trusted', 'limited'], minStatuses: ['active', 'active_limited'], minScore: 55 },
  library_display:           { minTrust: ['trusted', 'limited', 'experimental'], minStatuses: ['active', 'active_limited', 'draft_generated', 'stale'], minScore: 0 },
};

export function isPlaybookEligible(
  playbook: { trust_status: PlaybookTrustStatus; status: PlaybookStatus; trust_score: PlaybookTrustScore },
  purpose: PlaybookPurpose,
): boolean {
  const req = PURPOSE_REQUIREMENTS[purpose];
  if (!req) return false;
  if (!req.minTrust.includes(playbook.trust_status)) return false;
  if (!req.minStatuses.includes(playbook.status)) return false;
  if (playbook.trust_score.overall < req.minScore) return false;
  return true;
}

export function getPlaybookEligibility(
  playbook: { trust_status: PlaybookTrustStatus; status: PlaybookStatus; trust_score: PlaybookTrustScore },
): Record<PlaybookPurpose, boolean> {
  const result = {} as Record<PlaybookPurpose, boolean>;
  for (const purpose of Object.keys(PURPOSE_REQUIREMENTS) as PlaybookPurpose[]) {
    result[purpose] = isPlaybookEligible(playbook, purpose);
  }
  return result;
}

// ── Clustering Logic ───────────────────────────────────────

interface ClusterableResource {
  id: string;
  tags: string[];
  use_cases: string[];
  summary: string;
  trust_status: ResourceTrustStatus;
  trust_score: number;
}

const THEME_KEYWORDS: Record<string, string[]> = {
  create_urgency: ['urgency', 'urgent', 'deadline', 'time-sensitive', 'compelling event', 'fomo', 'cost of delay', 'inaction'],
  recover_stalled_deal: ['stall', 'stalled', 'ghost', 'dark', 'no response', 'revive', 'stuck', 're-engage'],
  pricing_pushback: ['pricing', 'price', 'discount', 'budget', 'cost', 'roi', 'value', 'expensive', 'negotiate price'],
  early_credibility: ['credibility', 'trust', 'rapport', 'first impression', 'opener', 'intro', 'icebreaker'],
  competitor_defense: ['competitor', 'competition', 'versus', 'alternative', 'differentiat', 'why us', 'switch'],
  next_step_control: ['next step', 'follow up', 'commitment', 'action item', 'close the loop', 'calendar'],
  multithreading: ['multithread', 'multi-thread', 'stakeholder', 'champion', 'economic buyer', 'consensus', 'coalition'],
  discovery_depth: ['discovery', 'question', 'pain', 'challenge', 'problem', 'need', 'gap', 'current state'],
  demo_execution: ['demo', 'presentation', 'show', 'walk through', 'product', 'capability'],
  champion_building: ['champion', 'advocate', 'internal sponsor', 'mobilize', 'coach'],
  negotiation_leverage: ['negotiat', 'leverage', 'concession', 'term', 'contract', 'close'],
  renewal_expansion: ['renewal', 'expand', 'upsell', 'cross-sell', 'retention', 'churn'],
  objection_handling: ['objection', 'pushback', 'concern', 'hesitat', 'resistance', 'but'],
  closing_commitment: ['close', 'commit', 'sign', 'decision', 'go-live', 'final'],
};

export function clusterResources(resources: ClusterableResource[]): ResourceCluster[] {
  const clusters: ResourceCluster[] = [];
  const clusterMap = new Map<string, { ids: Set<string>; weights: Map<string, number>; stages: Set<string>; personas: Set<string> }>();

  for (const resource of resources) {
    // Only cluster trusted/limited resources
    if (resource.trust_status !== 'trusted' && resource.trust_status !== 'limited') continue;

    const textBlob = [
      ...resource.tags,
      ...resource.use_cases,
      resource.summary,
    ].join(' ').toLowerCase();

    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      const matchCount = keywords.filter(kw => textBlob.includes(kw)).length;
      if (matchCount < 2) continue; // need at least 2 keyword matches

      const relevance = Math.min(1, matchCount / (keywords.length * 0.6));

      if (!clusterMap.has(theme)) {
        clusterMap.set(theme, { ids: new Set(), weights: new Map(), stages: new Set(), personas: new Set() });
      }
      const c = clusterMap.get(theme)!;
      c.ids.add(resource.id);
      c.weights.set(resource.id, Math.max(c.weights.get(resource.id) ?? 0, relevance));
    }
  }

  for (const [theme, data] of clusterMap.entries()) {
    if (data.ids.size < 1) continue;

    const resourceList = resources.filter(r => data.ids.has(r.id));
    const avgTrust = resourceList.reduce((s, r) => s + r.trust_score, 0) / resourceList.length;
    const supportStrength = Math.min(100, (data.ids.size / 4) * 50 + avgTrust * 0.5);

    clusters.push({
      id: `cluster_${theme}`,
      theme,
      problem_type: theme.replace(/_/g, ' '),
      resource_ids: [...data.ids],
      resource_weights: Object.fromEntries(data.weights),
      stage_relevance: [],
      persona_relevance: [],
      support_strength: Math.round(supportStrength),
      coherence_score: Math.round(avgTrust),
      last_updated: new Date().toISOString(),
    });
  }

  return clusters.sort((a, b) => b.support_strength - a.support_strength);
}

// ── Regeneration Triggers ──────────────────────────────────

export interface RegenerationTrigger {
  playbookId: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  triggeredAt: string;
}

export function detectRegenerationNeeds(
  playbook: PlaybookModel,
  currentCluster: ResourceCluster | null,
  usageData: { usageCount: number; acceptanceRate: number },
): RegenerationTrigger | null {
  // 1. Supporting resources changed materially
  if (currentCluster) {
    const currentIds = new Set(currentCluster.resource_ids);
    const oldIds = new Set(playbook.derived_from_resource_ids);
    const newResources = currentCluster.resource_ids.filter(id => !oldIds.has(id));
    const removedResources = playbook.derived_from_resource_ids.filter(id => !currentIds.has(id));

    if (newResources.length >= 2 || removedResources.length >= 2) {
      return {
        playbookId: playbook.id,
        reason: `Cluster evidence changed: +${newResources.length} new, -${removedResources.length} removed resources`,
        priority: 'high',
        triggeredAt: new Date().toISOString(),
      };
    }
  }

  // 2. Trust dropped below threshold
  if (playbook.trust_status === 'stale' && playbook.status === 'active') {
    return {
      playbookId: playbook.id,
      reason: 'Trust degraded to stale while still active',
      priority: 'high',
      triggeredAt: new Date().toISOString(),
    };
  }

  // 3. Acceptance rate dropped sharply
  if (usageData.usageCount >= 5 && usageData.acceptanceRate < 20) {
    return {
      playbookId: playbook.id,
      reason: `Low acceptance rate (${usageData.acceptanceRate}%) after ${usageData.usageCount} uses`,
      priority: 'medium',
      triggeredAt: new Date().toISOString(),
    };
  }

  // 4. Age-based staleness
  if (playbook.last_generated_at) {
    const daysSince = (Date.now() - new Date(playbook.last_generated_at).getTime()) / 86400000;
    if (daysSince > 120) {
      return {
        playbookId: playbook.id,
        reason: `Not regenerated in ${Math.round(daysSince)} days`,
        priority: 'low',
        triggeredAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

// ── Decomposition / Merge Detection ────────────────────────

export interface DecompositionSuggestion {
  type: 'split' | 'merge' | 'quarantine';
  playbookIds: string[];
  reason: string;
}

export function detectDecompositionNeeds(playbooks: PlaybookModel[]): DecompositionSuggestion[] {
  const suggestions: DecompositionSuggestion[] = [];

  // Detect overly similar playbooks (merge candidates)
  for (let i = 0; i < playbooks.length; i++) {
    for (let j = i + 1; j < playbooks.length; j++) {
      const a = playbooks[i];
      const b = playbooks[j];

      // Same problem_type = merge candidate
      if (a.problem_type.toLowerCase() === b.problem_type.toLowerCase()) {
        suggestions.push({
          type: 'merge',
          playbookIds: [a.id, b.id],
          reason: `Both address "${a.problem_type}" — merge into one stronger playbook`,
        });
      }

      // High overlap in derived resources
      const aSet = new Set(a.derived_from_resource_ids);
      const overlap = b.derived_from_resource_ids.filter(id => aSet.has(id)).length;
      const maxLen = Math.max(a.derived_from_resource_ids.length, b.derived_from_resource_ids.length);
      if (maxLen > 0 && overlap / maxLen > 0.7) {
        suggestions.push({
          type: 'merge',
          playbookIds: [a.id, b.id],
          reason: `70%+ resource overlap — likely duplicates`,
        });
      }
    }
  }

  // Detect overly broad playbooks (split candidates)
  for (const p of playbooks) {
    if (p.applicable_stages.length >= 5 && p.target_personas.length >= 4) {
      suggestions.push({
        type: 'split',
        playbookIds: [p.id],
        reason: `Covers ${p.applicable_stages.length} stages and ${p.target_personas.length} personas — too broad`,
      });
    }
    if (p.talk_tracks.length > 8) {
      suggestions.push({
        type: 'split',
        playbookIds: [p.id],
        reason: `${p.talk_tracks.length} talk tracks — unfocused, should be split by sub-problem`,
      });
    }
  }

  // Detect low-coherence (quarantine)
  for (const p of playbooks) {
    if (p.confidence_score < 20 && p.usage_count > 3 && p.acceptance_rate < 10) {
      suggestions.push({
        type: 'quarantine',
        playbookIds: [p.id],
        reason: `Low confidence (${p.confidence_score}), poor acceptance (${p.acceptance_rate}%) — quarantine`,
      });
    }
  }

  return suggestions;
}

// ── Dependency Graph ───────────────────────────────────────

export interface PlaybookDependency {
  playbookId: string;
  upstreamResourceIds: string[];
  downstreamArtifacts: { type: string; id: string; stale: boolean }[];
}

export function buildDependencyGraph(
  playbooks: PlaybookModel[],
  resourceStatuses: Map<string, ResourceTrustStatus>,
): PlaybookDependency[] {
  return playbooks.map(p => {
    const staleUpstream = p.derived_from_resource_ids.filter(rid => {
      const status = resourceStatuses.get(rid);
      return status === 'stale' || status === 'quarantined' || !status;
    });

    return {
      playbookId: p.id,
      upstreamResourceIds: p.derived_from_resource_ids,
      downstreamArtifacts: [
        { type: 'roleplay_scenario', id: `roleplay_${p.id}`, stale: staleUpstream.length > 0 },
        { type: 'recommendation', id: `rec_${p.id}`, stale: staleUpstream.length > 0 },
      ],
    };
  });
}

// ── Playbook Reconciliation ────────────────────────────────

export interface PlaybookReconciliationReport {
  total: number;
  healthy: number;
  needsRegeneration: number;
  stale: number;
  quarantined: number;
  retired: number;
  mergeCandidate: number;
  splitCandidate: number;
  contaminatedDownstream: number;
  details: { id: string; title: string; status: PlaybookStatus; issue: string }[];
  timestamp: string;
}

export function reconcilePlaybooks(
  playbooks: PlaybookModel[],
  resourceStatuses: Map<string, ResourceTrustStatus>,
  usageMap: Map<string, { usageCount: number; acceptanceRate: number }>,
): PlaybookReconciliationReport {
  const report: PlaybookReconciliationReport = {
    total: playbooks.length,
    healthy: 0,
    needsRegeneration: 0,
    stale: 0,
    quarantined: 0,
    retired: 0,
    mergeCandidate: 0,
    splitCandidate: 0,
    contaminatedDownstream: 0,
    details: [],
    timestamp: new Date().toISOString(),
  };

  const decomps = detectDecompositionNeeds(playbooks);
  const mergeIds = new Set(decomps.filter(d => d.type === 'merge').flatMap(d => d.playbookIds));
  const splitIds = new Set(decomps.filter(d => d.type === 'split').flatMap(d => d.playbookIds));

  for (const p of playbooks) {
    if (p.status === 'retired') { report.retired++; continue; }
    if (p.status === 'quarantined') { report.quarantined++; continue; }

    // Check upstream contamination
    const staleUpstream = p.derived_from_resource_ids.filter(rid => {
      const s = resourceStatuses.get(rid);
      return s === 'stale' || s === 'quarantined' || !s;
    });
    if (staleUpstream.length > 0) {
      report.contaminatedDownstream++;
      report.details.push({ id: p.id, title: p.title, status: p.status, issue: `${staleUpstream.length} upstream resources degraded` });
    }

    // Check merge/split
    if (mergeIds.has(p.id)) report.mergeCandidate++;
    if (splitIds.has(p.id)) report.splitCandidate++;

    // Check regeneration needs
    const usage = usageMap.get(p.id) ?? { usageCount: 0, acceptanceRate: 0 };
    const trigger = detectRegenerationNeeds(p, null, usage);
    if (trigger) {
      report.needsRegeneration++;
      report.details.push({ id: p.id, title: p.title, status: p.status, issue: trigger.reason });
    } else if (p.trust_status === 'stale') {
      report.stale++;
    } else {
      report.healthy++;
    }
  }

  return report;
}

// ── Human Override Controls ────────────────────────────────

export interface PlaybookOverride {
  pin?: boolean;
  suppress?: boolean;
  forceRegenerate?: boolean;
  forceSplitReview?: boolean;
  excludeFromDave?: boolean;
  excludeFromRoleplay?: boolean;
  markStrategicPriority?: boolean;
}

export function applyPlaybookOverride(
  playbook: PlaybookModel,
  override: PlaybookOverride,
): { newStatus: PlaybookStatus; newTrustStatus: PlaybookTrustStatus } {
  let newStatus = playbook.status;
  let newTrustStatus = playbook.trust_status;

  if (override.suppress) {
    newStatus = 'retired';
    newTrustStatus = 'retired';
  }
  if (override.forceRegenerate) {
    newStatus = 'needs_regeneration';
  }

  return { newStatus, newTrustStatus };
}

// ── Usefulness Feedback Model ──────────────────────────────

export interface PlaybookUsageMetrics {
  shownCount: number;
  acceptedCount: number;
  ignoredCount: number;
  usedInDave: number;
  usedInRoleplay: number;
  usedInPrep: number;
  positiveFeedback: number;
  negativeFeedback: number;
}

export function computeUsefulnessScore(metrics: PlaybookUsageMetrics): number {
  if (metrics.shownCount === 0) return 50; // neutral for unshown

  const acceptanceRate = metrics.acceptedCount / metrics.shownCount;
  const usageDepth = Math.min(
    (metrics.usedInDave + metrics.usedInRoleplay + metrics.usedInPrep) / Math.max(metrics.acceptedCount, 1),
    1
  );
  const feedbackScore = metrics.positiveFeedback > 0
    ? metrics.positiveFeedback / (metrics.positiveFeedback + metrics.negativeFeedback)
    : 0.5;

  return Math.round(
    acceptanceRate * 40 +
    usageDepth * 30 +
    feedbackScore * 30
  );
}

// ── Cluster Readiness Check ────────────────────────────────

const MIN_CLUSTER_SUPPORT = 2;
const MIN_CLUSTER_STRENGTH = 30;

export function isClusterReadyForPlaybook(cluster: ResourceCluster, existingPlaybooks: PlaybookModel[]): boolean {
  if (cluster.resource_ids.length < MIN_CLUSTER_SUPPORT) return false;
  if (cluster.support_strength < MIN_CLUSTER_STRENGTH) return false;

  // Check if a playbook already covers this theme
  const alreadyCovered = existingPlaybooks.some(
    p => p.derived_from_cluster_id === cluster.id && p.status !== 'retired'
  );

  return !alreadyCovered;
}

// ── Version History Entry ──────────────────────────────────

export interface PlaybookVersionEntry {
  version: number;
  generatedAt: string;
  reason: string;
  supportingResourceIds: string[];
  trustScore: number;
  snapshotHash: string;
}

export function computeSnapshotHash(playbook: Pick<PlaybookModel, 'talk_tracks' | 'questions' | 'pressure_tactics' | 'problem_type'>): string {
  const content = [
    playbook.problem_type,
    ...playbook.talk_tracks,
    ...playbook.questions,
    ...playbook.pressure_tactics,
  ].join('|');
  // Simple hash for change detection
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

// ══════════════════════════════════════════════════════════════
// SECTION: Outcome-Driven Learning
// ══════════════════════════════════════════════════════════════

// ── Outcome Tracking Model ────────────────────────────────

export interface PlaybookOutcomeEvent {
  playbookId: string;
  eventType: PlaybookOutcomeEventType;
  dealId?: string;
  accountId?: string;
  stage?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type PlaybookOutcomeEventType =
  | 'stage_progressed'
  | 'deal_stagnation_broken'
  | 'meeting_converted'
  | 'reply_received'
  | 'next_step_adhered'
  | 'deal_won'
  | 'deal_lost';

export interface PlaybookOutcomeScore {
  overall: number;               // 0-100
  stageProgression: number;      // 0-20: moved deals forward
  stagnationReduction: number;   // 0-20: unstuck deals
  meetingConversion: number;     // 0-20: meetings booked/converted
  replyRate: number;             // 0-20: outbound replies
  nextStepAdherence: number;     // 0-10: next steps followed
  winCorrelation: number;        // 0-10: win/loss signal
  sampleSize: number;            // raw count of outcome events
  confidence: 'high' | 'moderate' | 'low' | 'insufficient';
}

const OUTCOME_WEIGHTS: Record<PlaybookOutcomeEventType, { dimension: keyof Omit<PlaybookOutcomeScore, 'overall' | 'sampleSize' | 'confidence'>; value: number }> = {
  stage_progressed:        { dimension: 'stageProgression', value: 4 },
  deal_stagnation_broken:  { dimension: 'stagnationReduction', value: 5 },
  meeting_converted:       { dimension: 'meetingConversion', value: 4 },
  reply_received:          { dimension: 'replyRate', value: 3 },
  next_step_adhered:       { dimension: 'nextStepAdherence', value: 2 },
  deal_won:                { dimension: 'winCorrelation', value: 5 },
  deal_lost:               { dimension: 'winCorrelation', value: -3 },
};

export function computePlaybookOutcomeScore(events: PlaybookOutcomeEvent[]): PlaybookOutcomeScore {
  const score: PlaybookOutcomeScore = {
    overall: 0,
    stageProgression: 0,
    stagnationReduction: 0,
    meetingConversion: 0,
    replyRate: 0,
    nextStepAdherence: 0,
    winCorrelation: 0,
    sampleSize: events.length,
    confidence: 'insufficient',
  };

  if (events.length === 0) return score;

  // Apply recency weighting (30-day half-life)
  const now = Date.now();
  const HALF_LIFE_MS = 30 * 86400000;

  for (const event of events) {
    const ageMs = now - new Date(event.timestamp).getTime();
    const recencyWeight = Math.pow(0.5, ageMs / HALF_LIFE_MS);
    const weight = OUTCOME_WEIGHTS[event.eventType];
    if (!weight) continue;

    const weighted = weight.value * recencyWeight;
    score[weight.dimension] = Math.max(-10, Math.min(
      weight.dimension === 'nextStepAdherence' || weight.dimension === 'winCorrelation' ? 10 : 20,
      (score[weight.dimension] as number) + weighted
    ));
  }

  // Clamp all dimensions to their max
  score.stageProgression = Math.max(0, Math.min(20, score.stageProgression));
  score.stagnationReduction = Math.max(0, Math.min(20, score.stagnationReduction));
  score.meetingConversion = Math.max(0, Math.min(20, score.meetingConversion));
  score.replyRate = Math.max(0, Math.min(20, score.replyRate));
  score.nextStepAdherence = Math.max(0, Math.min(10, score.nextStepAdherence));
  score.winCorrelation = Math.max(0, Math.min(10, score.winCorrelation));

  score.overall = Math.round(
    score.stageProgression + score.stagnationReduction +
    score.meetingConversion + score.replyRate +
    score.nextStepAdherence + score.winCorrelation
  );

  // Confidence based on sample size
  if (events.length >= 10) score.confidence = 'high';
  else if (events.length >= 5) score.confidence = 'moderate';
  else if (events.length >= 2) score.confidence = 'low';
  else score.confidence = 'insufficient';

  return score;
}

// ── Outcome-Weighted Trust Blending ───────────────────────

export function blendOutcomeIntoTrust(
  baseTrust: PlaybookTrustScore,
  outcomeScore: PlaybookOutcomeScore,
): PlaybookTrustScore {
  // Outcome influences usageSuccess dimension most heavily
  // High outcome → boost; low outcome → drag down
  if (outcomeScore.confidence === 'insufficient') return baseTrust;

  const confidenceMultiplier =
    outcomeScore.confidence === 'high' ? 1.0 :
    outcomeScore.confidence === 'moderate' ? 0.6 : 0.3;

  // Outcome score maps 0-100 to a ±8 adjustment on usageSuccess (max 25)
  const outcomeAdjustment = ((outcomeScore.overall / 100) - 0.5) * 16 * confidenceMultiplier;
  const newUsageSuccess = Math.max(0, Math.min(25, baseTrust.usageSuccess + outcomeAdjustment));

  // Small stability bonus/penalty based on win correlation
  const stabilityAdjustment = (outcomeScore.winCorrelation / 10 - 0.5) * 4 * confidenceMultiplier;
  const newStability = Math.max(0, Math.min(25, baseTrust.stability + stabilityAdjustment));

  const overall = Math.round(baseTrust.evidenceStrength + baseTrust.evidenceDiversity + newUsageSuccess + newStability);

  return {
    ...baseTrust,
    usageSuccess: newUsageSuccess,
    stability: newStability,
    overall,
  };
}

export type OutcomeTrustAction = 'promote' | 'monitor' | 'downgrade' | 'split_review';

export function determineOutcomeTrustAction(
  outcomeScore: PlaybookOutcomeScore,
  currentTrust: PlaybookTrustStatus,
): OutcomeTrustAction {
  if (outcomeScore.confidence === 'insufficient') return 'monitor';

  if (outcomeScore.overall >= 60 && outcomeScore.confidence !== 'low') return 'promote';
  if (outcomeScore.overall <= 20 && outcomeScore.sampleSize >= 5) {
    // Low outcome with enough data → consider split or downgrade
    if (outcomeScore.stageProgression <= 2 && outcomeScore.meetingConversion <= 2) return 'split_review';
    return 'downgrade';
  }
  return 'monitor';
}

// ── Context-Aware Playbook Matching ───────────────────────

export interface DealContext {
  dealSize: 'small' | 'medium' | 'large' | 'enterprise';
  stage: string;
  persona: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  competitionPresent: boolean;
  stakeholderCount: number;
  productComplexity: 'simple' | 'moderate' | 'complex';
}

export interface PlaybookContextFit {
  playbookId: string;
  baseScore: number;        // from trust
  contextBonus: number;     // from context match
  fatigueDiscount: number;  // from overuse
  finalScore: number;
  contextReasons: string[];
}

const STAGE_THEME_AFFINITY: Record<string, string[]> = {
  Prospecting: ['create_urgency', 'early_credibility', 'discovery_depth'],
  Discovery: ['discovery_depth', 'champion_building', 'multithreading'],
  Demo: ['demo_execution', 'competitor_defense', 'objection_handling'],
  Proposal: ['pricing_pushback', 'negotiation_leverage', 'next_step_control'],
  Negotiation: ['negotiation_leverage', 'pricing_pushback', 'closing_commitment', 'competitor_defense'],
  Closing: ['closing_commitment', 'create_urgency', 'next_step_control'],
  Renewal: ['renewal_expansion', 'champion_building'],
};

export function scorePlaybookContextFit(
  playbook: PlaybookModel,
  context: DealContext,
  outcomeScore: PlaybookOutcomeScore | null,
  fatigueCount: number,
): PlaybookContextFit {
  const baseScore = playbook.trust_score.overall;
  let contextBonus = 0;
  const reasons: string[] = [];

  // Stage affinity
  const affinityThemes = STAGE_THEME_AFFINITY[context.stage] ?? [];
  const clusterTheme = playbook.derived_from_cluster_id?.replace('cluster_', '') ?? playbook.problem_type.replace(/ /g, '_');
  if (affinityThemes.includes(clusterTheme)) {
    contextBonus += 12;
    reasons.push(`Strong stage fit for ${context.stage}`);
  }

  // Persona match
  if (playbook.target_personas.some(p => context.persona.toLowerCase().includes(p.toLowerCase()))) {
    contextBonus += 8;
    reasons.push('Persona match');
  }

  // Urgency boost for urgency-related playbooks
  if (context.urgency === 'critical' || context.urgency === 'high') {
    if (clusterTheme.includes('urgency') || clusterTheme.includes('closing') || clusterTheme.includes('stall')) {
      contextBonus += 10;
      reasons.push('High urgency context match');
    }
  }

  // Competition present → boost competitor defense
  if (context.competitionPresent && clusterTheme.includes('competitor')) {
    contextBonus += 10;
    reasons.push('Active competition detected');
  }

  // Stakeholder complexity → multithreading/champion
  if (context.stakeholderCount >= 3 && (clusterTheme.includes('multithread') || clusterTheme.includes('champion'))) {
    contextBonus += 8;
    reasons.push('Complex buying committee');
  }

  // Deal size → enterprise playbooks for large deals
  if ((context.dealSize === 'large' || context.dealSize === 'enterprise') &&
      (clusterTheme.includes('negotiation') || clusterTheme.includes('multithread'))) {
    contextBonus += 6;
    reasons.push('Enterprise deal complexity');
  }

  // Outcome bonus: proven playbooks get boosted
  if (outcomeScore && outcomeScore.confidence !== 'insufficient' && outcomeScore.overall >= 50) {
    const outcomeBonus = Math.round((outcomeScore.overall / 100) * 15);
    contextBonus += outcomeBonus;
    reasons.push(`Outcome-proven (+${outcomeBonus})`);
  }

  // Fatigue discount
  const fatigueDiscount = computeFatigueDiscount(fatigueCount);

  const finalScore = Math.max(0, Math.min(100, baseScore + contextBonus - fatigueDiscount));

  return {
    playbookId: playbook.id,
    baseScore,
    contextBonus,
    fatigueDiscount,
    finalScore,
    contextReasons: reasons,
  };
}

// ── Fatigue Detection ─────────────────────────────────────

export interface FatigueSignal {
  playbookId: string;
  dealId: string;
  usageCount: number;
  isFatigued: boolean;
  suggestion: string | null;
}

const FATIGUE_THRESHOLD_SAME_DEAL = 3;
const FATIGUE_THRESHOLD_GLOBAL = 10; // across all deals in 14 days

export function computeFatigueDiscount(usageCount: number): number {
  if (usageCount <= 1) return 0;
  if (usageCount <= FATIGUE_THRESHOLD_SAME_DEAL) return (usageCount - 1) * 5;
  return Math.min(40, (usageCount - 1) * 8);
}

export function detectPlaybookFatigue(
  playbookId: string,
  recentUsages: { dealId: string; timestamp: string }[],
): FatigueSignal[] {
  // Group by deal
  const byDeal = new Map<string, number>();
  for (const u of recentUsages) {
    byDeal.set(u.dealId, (byDeal.get(u.dealId) ?? 0) + 1);
  }

  const signals: FatigueSignal[] = [];

  for (const [dealId, count] of byDeal) {
    const isFatigued = count >= FATIGUE_THRESHOLD_SAME_DEAL;
    signals.push({
      playbookId,
      dealId,
      usageCount: count,
      isFatigued,
      suggestion: isFatigued
        ? `Playbook used ${count}x on this deal — try a different approach`
        : null,
    });
  }

  // Global fatigue check
  if (recentUsages.length >= FATIGUE_THRESHOLD_GLOBAL) {
    signals.push({
      playbookId,
      dealId: '__global__',
      usageCount: recentUsages.length,
      isFatigued: true,
      suggestion: `Playbook used ${recentUsages.length}x in the last 14 days — diversify tactics`,
    });
  }

  return signals;
}

// ── Playbook Ranking with Outcomes ────────────────────────

export function rankPlaybooksForContext(
  playbooks: PlaybookModel[],
  context: DealContext,
  outcomeScores: Map<string, PlaybookOutcomeScore>,
  fatigueCounts: Map<string, number>,
  purpose: PlaybookPurpose,
): PlaybookContextFit[] {
  return playbooks
    .filter(p => isPlaybookEligible(p, purpose))
    .map(p => scorePlaybookContextFit(
      p,
      context,
      outcomeScores.get(p.id) ?? null,
      fatigueCounts.get(p.id) ?? 0,
    ))
    .sort((a, b) => b.finalScore - a.finalScore);
}

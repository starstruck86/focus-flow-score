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

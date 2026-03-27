/**
 * Sales Brain — Doctrine System
 *
 * Versioned, source-linked tactical knowledge organized by chapter.
 * Doctrine is the SINGLE SOURCE of tactical truth for the entire system.
 *
 * GOVERNANCE: Every doctrine entry has a governance lifecycle:
 *   review_needed → approved | rejected | superseded | archived
 *   Only approved doctrine propagates downstream.
 */

// ── Chapters ───────────────────────────────────────────────
export const DOCTRINE_CHAPTERS = [
  'cold_calling',
  'discovery',
  'objection_handling',
  'negotiation',
  'competitors',
  'personas',
  'messaging',
  'closing',
  'stakeholder_navigation',
  'expansion',
] as const;

export type DoctrineChapter = typeof DOCTRINE_CHAPTERS[number];

export function getChapterLabel(chapter: DoctrineChapter): string {
  const labels: Record<DoctrineChapter, string> = {
    cold_calling: 'Cold Calling',
    discovery: 'Discovery',
    objection_handling: 'Objection Handling',
    negotiation: 'Negotiation',
    competitors: 'Competitors',
    personas: 'Personas',
    messaging: 'Messaging',
    closing: 'Closing',
    stakeholder_navigation: 'Stakeholder Navigation',
    expansion: 'Expansion',
  };
  return labels[chapter] || chapter;
}

// ── Insight Model ──────────────────────────────────────────
export type InsightCategory =
  | 'tactic'
  | 'objection'
  | 'messaging'
  | 'competitor'
  | 'persona'
  | 'framework'
  | 'anti_pattern'
  | 'talk_track';

export interface SalesBrainInsight {
  id: string;
  resourceIds: string[];
  chapter: DoctrineChapter;
  topic: string;
  insightText: string;
  category: InsightCategory;
  personaRelevance: string[];
  confidence: number; // 0-1
  extractedAt: string;
}

// ── Governance Model ──────────────────────────────────────
export type GovernanceStatus = 'draft' | 'review_needed' | 'approved' | 'rejected' | 'superseded' | 'archived';

export type DuplicateFlag = 'none' | 'possible_duplicate' | 'probable_duplicate';
export type ConflictFlag = 'none' | 'possible_conflict' | 'probable_conflict';

export interface PropagationTargets {
  dave: boolean;
  roleplay: boolean;
  prep: boolean;
  playbooks: boolean;
}

export interface DoctrineGovernance {
  status: GovernanceStatus;
  reason: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  supersededById: string | null;
  mergedIntoId: string | null;
  reviewPriority: number; // 0-100
  reviewNotes: string;
  propagationEnabled: boolean;
  propagationConfidenceFloor: number; // 0-1
  propagateTargets: PropagationTargets;
  lastReinforcedAt: string | null;
  lastConflictedAt: string | null;
  duplicateFlag: DuplicateFlag;
  duplicateCandidateIds: string[];
  conflictFlag: ConflictFlag;
  conflictCandidateIds: string[];
  isLegacyHydrated: boolean;
}

// ── Doctrine Model ─────────────────────────────────────────
export type FreshnessState = 'new' | 'fresh' | 'aging' | 'stale';

export interface DoctrineEntry {
  id: string;
  chapter: DoctrineChapter;
  statement: string;
  tacticalImplication: string;
  talkTracks: string[];
  antiPatterns: string[];
  examples: string[];
  sourceInsightIds: string[];
  sourceResourceIds: string[];
  confidence: number; // 0-1
  freshnessState: FreshnessState;
  version: number;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
  // Governance (added fields, backwards-compatible defaults applied on load)
  governance: DoctrineGovernance;
}

// ── Default governance for new entries ─────────────────────
export function defaultGovernance(status: GovernanceStatus = 'review_needed'): DoctrineGovernance {
  return {
    status,
    reason: status === 'review_needed' ? 'Newly created by heuristic pipeline' : '',
    approvedAt: null,
    rejectedAt: null,
    rejectedReason: null,
    supersededById: null,
    mergedIntoId: null,
    reviewPriority: 50,
    reviewNotes: '',
    propagationEnabled: status === 'approved',
    propagationConfidenceFloor: 0.5,
    propagateTargets: { dave: true, roleplay: true, prep: true, playbooks: true },
    lastReinforcedAt: null,
    lastConflictedAt: null,
    duplicateFlag: 'none',
    duplicateCandidateIds: [],
    conflictFlag: 'none',
    conflictCandidateIds: [],
  };
}

/** Ensure loaded entries have governance (backwards compat) */
function hydrateGovernance(entry: any): DoctrineEntry {
  if (!entry.governance) {
    // Legacy entry — infer governance from existing fields
    const gov = defaultGovernance('approved'); // legacy entries treated as approved
    gov.reason = 'Migrated from pre-governance system';
    entry.governance = gov;
  }
  return entry as DoctrineEntry;
}

// ── Freshness calculation ──────────────────────────────────
export function computeFreshness(updatedAt: string): FreshnessState {
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
  if (days <= 3) return 'new';
  if (days <= 14) return 'fresh';
  if (days <= 30) return 'aging';
  return 'stale';
}

export function getFreshnessColor(state: FreshnessState): string {
  switch (state) {
    case 'new': return 'bg-status-green/20 text-status-green';
    case 'fresh': return 'bg-primary/20 text-primary';
    case 'aging': return 'bg-status-yellow/20 text-status-yellow';
    case 'stale': return 'bg-status-red/20 text-status-red';
  }
}

export function getGovernanceColor(status: GovernanceStatus): string {
  switch (status) {
    case 'approved': return 'bg-status-green/20 text-status-green';
    case 'review_needed': return 'bg-status-yellow/20 text-status-yellow';
    case 'draft': return 'bg-muted text-muted-foreground';
    case 'rejected': return 'bg-destructive/20 text-destructive';
    case 'superseded': return 'bg-muted text-muted-foreground';
    case 'archived': return 'bg-muted text-muted-foreground';
  }
}

export function getGovernanceLabel(status: GovernanceStatus): string {
  switch (status) {
    case 'review_needed': return 'Review Needed';
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    case 'superseded': return 'Superseded';
    case 'archived': return 'Archived';
    case 'draft': return 'Draft';
  }
}

// ── Confidence adjustment ──────────────────────────────────
export function adjustConfidence(
  current: number,
  event: 'reinforced' | 'conflicted' | 'aged' | 'outcome_positive' | 'outcome_negative'
): number {
  switch (event) {
    case 'reinforced': return Math.min(1, current + 0.1);
    case 'conflicted': return Math.max(0.1, current - 0.15);
    case 'aged': return Math.max(0.1, current - 0.05);
    case 'outcome_positive': return Math.min(1, current + 0.05);
    case 'outcome_negative': return Math.max(0.1, current - 0.1);
  }
}

// ── Change Log ─────────────────────────────────────────────
export type ChangeEventType =
  | 'resource_ingested'
  | 'insight_created'
  | 'doctrine_created'
  | 'doctrine_updated'
  | 'doctrine_reinforced'
  | 'doctrine_superseded'
  | 'doctrine_approved'
  | 'doctrine_rejected'
  | 'doctrine_merged'
  | 'doctrine_archived'
  | 'propagation_changed'
  | 'confidence_adjusted'
  | 'duplicate_detected'
  | 'conflict_detected';

export interface DoctrineChangeEvent {
  id: string;
  eventType: ChangeEventType;
  chapter: DoctrineChapter | null;
  resourceId: string | null;
  insightId: string | null;
  doctrineId: string | null;
  description: string;
  timestamp: string;
}

// ── Local Storage persistence (Phase 1) ────────────────────
const INSIGHTS_KEY = 'sales-brain-insights';
const DOCTRINE_KEY = 'sales-brain-doctrine';
const CHANGELOG_KEY = 'sales-brain-changelog';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, data: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* quota */ }
}

export function loadInsights(): SalesBrainInsight[] {
  return loadJson<SalesBrainInsight[]>(INSIGHTS_KEY, []);
}

export function saveInsights(insights: SalesBrainInsight[]): void {
  saveJson(INSIGHTS_KEY, insights);
}

export function loadDoctrine(): DoctrineEntry[] {
  return loadJson<any[]>(DOCTRINE_KEY, []).map(hydrateGovernance);
}

export function saveDoctrine(entries: DoctrineEntry[]): void {
  saveJson(DOCTRINE_KEY, entries);
}

export function loadChangelog(): DoctrineChangeEvent[] {
  return loadJson<DoctrineChangeEvent[]>(CHANGELOG_KEY, []);
}

export function appendChangelog(event: DoctrineChangeEvent): void {
  const log = loadChangelog();
  log.unshift(event);
  saveJson(CHANGELOG_KEY, log.slice(0, 200));
}

// ── Propagation eligibility ────────────────────────────────
export const PROPAGATION_CONFIDENCE_FLOORS: Record<string, number> = {
  dave: 0.4,
  roleplay: 0.6,
  prep: 0.5,
  playbooks: 0.7,
};

export function isDoctrineEligibleForPropagation(
  entry: DoctrineEntry,
  target?: keyof PropagationTargets,
): boolean {
  const g = entry.governance;
  if (g.status !== 'approved') return false;
  if (!g.propagationEnabled) return false;
  if (entry.supersedesId) return false;
  if (entry.freshnessState === 'stale') return false;
  if (target) {
    if (!g.propagateTargets[target]) return false;
    const floor = Math.max(g.propagationConfidenceFloor, PROPAGATION_CONFIDENCE_FLOORS[target] || 0);
    if (entry.confidence < floor) return false;
  }
  return true;
}

// ── Doctrine lookup helpers ────────────────────────────────
export function getActiveDoctrine(): DoctrineEntry[] {
  return loadDoctrine().filter(d =>
    !d.supersedesId &&
    d.governance.status !== 'rejected' &&
    d.governance.status !== 'archived' &&
    d.governance.status !== 'superseded'
  );
}

export function getDoctrineByChapter(chapter: DoctrineChapter): DoctrineEntry[] {
  return getActiveDoctrine().filter(d => d.chapter === chapter);
}

export function getDoctrineForContext(chapters: DoctrineChapter[]): DoctrineEntry[] {
  return getActiveDoctrine()
    .filter(d => chapters.includes(d.chapter))
    .sort((a, b) => b.confidence - a.confidence);
}

/** Only approved + propagation-eligible doctrine for a specific target */
export function getPropagationEligibleDoctrine(
  target: keyof PropagationTargets,
  chapters?: DoctrineChapter[],
): DoctrineEntry[] {
  let entries = loadDoctrine();
  if (chapters) entries = entries.filter(d => chapters.includes(d.chapter));
  return entries
    .filter(d => isDoctrineEligibleForPropagation(d, target))
    .sort((a, b) => b.confidence - a.confidence);
}

export function getActiveDoctrineCount(): number {
  return getActiveDoctrine().length;
}

export function getInsightCount(): number {
  return loadInsights().length;
}

// ── Governance actions ─────────────────────────────────────
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function approveDoctrine(id: string): void {
  const all = loadDoctrine();
  const entry = all.find(d => d.id === id);
  if (!entry) return;
  entry.governance.status = 'approved';
  entry.governance.approvedAt = new Date().toISOString();
  entry.governance.propagationEnabled = true;
  entry.governance.reason = 'Operator approved';
  saveDoctrine(all);
  appendChangelog({
    id: generateId(),
    eventType: 'doctrine_approved',
    chapter: entry.chapter,
    resourceId: null, insightId: null, doctrineId: entry.id,
    description: `Approved: "${entry.statement}"`,
    timestamp: new Date().toISOString(),
  });
}

export function rejectDoctrine(id: string, reason: string): void {
  const all = loadDoctrine();
  const entry = all.find(d => d.id === id);
  if (!entry) return;
  entry.governance.status = 'rejected';
  entry.governance.rejectedAt = new Date().toISOString();
  entry.governance.rejectedReason = reason;
  entry.governance.propagationEnabled = false;
  entry.governance.reason = `Rejected: ${reason}`;
  saveDoctrine(all);
  appendChangelog({
    id: generateId(),
    eventType: 'doctrine_rejected',
    chapter: entry.chapter,
    resourceId: null, insightId: null, doctrineId: entry.id,
    description: `Rejected: "${entry.statement}" — ${reason}`,
    timestamp: new Date().toISOString(),
  });
}

export function archiveDoctrine(id: string): void {
  const all = loadDoctrine();
  const entry = all.find(d => d.id === id);
  if (!entry) return;
  entry.governance.status = 'archived';
  entry.governance.propagationEnabled = false;
  entry.governance.reason = 'Archived by operator';
  saveDoctrine(all);
  appendChangelog({
    id: generateId(),
    eventType: 'doctrine_archived',
    chapter: entry.chapter,
    resourceId: null, insightId: null, doctrineId: entry.id,
    description: `Archived: "${entry.statement}"`,
    timestamp: new Date().toISOString(),
  });
}

export function mergeDoctrine(sourceId: string, targetId: string): void {
  const all = loadDoctrine();
  const source = all.find(d => d.id === sourceId);
  const target = all.find(d => d.id === targetId);
  if (!source || !target) return;
  // Merge source links into target
  target.sourceInsightIds = [...new Set([...target.sourceInsightIds, ...source.sourceInsightIds])];
  target.sourceResourceIds = [...new Set([...target.sourceResourceIds, ...source.sourceResourceIds])];
  target.confidence = Math.max(target.confidence, source.confidence);
  target.updatedAt = new Date().toISOString();
  target.freshnessState = computeFreshness(target.updatedAt);
  // Mark source as superseded/merged
  source.governance.status = 'superseded';
  source.governance.mergedIntoId = targetId;
  source.governance.propagationEnabled = false;
  source.governance.reason = `Merged into ${targetId}`;
  saveDoctrine(all);
  appendChangelog({
    id: generateId(),
    eventType: 'doctrine_merged',
    chapter: source.chapter,
    resourceId: null, insightId: null, doctrineId: sourceId,
    description: `Merged "${source.statement}" into "${target.statement}"`,
    timestamp: new Date().toISOString(),
  });
}

export function adjustDoctrineConfidence(id: string, delta: number): void {
  const all = loadDoctrine();
  const entry = all.find(d => d.id === id);
  if (!entry) return;
  entry.confidence = Math.max(0.1, Math.min(1, entry.confidence + delta));
  entry.updatedAt = new Date().toISOString();
  saveDoctrine(all);
  appendChangelog({
    id: generateId(),
    eventType: 'confidence_adjusted',
    chapter: entry.chapter,
    resourceId: null, insightId: null, doctrineId: entry.id,
    description: `Confidence ${delta > 0 ? 'raised' : 'lowered'} to ${(entry.confidence * 100).toFixed(0)}%`,
    timestamp: new Date().toISOString(),
  });
}

export function togglePropagation(id: string, enabled: boolean): void {
  const all = loadDoctrine();
  const entry = all.find(d => d.id === id);
  if (!entry) return;
  entry.governance.propagationEnabled = enabled;
  saveDoctrine(all);
  appendChangelog({
    id: generateId(),
    eventType: 'propagation_changed',
    chapter: entry.chapter,
    resourceId: null, insightId: null, doctrineId: entry.id,
    description: `Propagation ${enabled ? 'enabled' : 'disabled'}`,
    timestamp: new Date().toISOString(),
  });
}

export function togglePropagationTarget(id: string, target: keyof PropagationTargets, enabled: boolean): void {
  const all = loadDoctrine();
  const entry = all.find(d => d.id === id);
  if (!entry) return;
  entry.governance.propagateTargets[target] = enabled;
  saveDoctrine(all);
}

export function addReviewNote(id: string, note: string): void {
  const all = loadDoctrine();
  const entry = all.find(d => d.id === id);
  if (!entry) return;
  entry.governance.reviewNotes = entry.governance.reviewNotes
    ? `${entry.governance.reviewNotes}\n[${new Date().toLocaleString()}] ${note}`
    : `[${new Date().toLocaleString()}] ${note}`;
  saveDoctrine(all);
}

// ── Duplicate / Conflict detection ─────────────────────────
function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  return intersection / (a.size + b.size - intersection);
}

export function detectDuplicatesAndConflicts(): { duplicates: number; conflicts: number } {
  const all = getActiveDoctrine();
  let duplicates = 0;
  let conflicts = 0;

  for (let i = 0; i < all.length; i++) {
    const entryI = all[i];
    const wordsI = wordSet(entryI.statement);
    const dupes: string[] = [];
    const confs: string[] = [];

    for (let j = i + 1; j < all.length; j++) {
      const entryJ = all[j];
      if (entryI.chapter !== entryJ.chapter) continue;

      const sim = jaccardSimilarity(wordsI, wordSet(entryJ.statement));
      if (sim > 0.6) {
        dupes.push(entryJ.id);
        if (!entryJ.governance.duplicateCandidateIds.includes(entryI.id)) {
          entryJ.governance.duplicateCandidateIds.push(entryI.id);
          entryJ.governance.duplicateFlag = sim > 0.8 ? 'probable_duplicate' : 'possible_duplicate';
        }
      }

      // Conflict: same chapter, similar topic but different tactical implication
      const implSim = jaccardSimilarity(
        wordSet(entryI.tacticalImplication),
        wordSet(entryJ.tacticalImplication),
      );
      if (sim > 0.3 && implSim < 0.2 && entryI.tacticalImplication && entryJ.tacticalImplication) {
        confs.push(entryJ.id);
        if (!entryJ.governance.conflictCandidateIds.includes(entryI.id)) {
          entryJ.governance.conflictCandidateIds.push(entryI.id);
          entryJ.governance.conflictFlag = 'possible_conflict';
        }
      }
    }

    if (dupes.length > 0) {
      entryI.governance.duplicateCandidateIds = [...new Set([...entryI.governance.duplicateCandidateIds, ...dupes])];
      entryI.governance.duplicateFlag = 'possible_duplicate';
      duplicates += dupes.length;
    }
    if (confs.length > 0) {
      entryI.governance.conflictCandidateIds = [...new Set([...entryI.governance.conflictCandidateIds, ...confs])];
      entryI.governance.conflictFlag = 'possible_conflict';
      conflicts += confs.length;
    }
  }

  saveDoctrine(loadDoctrine().map(d => {
    const updated = all.find(a => a.id === d.id);
    return updated || d;
  }));

  return { duplicates, conflicts };
}

// ── Recovery / self-healing ────────────────────────────────
export function recomputeAllFreshness(): number {
  const all = loadDoctrine();
  let changed = 0;
  for (const d of all) {
    const fresh = computeFreshness(d.updatedAt);
    if (fresh !== d.freshnessState) { d.freshnessState = fresh; changed++; }
  }
  saveDoctrine(all);
  return changed;
}

export function disableStalePropagation(): number {
  const all = loadDoctrine();
  let changed = 0;
  for (const d of all) {
    if (d.freshnessState === 'stale' && d.governance.propagationEnabled) {
      d.governance.propagationEnabled = false;
      changed++;
    }
  }
  saveDoctrine(all);
  return changed;
}

export function reEnableApprovedPropagation(): number {
  const all = loadDoctrine();
  let changed = 0;
  for (const d of all) {
    if (d.governance.status === 'approved' && !d.governance.propagationEnabled && d.freshnessState !== 'stale') {
      d.governance.propagationEnabled = true;
      changed++;
    }
  }
  saveDoctrine(all);
  return changed;
}

// ── Review queue ───────────────────────────────────────────
export interface ReviewQueueItem {
  entry: DoctrineEntry;
  queueReason: string;
  priority: number;
}

export function getDoctrineReviewQueue(): ReviewQueueItem[] {
  const all = getActiveDoctrine();
  const items: ReviewQueueItem[] = [];

  for (const entry of all) {
    const reasons: string[] = [];
    let priority = entry.governance.reviewPriority;

    if (entry.governance.status === 'review_needed') {
      reasons.push('Awaiting review');
      priority += 30;
    }
    if (entry.governance.status === 'draft') {
      reasons.push('Draft');
      priority += 10;
    }
    if (entry.confidence < 0.4) {
      reasons.push('Low confidence');
      priority += 15;
    }
    if (entry.governance.duplicateFlag !== 'none') {
      reasons.push(`${entry.governance.duplicateFlag.replace(/_/g, ' ')}`);
      priority += 20;
    }
    if (entry.governance.conflictFlag !== 'none') {
      reasons.push(`${entry.governance.conflictFlag.replace(/_/g, ' ')}`);
      priority += 25;
    }
    if (entry.freshnessState === 'stale' && entry.governance.propagationEnabled) {
      reasons.push('Stale but still propagating');
      priority += 20;
    }

    if (reasons.length > 0) {
      items.push({
        entry,
        queueReason: reasons.join('; '),
        priority: Math.min(100, priority),
      });
    }
  }

  return items.sort((a, b) => b.priority - a.priority);
}

// ── Governance stats ───────────────────────────────────────
export interface DoctrineGovernanceStats {
  total: number;
  approved: number;
  reviewNeeded: number;
  rejected: number;
  draft: number;
  archived: number;
  superseded: number;
  stale: number;
  duplicateCandidates: number;
  conflictCandidates: number;
  propagationEnabled: number;
  usedByDave: number;
  usedByRoleplay: number;
  usedByPrep: number;
  usedByPlaybooks: number;
}

export function getDoctrineGovernanceStats(): DoctrineGovernanceStats {
  const all = loadDoctrine();
  const stats: DoctrineGovernanceStats = {
    total: all.length,
    approved: 0, reviewNeeded: 0, rejected: 0, draft: 0, archived: 0, superseded: 0,
    stale: 0, duplicateCandidates: 0, conflictCandidates: 0,
    propagationEnabled: 0, usedByDave: 0, usedByRoleplay: 0, usedByPrep: 0, usedByPlaybooks: 0,
  };

  for (const d of all) {
    const g = d.governance;
    switch (g.status) {
      case 'approved': stats.approved++; break;
      case 'review_needed': stats.reviewNeeded++; break;
      case 'rejected': stats.rejected++; break;
      case 'draft': stats.draft++; break;
      case 'archived': stats.archived++; break;
      case 'superseded': stats.superseded++; break;
    }
    if (d.freshnessState === 'stale') stats.stale++;
    if (g.duplicateFlag !== 'none') stats.duplicateCandidates++;
    if (g.conflictFlag !== 'none') stats.conflictCandidates++;
    if (isDoctrineEligibleForPropagation(d)) stats.propagationEnabled++;
    if (isDoctrineEligibleForPropagation(d, 'dave')) stats.usedByDave++;
    if (isDoctrineEligibleForPropagation(d, 'roleplay')) stats.usedByRoleplay++;
    if (isDoctrineEligibleForPropagation(d, 'prep')) stats.usedByPrep++;
    if (isDoctrineEligibleForPropagation(d, 'playbooks')) stats.usedByPlaybooks++;
  }

  return stats;
}

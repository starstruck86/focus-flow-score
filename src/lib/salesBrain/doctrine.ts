/**
 * Sales Brain — Doctrine System
 *
 * Versioned, source-linked tactical knowledge organized by chapter.
 * Doctrine is the SINGLE SOURCE of tactical truth for the entire system.
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
export type ChangeEventType = 'resource_ingested' | 'insight_created' | 'doctrine_created' | 'doctrine_updated' | 'doctrine_reinforced' | 'doctrine_superseded';

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
  return loadJson<DoctrineEntry[]>(DOCTRINE_KEY, []);
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
  // Keep last 200
  saveJson(CHANGELOG_KEY, log.slice(0, 200));
}

// ── Doctrine lookup helpers ────────────────────────────────
export function getDoctrineByChapter(chapter: DoctrineChapter): DoctrineEntry[] {
  return loadDoctrine().filter(d => d.chapter === chapter && !d.supersedesId);
}

export function getDoctrineForContext(chapters: DoctrineChapter[]): DoctrineEntry[] {
  const all = loadDoctrine();
  return all.filter(d => chapters.includes(d.chapter) && !d.supersedesId)
    .sort((a, b) => b.confidence - a.confidence);
}

export function getActiveDoctrineCount(): number {
  return loadDoctrine().filter(d => !d.supersedesId).length;
}

export function getInsightCount(): number {
  return loadInsights().length;
}

/**
 * Sales Brain — Propagation Layer
 *
 * Pushes doctrine updates into downstream systems:
 * - Dave (system prompt context)
 * - Roleplay (scenario grounding)
 * - Playbooks (creation/update suggestions)
 * - Prep recommendations
 *
 * Phase 1: In-memory propagation via localStorage events.
 * Future: Database-backed with edge function triggers.
 */

import {
  type DoctrineEntry,
  type DoctrineChapter,
  getDoctrineForContext,
  loadDoctrine,
  getActiveDoctrineCount,
  getInsightCount,
  loadChangelog,
} from './doctrine';
import { createLogger } from '@/lib/logger';

const log = createLogger('SalesBrainPropagation');

// ── Propagation targets ────────────────────────────────────
export type PropagationTarget = 'dave' | 'roleplay' | 'playbooks' | 'prep';

export interface PropagationResult {
  target: PropagationTarget;
  itemsPropagated: number;
  details: string;
}

// ── Dave context injection ─────────────────────────────────
/**
 * Returns doctrine-grounded context for Dave's system prompt.
 * Filtered by relevance to current execution context.
 */
export function getDaveDoctrineContext(
  chapters?: DoctrineChapter[],
  maxEntries = 10,
): string {
  const relevantChapters = chapters || ['cold_calling', 'discovery', 'objection_handling', 'messaging'];
  const doctrine = getDoctrineForContext(relevantChapters).slice(0, maxEntries);

  if (doctrine.length === 0) return '';

  const lines = doctrine.map(d =>
    `• [${d.chapter}] ${d.statement} (confidence: ${(d.confidence * 100).toFixed(0)}%)`
  );

  return `\n--- Sales Brain Doctrine ---\n${lines.join('\n')}\n--- End Doctrine ---`;
}

// ── Roleplay grounding ────────────────────────────────────
export interface RoleplayDoctrineGround {
  objectionThemes: string[];
  antiPatterns: string[];
  successCriteria: string[];
  talkTracks: string[];
}

export function getRoleplayGrounding(chapter?: DoctrineChapter): RoleplayDoctrineGround {
  const chapters: DoctrineChapter[] = chapter
    ? [chapter]
    : ['cold_calling', 'discovery', 'objection_handling', 'negotiation'];

  const doctrine = getDoctrineForContext(chapters);

  return {
    objectionThemes: doctrine
      .filter(d => d.chapter === 'objection_handling')
      .map(d => d.statement)
      .slice(0, 5),
    antiPatterns: doctrine
      .flatMap(d => d.antiPatterns)
      .slice(0, 5),
    successCriteria: doctrine
      .map(d => d.tacticalImplication)
      .filter(Boolean)
      .slice(0, 5),
    talkTracks: doctrine
      .flatMap(d => d.talkTracks)
      .slice(0, 5),
  };
}

// ── Playbook suggestions ──────────────────────────────────
export interface PlaybookSuggestion {
  type: 'new' | 'update';
  title: string;
  reason: string;
  chapter: DoctrineChapter;
  sourceDoctrineIds: string[];
}

export function getPlaybookSuggestions(): PlaybookSuggestion[] {
  const doctrine = loadDoctrine().filter(d => !d.supersedesId);
  const suggestions: PlaybookSuggestion[] = [];

  // Find high-confidence doctrine without playbook backing
  for (const d of doctrine) {
    if (d.confidence >= 0.7 && d.freshnessState !== 'stale') {
      suggestions.push({
        type: 'new',
        title: `Playbook: ${d.statement.slice(0, 60)}`,
        reason: `High-confidence doctrine (${(d.confidence * 100).toFixed(0)}%) in ${d.chapter}`,
        chapter: d.chapter,
        sourceDoctrineIds: [d.id],
      });
    }
  }

  return suggestions.slice(0, 5);
}

// ── Prep recommendations ──────────────────────────────────
export interface PrepRecommendation {
  chapter: DoctrineChapter;
  recommendation: string;
  confidence: number;
  sourceDoctrineIds: string[];
}

export function getPrepRecommendations(
  accountIndustry?: string,
  dealStage?: string,
): PrepRecommendation[] {
  const chapters: DoctrineChapter[] = [];

  // Context-aware chapter selection
  if (dealStage) {
    const stageMap: Record<string, DoctrineChapter[]> = {
      'prospecting': ['cold_calling', 'messaging'],
      'discovery': ['discovery', 'personas'],
      'qualification': ['discovery', 'stakeholder_navigation'],
      'proposal': ['negotiation', 'competitors'],
      'negotiation': ['negotiation', 'closing', 'objection_handling'],
      'closing': ['closing', 'objection_handling'],
    };
    chapters.push(...(stageMap[dealStage.toLowerCase()] || ['messaging', 'discovery']));
  } else {
    chapters.push('cold_calling', 'discovery', 'messaging');
  }

  const doctrine = getDoctrineForContext(chapters);
  return doctrine.slice(0, 5).map(d => ({
    chapter: d.chapter,
    recommendation: d.tacticalImplication || d.statement,
    confidence: d.confidence,
    sourceDoctrineIds: [d.id],
  }));
}

// ── Brain health summary ──────────────────────────────────
export interface BrainHealthSummary {
  totalInsights: number;
  totalDoctrine: number;
  staleCount: number;
  highConfidenceCount: number;
  recentChanges: number;
  chaptersWithDoctrine: DoctrineChapter[];
  chaptersEmpty: DoctrineChapter[];
}

export function getBrainHealth(): BrainHealthSummary {
  const doctrine = loadDoctrine().filter(d => !d.supersedesId);
  const changelog = loadChangelog();
  const recentCutoff = Date.now() - 7 * 86400000;

  const chaptersWithDoctrine = [...new Set(doctrine.map(d => d.chapter))] as DoctrineChapter[];
  const allChapters: DoctrineChapter[] = [
    'cold_calling', 'discovery', 'objection_handling', 'negotiation',
    'competitors', 'personas', 'messaging', 'closing',
    'stakeholder_navigation', 'expansion',
  ];
  const chaptersEmpty = allChapters.filter(c => !chaptersWithDoctrine.includes(c));

  return {
    totalInsights: getInsightCount(),
    totalDoctrine: doctrine.length,
    staleCount: doctrine.filter(d => d.freshnessState === 'stale').length,
    highConfidenceCount: doctrine.filter(d => d.confidence >= 0.7).length,
    recentChanges: changelog.filter(e => new Date(e.timestamp).getTime() > recentCutoff).length,
    chaptersWithDoctrine,
    chaptersEmpty,
  };
}

// ── Full propagation run ──────────────────────────────────
export function runPropagation(): PropagationResult[] {
  const results: PropagationResult[] = [];
  const doctrine = loadDoctrine().filter(d => !d.supersedesId);

  // Dave
  const daveContext = getDaveDoctrineContext();
  results.push({
    target: 'dave',
    itemsPropagated: doctrine.length,
    details: daveContext ? `${doctrine.length} doctrine entries available for Dave` : 'No doctrine to propagate',
  });

  // Roleplay
  const grounding = getRoleplayGrounding();
  const roleplayItems = grounding.objectionThemes.length + grounding.antiPatterns.length + grounding.talkTracks.length;
  results.push({
    target: 'roleplay',
    itemsPropagated: roleplayItems,
    details: `${grounding.objectionThemes.length} objection themes, ${grounding.antiPatterns.length} anti-patterns, ${grounding.talkTracks.length} talk tracks`,
  });

  // Playbooks
  const suggestions = getPlaybookSuggestions();
  results.push({
    target: 'playbooks',
    itemsPropagated: suggestions.length,
    details: `${suggestions.length} playbook suggestions from doctrine`,
  });

  // Prep
  const prepRecs = getPrepRecommendations();
  results.push({
    target: 'prep',
    itemsPropagated: prepRecs.length,
    details: `${prepRecs.length} prep recommendations available`,
  });

  log.info('Propagation complete', { results });
  return results;
}

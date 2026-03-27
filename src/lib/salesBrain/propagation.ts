/**
 * Sales Brain — Propagation Layer
 *
 * Pushes doctrine updates into downstream systems.
 * GOVERNED: Only approved, propagation-eligible doctrine propagates.
 * LOGGED: Every actual use is recorded via doctrineUsage.
 *
 * Targets: Dave, Roleplay, Playbooks, Prep
 */

import {
  type DoctrineEntry,
  type DoctrineChapter,
  type PropagationTargets,
  getPropagationEligibleDoctrine,
  getActiveDoctrine,
  getInsightCount,
  loadChangelog,
  loadDoctrine,
  isDoctrineEligibleForPropagation,
} from './doctrine';
import { logDoctrineUsageBatch } from './doctrineUsage';
import { createLogger } from '@/lib/logger';

const log = createLogger('SalesBrainPropagation');

// ── Propagation targets ────────────────────────────────────
export type PropagationTarget = 'dave' | 'roleplay' | 'playbooks' | 'prep';

export interface PropagationResult {
  target: PropagationTarget;
  itemsPropagated: number;
  details: string;
  sourceDoctrineIds: string[];
}

// ── Dave context injection ─────────────────────────────────
export function getDaveDoctrineContext(
  chapters?: DoctrineChapter[],
  maxEntries = 10,
): string {
  const doctrine = getPropagationEligibleDoctrine('dave', chapters || ['cold_calling', 'discovery', 'objection_handling', 'messaging'])
    .slice(0, maxEntries);

  if (doctrine.length === 0) return '';

  // Log actual usage
  logDoctrineUsageBatch(
    doctrine.map(d => d.id),
    'dave',
    'dave_context',
    null,
    'Injected into Dave system prompt',
  );

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
  sourceDoctrineIds: string[];
}

export function getRoleplayGrounding(chapter?: DoctrineChapter): RoleplayDoctrineGround {
  const chapters: DoctrineChapter[] = chapter
    ? [chapter]
    : ['cold_calling', 'discovery', 'objection_handling', 'negotiation'];

  const doctrine = getPropagationEligibleDoctrine('roleplay', chapters);

  // Log actual usage
  if (doctrine.length > 0) {
    logDoctrineUsageBatch(
      doctrine.map(d => d.id),
      'roleplay',
      'roleplay_grounding',
      null,
      'Used for roleplay scenario grounding',
    );
  }

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
    sourceDoctrineIds: doctrine.map(d => d.id),
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
  const doctrine = getPropagationEligibleDoctrine('playbooks');
  const suggestions: PlaybookSuggestion[] = [];

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

  const result = suggestions.slice(0, 5);

  // Log actual usage
  const ids = result.flatMap(s => s.sourceDoctrineIds);
  if (ids.length > 0) {
    logDoctrineUsageBatch(ids, 'playbooks', 'playbook_suggestion', null, 'Generated playbook suggestion');
  }

  return result;
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

  const doctrine = getPropagationEligibleDoctrine('prep', chapters);
  const result = doctrine.slice(0, 5).map(d => ({
    chapter: d.chapter,
    recommendation: d.tacticalImplication || d.statement,
    confidence: d.confidence,
    sourceDoctrineIds: [d.id],
  }));

  // Log actual usage
  const ids = result.flatMap(r => r.sourceDoctrineIds);
  if (ids.length > 0) {
    logDoctrineUsageBatch(ids, 'prep', 'prep_recommendation', null, 'Generated prep recommendation');
  }

  return result;
}

// ── Downstream traceability ───────────────────────────────
export interface DoctrineUsageMap {
  doctrineId: string;
  usedBy: {
    dave: boolean;
    roleplay: boolean;
    prep: boolean;
    playbooks: boolean;
  };
}

export function getDoctrineUsageMap(): DoctrineUsageMap[] {
  const all = loadDoctrine();
  return all
    .filter(d => !d.supersedesId)
    .map(d => ({
      doctrineId: d.id,
      usedBy: {
        dave: isDoctrineEligibleForPropagation(d, 'dave'),
        roleplay: isDoctrineEligibleForPropagation(d, 'roleplay'),
        prep: isDoctrineEligibleForPropagation(d, 'prep'),
        playbooks: isDoctrineEligibleForPropagation(d, 'playbooks'),
      },
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
  const doctrine = getActiveDoctrine();
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

  // Dave
  const daveDoctrine = getPropagationEligibleDoctrine('dave');
  results.push({
    target: 'dave',
    itemsPropagated: daveDoctrine.length,
    details: daveDoctrine.length > 0 ? `${daveDoctrine.length} approved doctrine entries for Dave` : 'No eligible doctrine',
    sourceDoctrineIds: daveDoctrine.map(d => d.id),
  });

  // Roleplay
  const grounding = getRoleplayGrounding();
  const roleplayItems = grounding.objectionThemes.length + grounding.antiPatterns.length + grounding.talkTracks.length;
  results.push({
    target: 'roleplay',
    itemsPropagated: roleplayItems,
    details: `${grounding.objectionThemes.length} objection themes, ${grounding.antiPatterns.length} anti-patterns, ${grounding.talkTracks.length} talk tracks`,
    sourceDoctrineIds: grounding.sourceDoctrineIds,
  });

  // Playbooks
  const suggestions = getPlaybookSuggestions();
  results.push({
    target: 'playbooks',
    itemsPropagated: suggestions.length,
    details: `${suggestions.length} playbook suggestions`,
    sourceDoctrineIds: suggestions.flatMap(s => s.sourceDoctrineIds),
  });

  // Prep
  const prepRecs = getPrepRecommendations();
  results.push({
    target: 'prep',
    itemsPropagated: prepRecs.length,
    details: `${prepRecs.length} prep recommendations`,
    sourceDoctrineIds: prepRecs.flatMap(r => r.sourceDoctrineIds),
  });

  log.info('Propagation complete', { results });
  return results;
}

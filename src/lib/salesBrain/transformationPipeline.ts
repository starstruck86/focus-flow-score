/**
 * Sales Brain — Transformation Pipeline
 *
 * When a resource is promoted:
 * 1. Extract insights (classify by category)
 * 2. Match against existing doctrine
 * 3. Either reinforce, update, or create new doctrine entries
 * 4. Log all changes
 *
 * Phase 1: client-side with AI extraction via edge function.
 * Graceful degradation if AI unavailable.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  type SalesBrainInsight,
  type DoctrineEntry,
  type DoctrineChapter,
  type InsightCategory,
  DOCTRINE_CHAPTERS,
  loadInsights,
  saveInsights,
  loadDoctrine,
  saveDoctrine,
  appendChangelog,
  adjustConfidence,
  computeFreshness,
} from './doctrine';
import { createLogger } from '@/lib/logger';

const log = createLogger('TransformationPipeline');

// ── Extract insights from resource content ─────────────────
export interface ExtractionInput {
  resourceId: string;
  title: string;
  content: string | null;
  description: string | null;
  tags: string[];
}

export interface ExtractionResult {
  insights: SalesBrainInsight[];
  doctrineUpdates: Array<{
    action: 'created' | 'reinforced' | 'updated';
    doctrineId: string;
    chapter: DoctrineChapter;
    statement: string;
  }>;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Simple heuristic insight extractor (Phase 1).
 * Scans content for patterns and classifies them.
 * Will be replaced by AI extraction in Phase 2.
 */
export function extractInsightsHeuristic(input: ExtractionInput): SalesBrainInsight[] {
  const { resourceId, title, content, description, tags } = input;
  const text = [title, description, content].filter(Boolean).join('\n').toLowerCase();
  const insights: SalesBrainInsight[] = [];

  // Pattern-based chapter detection
  const chapterSignals: Array<{ chapter: DoctrineChapter; patterns: RegExp[]; category: InsightCategory }> = [
    { chapter: 'cold_calling', patterns: [/cold call/i, /outbound/i, /opener/i, /dial/i, /prospecting call/i], category: 'tactic' },
    { chapter: 'discovery', patterns: [/discovery/i, /pain point/i, /qualifying/i, /open.ended question/i], category: 'tactic' },
    { chapter: 'objection_handling', patterns: [/objection/i, /pushback/i, /rebuttal/i, /overcome/i, /handle.*concern/i], category: 'objection' },
    { chapter: 'negotiation', patterns: [/negotiat/i, /discount/i, /pricing/i, /concession/i, /anchor/i], category: 'tactic' },
    { chapter: 'competitors', patterns: [/competitor/i, /versus/i, /alternative/i, /compete/i, /battlecard/i], category: 'competitor' },
    { chapter: 'personas', patterns: [/persona/i, /buyer.*profile/i, /stakeholder/i, /champion/i, /economic.*buyer/i], category: 'persona' },
    { chapter: 'messaging', patterns: [/messaging/i, /value.*prop/i, /positioning/i, /pitch/i, /narrative/i], category: 'messaging' },
    { chapter: 'closing', patterns: [/clos(e|ing)/i, /ask.*for.*business/i, /urgency/i, /close.*deal/i], category: 'tactic' },
  ];

  for (const signal of chapterSignals) {
    const matches = signal.patterns.filter(p => p.test(text));
    if (matches.length >= 1) {
      insights.push({
        id: generateId(),
        resourceIds: [resourceId],
        chapter: signal.chapter,
        topic: `${signal.chapter} insight from "${title}"`,
        insightText: description || title,
        category: signal.category,
        personaRelevance: [],
        confidence: Math.min(0.9, 0.4 + matches.length * 0.15),
        extractedAt: new Date().toISOString(),
      });
    }
  }

  // If no specific signals, add a general insight
  if (insights.length === 0 && (content || description)) {
    insights.push({
      id: generateId(),
      resourceIds: [resourceId],
      chapter: 'messaging',
      topic: `General insight from "${title}"`,
      insightText: description || title,
      category: 'tactic',
      personaRelevance: [],
      confidence: 0.3,
      extractedAt: new Date().toISOString(),
    });
  }

  return insights;
}

// ── Match insights against existing doctrine ───────────────
function findMatchingDoctrine(insight: SalesBrainInsight, existing: DoctrineEntry[]): DoctrineEntry | null {
  // Simple match: same chapter + keyword overlap
  const candidates = existing.filter(d => d.chapter === insight.chapter && !d.supersedesId);
  if (candidates.length === 0) return null;

  const insightWords = new Set(insight.insightText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  let bestMatch: DoctrineEntry | null = null;
  let bestOverlap = 0;

  for (const candidate of candidates) {
    const docWords = new Set(candidate.statement.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let overlap = 0;
    for (const w of insightWords) {
      if (docWords.has(w)) overlap++;
    }
    const ratio = insightWords.size > 0 ? overlap / insightWords.size : 0;
    if (ratio > 0.3 && overlap > bestOverlap) {
      bestMatch = candidate;
      bestOverlap = overlap;
    }
  }

  return bestMatch;
}

// ── Process a promoted resource ────────────────────────────
export function processPromotedResource(input: ExtractionInput): ExtractionResult {
  const newInsights = extractInsightsHeuristic(input);
  const existingInsights = loadInsights();
  const existingDoctrine = loadDoctrine();
  const doctrineUpdates: ExtractionResult['doctrineUpdates'] = [];
  const now = new Date().toISOString();

  for (const insight of newInsights) {
    // Save insight
    existingInsights.push(insight);

    appendChangelog({
      id: generateId(),
      eventType: 'insight_created',
      chapter: insight.chapter,
      resourceId: input.resourceId,
      insightId: insight.id,
      doctrineId: null,
      description: `Insight extracted: "${insight.topic}"`,
      timestamp: now,
    });

    // Match against doctrine
    const match = findMatchingDoctrine(insight, existingDoctrine);

    if (match) {
      // Reinforce existing doctrine
      match.confidence = adjustConfidence(match.confidence, 'reinforced');
      match.sourceInsightIds = [...new Set([...match.sourceInsightIds, insight.id])];
      match.sourceResourceIds = [...new Set([...match.sourceResourceIds, input.resourceId])];
      match.updatedAt = now;
      match.freshnessState = computeFreshness(now);

      doctrineUpdates.push({
        action: 'reinforced',
        doctrineId: match.id,
        chapter: match.chapter,
        statement: match.statement,
      });

      appendChangelog({
        id: generateId(),
        eventType: 'doctrine_reinforced',
        chapter: match.chapter,
        resourceId: input.resourceId,
        insightId: insight.id,
        doctrineId: match.id,
        description: `Doctrine reinforced: "${match.statement}" (confidence → ${match.confidence.toFixed(2)})`,
        timestamp: now,
      });
    } else if (insight.confidence >= 0.5) {
      // Create new doctrine entry
      const newDoc: DoctrineEntry = {
        id: generateId(),
        chapter: insight.chapter,
        statement: insight.insightText,
        tacticalImplication: `Apply ${insight.category} in ${insight.chapter} contexts`,
        talkTracks: [],
        antiPatterns: [],
        examples: [],
        sourceInsightIds: [insight.id],
        sourceResourceIds: [input.resourceId],
        confidence: insight.confidence,
        freshnessState: 'new',
        version: 1,
        supersedesId: null,
        createdAt: now,
        updatedAt: now,
      };

      existingDoctrine.push(newDoc);

      doctrineUpdates.push({
        action: 'created',
        doctrineId: newDoc.id,
        chapter: newDoc.chapter,
        statement: newDoc.statement,
      });

      appendChangelog({
        id: generateId(),
        eventType: 'doctrine_created',
        chapter: newDoc.chapter,
        resourceId: input.resourceId,
        insightId: insight.id,
        doctrineId: newDoc.id,
        description: `New doctrine created: "${newDoc.statement}"`,
        timestamp: now,
      });
    }
  }

  // Persist
  saveInsights(existingInsights);
  saveDoctrine(existingDoctrine);

  log.info('Resource processed', {
    resourceId: input.resourceId,
    insightsExtracted: newInsights.length,
    doctrineUpdates: doctrineUpdates.length,
  });

  return { insights: newInsights, doctrineUpdates };
}

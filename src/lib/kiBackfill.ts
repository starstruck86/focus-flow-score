/**
 * Knowledge Item Backfill & Remediation Engine
 *
 * Scans existing knowledge items and classifies each into:
 *   keep_as_is | activate_now | rewrite_from_source | archive_or_delete
 *
 * Then executes the appropriate action while protecting user-edited items.
 */

import { supabase } from '@/integrations/supabase/client';
import { extractKnowledgeLLMFallback, type ExtractionSource } from './knowledgeExtraction';
import { createLogger } from '@/lib/logger';

const log = createLogger('KIBackfill');
const KI_TABLE = 'knowledge_items' as any;
const PAGE_SIZE = 1000;

// ── Types ──────────────────────────────────────────────────

export type KIClassification = 'keep_as_is' | 'activate_now' | 'rewrite_from_source' | 'archive_or_delete' | 'protected';

export interface ClassifiedItem {
  id: string;
  title: string;
  classification: KIClassification;
  reason: string;
  confidence: number;
  source_resource_id: string | null;
  chapter: string | null;
  active: boolean;
  user_edited: boolean;
}

export interface BackfillReport {
  total_scanned: number;
  kept: number;
  activated: number;
  rewritten: number;
  archived: number;
  retained_for_review: number;
  protected_skipped: number;
  errors: number;
  new_items_created: number;
  classifications: ClassifiedItem[];
}

type KIRecord = {
  id: string;
  title: string;
  tactic_summary: string | null;
  when_to_use: string | null;
  when_not_to_use: string | null;
  example_usage: string | null;
  chapter: string | null;
  knowledge_type: string | null;
  confidence_score: number | null;
  active: boolean;
  user_edited: boolean;
  source_resource_id: string | null;
  applies_to_contexts: string[] | null;
  tags: string[] | null;
  status: string | null;
  created_at?: string | null;
};

// ── Weak-item detection ────────────────────────────────────

const SUMMARY_PATTERNS = [
  /^this (document|article|resource|video|podcast|content|section)/i,
  /discusses|explains|describes|covers|talks about|focuses on|provides an overview/i,
  /is important|is critical|is essential|is key|is vital/i,
  /in (this|the) (article|video|document|section|module|chapter)/i,
  /the (author|speaker|presenter) (says|mentions|discusses|argues|explains)/i,
  /if you liked this episode|leave us a review|hit subscribe|thanks for listening/i,
];

const CONCEPT_PATTERNS = [
  /^(emotional intelligence|rapport|trust|empathy|listening|communication|leadership|mindset)/i,
  /is (a|the) (key|important|critical|essential) (factor|element|component|part)/i,
  /^(the importance of|understanding|why|how to think about)/i,
];

const ACTION_VERB_STARTERS = /^(ask|use|open|start|say|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|try|respond|handle|counter|address|lead|drive|close|send|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|contrast|qualify|disqualify|recap|summarize|draft|prepare|review|propose|negotiate|offer|deliver|request|outline|structure)/i;

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isActionable(item: { title: string; tactic_summary: string | null }): boolean {
  const summary = (item.tactic_summary ?? '').trim();
  const title = item.title.trim();
  return ACTION_VERB_STARTERS.test(title) || ACTION_VERB_STARTERS.test(summary);
}

function isWeakItem(item: { title: string; tactic_summary: string | null; when_to_use: string | null; example_usage: string | null }): boolean {
  const summary = (item.tactic_summary ?? '').trim();
  const title = item.title.trim();
  const whenToUse = (item.when_to_use ?? '').trim();
  const exampleUsage = (item.example_usage ?? '').trim();

  if (!summary || summary.length < 10) return true;
  if (SUMMARY_PATTERNS.some(p => p.test(summary))) return true;

  const normalizedTitle = normalizeText(title);
  const normalizedSummary = normalizeText(summary);
  const normalizedExample = normalizeText(exampleUsage);

  const summaryMatchesTitle = normalizedTitle.length > 18 && normalizedSummary.startsWith(normalizedTitle.slice(0, Math.min(40, normalizedTitle.length)));
  const longNonActionTitle = title.length > 55 && !ACTION_VERB_STARTERS.test(title);
  const genericWhenToUse = !whenToUse || /^when in (a|an|the) [a-z_\- ]+ conversation\.?$/i.test(whenToUse);
  const weakExample = !exampleUsage || exampleUsage.length < 30 || normalizedExample.startsWith(normalizedSummary.slice(0, Math.min(40, normalizedSummary.length)));

  if (summaryMatchesTitle && (longNonActionTitle || genericWhenToUse || weakExample)) {
    return true;
  }

  if (CONCEPT_PATTERNS.some(p => p.test(title) || p.test(summary)) && !isActionable(item) && summary.length < 220) {
    return true;
  }

  if (/\s—\s(cold calling|discovery|objection handling|negotiation|competitors|messaging|closing|expansion|personas|stakeholder navigation)$/i.test(title) && summary.length < 30) {
    return true;
  }

  return false;
}

function isDuplicate(item: KIRecord, allItems: KIRecord[]): boolean {
  const summary = normalizeText(item.tactic_summary);
  if (!summary) return false;

  return allItems.some(other =>
    other.id !== item.id &&
    other.source_resource_id === item.source_resource_id &&
    normalizeText(other.tactic_summary) === summary
  );
}

async function fetchAllKnowledgeItems(): Promise<KIRecord[]> {
  const rows: KIRecord[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(KI_TABLE)
      .select('id, title, tactic_summary, when_to_use, when_not_to_use, example_usage, chapter, knowledge_type, confidence_score, active, user_edited, source_resource_id, applies_to_contexts, tags, status, created_at')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const batch = ((data ?? []) as unknown) as KIRecord[];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

function getLiveKnowledgeItems(items: KIRecord[]): KIRecord[] {
  return items.filter(item => item.status !== 'stale');
}

// ── Classification logic ───────────────────────────────────

export function classifyKnowledgeItem(item: KIRecord, allItems: KIRecord[]): ClassifiedItem {
  const base = {
    id: item.id,
    title: item.title,
    confidence: item.confidence_score ?? 0,
    source_resource_id: item.source_resource_id,
    chapter: item.chapter,
    active: item.active,
    user_edited: item.user_edited,
  };

  if (item.user_edited) {
    return { ...base, classification: 'protected', reason: 'User-edited — will not auto-modify' };
  }

  if (isDuplicate(item, allItems)) {
    return { ...base, classification: 'archive_or_delete', reason: 'Duplicate of another item from same resource' };
  }

  const summary = (item.tactic_summary ?? '').trim();
  const hasContexts = Array.isArray(item.applies_to_contexts) && item.applies_to_contexts.length > 0;
  const conf = item.confidence_score ?? 0;

  if (isWeakItem(item)) {
    if (item.source_resource_id) {
      return { ...base, classification: 'rewrite_from_source', reason: 'Transcript-fragment or summary-like item — re-extract from source' };
    }
    return { ...base, classification: 'archive_or_delete', reason: 'Weak item with no source available for rewrite' };
  }

  if (conf < 0.2 && summary.length < 20) {
    if (item.source_resource_id) {
      return { ...base, classification: 'rewrite_from_source', reason: 'Very low confidence with minimal content — try clean rewrite' };
    }
    return { ...base, classification: 'archive_or_delete', reason: 'Very low confidence with minimal content' };
  }

  if (!item.active && conf >= 0.45 && summary.length >= 15 && hasContexts) {
    return { ...base, classification: 'activate_now', reason: `Meets activation criteria (conf=${(conf * 100).toFixed(0)}%) but inactive` };
  }

  if (conf < 0.3 && item.source_resource_id) {
    return { ...base, classification: 'rewrite_from_source', reason: 'Low confidence — re-extract from source' };
  }

  return { ...base, classification: 'keep_as_is', reason: 'Passes current quality checks' };
}

// ── Scan-only (dry run) ────────────────────────────────────

export async function scanExistingKnowledge(): Promise<BackfillReport> {
  const allItems = getLiveKnowledgeItems(await fetchAllKnowledgeItems());
  const classifications = allItems.map(item => classifyKnowledgeItem(item, allItems));

  return {
    total_scanned: allItems.length,
    kept: classifications.filter(c => c.classification === 'keep_as_is').length,
    activated: classifications.filter(c => c.classification === 'activate_now').length,
    rewritten: classifications.filter(c => c.classification === 'rewrite_from_source').length,
    archived: classifications.filter(c => c.classification === 'archive_or_delete').length,
    retained_for_review: 0,
    protected_skipped: classifications.filter(c => c.classification === 'protected').length,
    errors: 0,
    new_items_created: 0,
    classifications,
  };
}

// ── Execute backfill ───────────────────────────────────────

export async function executeKIBackfill(
  mode: 'activate' | 'rewrite' | 'archive' | 'full',
  onProgress?: (processed: number, total: number) => void,
): Promise<BackfillReport> {
  const allItems = getLiveKnowledgeItems(await fetchAllKnowledgeItems());
  const classifications = allItems.map(item => classifyKnowledgeItem(item, allItems));

  let activated = 0;
  let rewritten = 0;
  let archived = 0;
  let retainedForReview = 0;
  let newItemsCreated = 0;
  let errors = 0;

  const activations = classifications.filter(c =>
    c.classification === 'activate_now' && (mode === 'activate' || mode === 'full')
  );

  const archives = classifications.filter(c =>
    c.classification === 'archive_or_delete' && (mode === 'archive' || mode === 'full')
  );

  const rewriteGroups = Array.from(
    classifications
      .filter(c => c.classification === 'rewrite_from_source' && !!c.source_resource_id && (mode === 'rewrite' || mode === 'full'))
      .reduce((map, item) => {
        const resourceId = item.source_resource_id!;
        const existing = map.get(resourceId) ?? [];
        existing.push(item);
        map.set(resourceId, existing);
        return map;
      }, new Map<string, ClassifiedItem[]>())
      .entries()
  );

  const total = activations.length + archives.length + rewriteGroups.length;
  let processed = 0;

  for (const c of activations) {
    processed += 1;
    onProgress?.(processed, total);

    try {
      const { error: actErr } = await supabase
        .from(KI_TABLE)
        .update({
          active: true,
          status: 'active',
          activation_metadata: {
            activation_source: 'ki_backfill',
            activation_reason: c.reason,
            activation_timestamp: new Date().toISOString(),
            activation_rule_version: '3.1-backfill',
          },
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', c.id);

      if (actErr) {
        errors++;
      } else {
        activated++;
      }
    } catch (err) {
      log.warn('Backfill activation error for item', { id: c.id, error: err });
      errors++;
    }
  }

  for (const [resourceId, group] of rewriteGroups) {
    processed += 1;
    onProgress?.(processed, total);

    try {
      const { data: resource, error: resourceErr } = await supabase
        .from('resources')
        .select('id, title, content, description, tags, resource_type')
        .eq('id', resourceId)
        .single();

      if (resourceErr || !resource || !resource.content || resource.content.length < 100) {
        const { error: reviewErr } = await supabase
          .from(KI_TABLE)
          .update({
            status: 'review_needed',
            active: false,
            updated_at: new Date().toISOString(),
          } as any)
          .in('id', group.map(item => item.id));

        if (reviewErr) {
          errors += group.length;
        } else {
          retainedForReview += group.length;
        }
        continue;
      }

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        errors += group.length;
        continue;
      }

      const source: ExtractionSource = {
        resourceId: resource.id,
        userId,
        title: resource.title,
        content: resource.content,
        description: resource.description,
        tags: resource.tags ?? [],
        resourceType: resource.resource_type ?? 'document',
      };

      const survivingItems = allItems.filter(item =>
        item.source_resource_id === resourceId &&
        !group.some(groupItem => groupItem.id === item.id)
      );

      const newItems = await extractKnowledgeLLMFallback(source, survivingItems);
      const hasExistingGoodCoverage = survivingItems.some(item => !isWeakItem(item) && ((item.tactic_summary ?? '').trim().length >= 20));

      if (newItems.length > 0 || hasExistingGoodCoverage) {
        const { error: staleErr } = await supabase
          .from(KI_TABLE)
          .update({
            status: 'stale',
            active: false,
            updated_at: new Date().toISOString(),
          } as any)
          .in('id', group.map(item => item.id));

        if (staleErr) {
          errors += group.length;
          continue;
        }

        archived += group.length;

        if (newItems.length > 0) {
          const { data: inserted, error: insErr } = await supabase
            .from(KI_TABLE)
            .insert(newItems as any)
            .select('id');

          if (insErr) {
            log.warn('Failed to insert rewritten items', { resourceId, error: insErr.message });
            errors += group.length;
            continue;
          }

          rewritten += group.length;
          newItemsCreated += inserted?.length ?? 0;
        }
      } else {
        const { error: reviewErr } = await supabase
          .from(KI_TABLE)
          .update({
            status: 'review_needed',
            active: false,
            updated_at: new Date().toISOString(),
          } as any)
          .in('id', group.map(item => item.id));

        if (reviewErr) {
          errors += group.length;
        } else {
          retainedForReview += group.length;
        }
      }
    } catch (err) {
      log.warn('Backfill rewrite error for resource', { resourceId, error: err });
      errors += group.length;
    }
  }

  for (const c of archives) {
    processed += 1;
    onProgress?.(processed, total);

    try {
      const { error: archiveErr } = await supabase
        .from(KI_TABLE)
        .update({
          status: 'stale',
          active: false,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', c.id);

      if (archiveErr) {
        errors++;
      } else {
        archived++;
      }
    } catch (err) {
      log.warn('Backfill archive error for item', { id: c.id, error: err });
      errors++;
    }
  }

  const kept = classifications.filter(c => c.classification === 'keep_as_is').length;
  const protectedCount = classifications.filter(c => c.classification === 'protected').length;

  log.info('KI Backfill complete', {
    total_scanned: allItems.length,
    kept,
    activated,
    rewritten,
    archived,
    retained_for_review: retainedForReview,
    protected_skipped: protectedCount,
    new_items_created: newItemsCreated,
    errors,
  });

  return {
    total_scanned: allItems.length,
    kept,
    activated,
    rewritten,
    archived,
    retained_for_review: retainedForReview,
    protected_skipped: protectedCount,
    errors,
    new_items_created: newItemsCreated,
    classifications,
  };
}
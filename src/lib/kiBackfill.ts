/**
 * Knowledge Item Backfill & Remediation Engine
 *
 * Scans existing knowledge items and classifies each into:
 *   keep_as_is | activate_now | rewrite_from_source | archive_or_delete
 *
 * Then executes the appropriate action while protecting user-edited items.
 */

import { supabase } from '@/integrations/supabase/client';
import { extractKnowledgeHeuristic, extractKnowledgeLLMFallback, type ExtractionSource } from './knowledgeExtraction';
import { createLogger } from '@/lib/logger';

const log = createLogger('KIBackfill');
const KI_TABLE = 'knowledge_items' as any;

// ── Types ──────────────────────────────────────────────────

export type KIClassification = 'keep_as_is' | 'activate_now' | 'rewrite_from_source' | 'archive_or_delete' | 'protected';

export interface ClassifiedItem {
  id: string;
  title: string;
  classification: KIClassification;
  reason: string;
  confidence: number;
  source_resource_id: string | null;
  chapter: string;
  active: boolean;
  user_edited: boolean;
}

export interface BackfillReport {
  total_scanned: number;
  kept: number;
  activated: number;
  rewritten: number;
  archived: number;
  protected_skipped: number;
  errors: number;
  new_items_created: number;
  classifications: ClassifiedItem[];
}

// ── Weak-item detection ────────────────────────────────────

const SUMMARY_PATTERNS = [
  /^this (document|article|resource|video|podcast|content|section)/i,
  /discusses|explains|describes|covers|talks about|focuses on|provides an overview/i,
  /is important|is critical|is essential|is key|is vital/i,
  /in (this|the) (article|video|document|section|module|chapter)/i,
  /the (author|speaker|presenter) (says|mentions|discusses|argues|explains)/i,
];

const CONCEPT_PATTERNS = [
  /^(emotional intelligence|rapport|trust|empathy|listening|communication|leadership|mindset)/i,
  /is (a|the) (key|important|critical|essential) (factor|element|component|part)/i,
  /^(the importance of|understanding|why|how to think about)/i,
];

function isWeakItem(item: { title: string; tactic_summary: string | null; when_to_use: string | null; example_usage: string | null }): boolean {
  const summary = (item.tactic_summary ?? '').trim();
  const title = item.title.trim();

  // No tactic summary at all — truly empty
  if (!summary || summary.length < 10) return true;

  // Sounds like a document summary (only check summary, not title)
  if (SUMMARY_PATTERNS.some(p => p.test(summary))) return true;

  // Transcript fragment: title and summary are the same text (heuristic extractor artifact)
  if (summary.toLowerCase().startsWith(title.toLowerCase().slice(0, 30)) && !item.when_to_use && !item.example_usage) {
    return true;
  }

  // Title is just a generic chapter heading with no substance in summary
  if (/\s—\s(cold calling|discovery|objection handling|negotiation|competitors|messaging|closing|expansion|personas|stakeholder navigation)$/i.test(title) && summary.length < 30) {
    return true;
  }

  return false;
}

function isActionable(item: { title: string; tactic_summary: string | null }): boolean {
  const summary = (item.tactic_summary ?? '').trim();
  const title = item.title.trim();
  const verbStarters = /^(ask|use|open|start|say|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|try|respond|handle|counter|address|lead|drive|close|send|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|contrast|qualify|disqualify|recap|summarize)/i;
  return verbStarters.test(title) || verbStarters.test(summary);
}

function isDuplicate(item: any, allItems: any[]): boolean {
  const summary = (item.tactic_summary ?? '').toLowerCase().trim();
  if (!summary) return false;
  return allItems.some(other =>
    other.id !== item.id &&
    other.source_resource_id === item.source_resource_id &&
    (other.tactic_summary ?? '').toLowerCase().trim() === summary
  );
}

// ── Classification logic ───────────────────────────────────

export function classifyKnowledgeItem(item: any, allItems: any[]): ClassifiedItem {
  const base = {
    id: item.id,
    title: item.title,
    confidence: item.confidence_score ?? 0,
    source_resource_id: item.source_resource_id,
    chapter: item.chapter,
    active: item.active,
    user_edited: item.user_edited,
  };

  // Protected: never touch user-edited items
  if (item.user_edited) {
    return { ...base, classification: 'protected', reason: 'User-edited — will not auto-modify' };
  }

  // Archive: exact duplicates from same resource
  if (isDuplicate(item, allItems)) {
    return { ...base, classification: 'archive_or_delete', reason: 'Duplicate of another item from same resource' };
  }

  const summary = (item.tactic_summary ?? '').trim();
  const hasChapter = !!item.chapter;
  const hasContexts = Array.isArray(item.applies_to_contexts) && item.applies_to_contexts.length > 0;
  const conf = item.confidence_score ?? 0;

  // Truly weak: summary-like document descriptions, not tactics
  if (isWeakItem(item)) {
    if (item.source_resource_id) {
      return { ...base, classification: 'rewrite_from_source', reason: 'Summary-like — needs re-extraction from source resource' };
    }
    return { ...base, classification: 'archive_or_delete', reason: 'Weak/summary-like and no source resource to re-extract from' };
  }

  // Very low confidence AND very short summary — archive
  if (conf < 0.2 && summary.length < 20) {
    return { ...base, classification: 'archive_or_delete', reason: 'Very low confidence with minimal content' };
  }

  // Keep as-is: already active and has reasonable content
  if (item.active && summary.length >= 15) {
    return { ...base, classification: 'keep_as_is', reason: 'Active with substantive content' };
  }

  // Activate now: meets reasonable criteria but inactive
  if (!item.active && conf >= 0.45 && summary.length >= 15 && !isWeakItem(item)) {
    return { ...base, classification: 'activate_now', reason: `Meets activation criteria (conf=${(conf * 100).toFixed(0)}%) but inactive` };
  }

  // Low confidence with source — rewrite opportunity
  if (conf < 0.3 && item.source_resource_id) {
    return { ...base, classification: 'rewrite_from_source', reason: 'Low confidence — re-extract from source' };
  }

  // Default: keep as-is if nothing else matches
  return { ...base, classification: 'keep_as_is', reason: 'Passes minimum quality checks' };
}

// ── Scan-only (dry run) ────────────────────────────────────

export async function scanExistingKnowledge(): Promise<BackfillReport> {
  const { data: items, error } = await supabase
    .from(KI_TABLE)
    .select('id, title, tactic_summary, when_to_use, when_not_to_use, example_usage, chapter, knowledge_type, confidence_score, active, user_edited, source_resource_id, applies_to_contexts, tags, status')
    .order('created_at', { ascending: false });

  if (error) throw error;
  const allItems = (items ?? []) as any[];

  const classifications = allItems.map(item => classifyKnowledgeItem(item, allItems));

  return {
    total_scanned: allItems.length,
    kept: classifications.filter(c => c.classification === 'keep_as_is').length,
    activated: classifications.filter(c => c.classification === 'activate_now').length,
    rewritten: classifications.filter(c => c.classification === 'rewrite_from_source').length,
    archived: classifications.filter(c => c.classification === 'archive_or_delete').length,
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
  const { data: items, error } = await supabase
    .from(KI_TABLE)
    .select('id, title, tactic_summary, when_to_use, when_not_to_use, example_usage, chapter, knowledge_type, confidence_score, active, user_edited, source_resource_id, applies_to_contexts, tags, status')
    .order('created_at', { ascending: false });

  if (error) throw error;
  const allItems = (items ?? []) as any[];
  const classifications = allItems.map(item => classifyKnowledgeItem(item, allItems));

  let activated = 0;
  let rewritten = 0;
  let archived = 0;
  let newItemsCreated = 0;
  let errors = 0;

  const toProcess = classifications.filter(c => {
    if (c.classification === 'protected' || c.classification === 'keep_as_is') return false;
    if (mode === 'activate') return c.classification === 'activate_now';
    if (mode === 'rewrite') return c.classification === 'rewrite_from_source';
    if (mode === 'archive') return c.classification === 'archive_or_delete';
    return true; // full
  });

  const total = toProcess.length;

  for (let i = 0; i < toProcess.length; i++) {
    const c = toProcess[i];
    onProgress?.(i + 1, total);

    try {
      if (c.classification === 'activate_now') {
        const { error: actErr } = await supabase
          .from(KI_TABLE)
          .update({
            active: true,
            status: 'active',
            activation_metadata: {
              activation_source: 'ki_backfill',
              activation_reason: c.reason,
              activation_timestamp: new Date().toISOString(),
              activation_rule_version: '3.0-backfill',
            },
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', c.id);
        if (!actErr) activated++;
        else errors++;
      }

      if (c.classification === 'rewrite_from_source' && c.source_resource_id) {
        // Fetch source resource content
        const { data: resource } = await supabase
          .from('resources')
          .select('id, title, content, description, tags, resource_type')
          .eq('id', c.source_resource_id)
          .single();

        if (resource && resource.content && resource.content.length >= 100) {
          const { data: userData } = await supabase.auth.getUser();
          const userId = userData?.user?.id;
          if (!userId) { errors++; continue; }

          const source: ExtractionSource = {
            resourceId: resource.id,
            userId,
            title: resource.title,
            content: resource.content,
            description: resource.description,
            tags: resource.tags ?? [],
            resourceType: resource.resource_type ?? 'document',
          };

          // Try heuristic first, then LLM fallback
          let newItems = extractKnowledgeHeuristic(source);
          if (newItems.length === 0) {
            newItems = await extractKnowledgeLLMFallback(source);
          }

          if (newItems.length > 0) {
            // Archive the weak item
            await supabase.from(KI_TABLE).update({
              status: 'stale',
              active: false,
              updated_at: new Date().toISOString(),
            } as any).eq('id', c.id);

            // Check for existing items from same resource to avoid duplicates
            const { data: existingFromResource } = await supabase
              .from(KI_TABLE)
              .select('tactic_summary')
              .eq('source_resource_id', c.source_resource_id)
              .neq('id', c.id);

            const existingSummaries = new Set(
              ((existingFromResource ?? []) as any[]).map(e => (e.tactic_summary ?? '').toLowerCase().trim())
            );

            const deduped = newItems.filter(n =>
              !existingSummaries.has((n.tactic_summary ?? '').toLowerCase().trim())
            );

            if (deduped.length > 0) {
              const { data: inserted, error: insErr } = await supabase
                .from(KI_TABLE)
                .insert(deduped as any)
                .select('id');
              if (!insErr && inserted) {
                newItemsCreated += inserted.length;
              } else if (insErr) {
                log.warn('Failed to insert rewritten items', { error: insErr.message });
                errors++;
              }
            }
            rewritten++;
          } else {
            // Could not produce better items — archive the weak one
            await supabase.from(KI_TABLE).update({
              status: 'stale',
              active: false,
              updated_at: new Date().toISOString(),
            } as any).eq('id', c.id);
            archived++;
          }
        } else {
          // No source content available — just archive
          await supabase.from(KI_TABLE).update({
            status: 'stale',
            active: false,
            updated_at: new Date().toISOString(),
          } as any).eq('id', c.id);
          archived++;
        }
      }

      if (c.classification === 'archive_or_delete') {
        await supabase.from(KI_TABLE).update({
          status: 'stale',
          active: false,
          updated_at: new Date().toISOString(),
        } as any).eq('id', c.id);
        archived++;
      }
    } catch (err) {
      log.warn('Backfill error for item', { id: c.id, error: err });
      errors++;
    }
  }

  const kept = classifications.filter(c => c.classification === 'keep_as_is').length;
  const protectedCount = classifications.filter(c => c.classification === 'protected').length;

  log.info('KI Backfill complete', {
    total_scanned: allItems.length, kept, activated, rewritten, archived,
    protected_skipped: protectedCount, new_items_created: newItemsCreated, errors,
  });

  return {
    total_scanned: allItems.length,
    kept,
    activated,
    rewritten,
    archived,
    protected_skipped: protectedCount,
    errors,
    new_items_created: newItemsCreated,
    classifications,
  };
}

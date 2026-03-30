/**
 * Knowledge Retrieval Layer
 *
 * Provides active knowledge items to Dave, roleplay, prep, and other
 * downstream contexts. This replaces the localStorage-based doctrine
 * propagation with real database-backed knowledge.
 */

import { supabase } from '@/integrations/supabase/client';
import type { KnowledgeItem } from '@/hooks/useKnowledgeItems';
import { createLogger } from '@/lib/logger';

const log = createLogger('KnowledgeRetrieval');

const TABLE = 'knowledge_items' as any;

export interface KnowledgeQuery {
  chapters?: string[];
  knowledgeType?: ('skill' | 'product' | 'competitive')[];
  competitor?: string;
  productArea?: string;
  context?: string; // 'dave' | 'roleplay' | 'prep' | 'coaching' | 'playbooks'
  activeOnly?: boolean;
  maxItems?: number;
}

/**
 * Retrieve knowledge items matching a query
 */
export async function queryKnowledge(query: KnowledgeQuery = {}): Promise<KnowledgeItem[]> {
  const { chapters, knowledgeType, competitor, productArea, context, activeOnly = true, maxItems = 20 } = query;

  let q = supabase.from(TABLE).select('*').order('confidence_score', { ascending: false }).limit(maxItems);

  if (activeOnly) q = q.eq('active', true);
  if (chapters?.length) q = q.in('chapter', chapters);
  if (knowledgeType?.length) q = q.in('knowledge_type', knowledgeType);
  if (competitor) q = q.eq('competitor_name', competitor);
  if (productArea) q = q.eq('product_area', productArea);
  if (context) q = q.contains('applies_to_contexts', [context]);

  const { data, error } = await q;
  if (error) {
    log.error('Knowledge query failed', { error });
    return [];
  }

  return (data ?? []) as unknown as KnowledgeItem[];
}

/**
 * Build a Dave system prompt section from active knowledge
 */
export async function getDaveKnowledgeContext(opts?: {
  chapters?: string[];
  competitor?: string;
  maxItems?: number;
}): Promise<string> {
  const items = await queryKnowledge({
    chapters: opts?.chapters,
    competitor: opts?.competitor,
    context: 'dave',
    activeOnly: true,
    maxItems: opts?.maxItems ?? 15,
  });

  if (items.length === 0) return '';

  const sections: string[] = [];

  // Group by chapter
  const byChapter = new Map<string, KnowledgeItem[]>();
  for (const item of items) {
    if (!byChapter.has(item.chapter)) byChapter.set(item.chapter, []);
    byChapter.get(item.chapter)!.push(item);
  }

  for (const [chapter, chapterItems] of byChapter) {
    const label = chapter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const bullets = chapterItems.map(item => {
      let line = `• ${item.title}`;
      if (item.tactic_summary) line += `: ${item.tactic_summary}`;
      if (item.competitor_name) line += ` [vs ${item.competitor_name}]`;
      return line;
    });
    sections.push(`**${label}**\n${bullets.join('\n')}`);
  }

  return `\n--- Active Sales Knowledge ---\n${sections.join('\n\n')}\n--- End Knowledge ---`;
}

/**
 * Build roleplay grounding from active knowledge for a specific chapter
 */
export async function getRoleplayKnowledge(chapter?: string): Promise<{
  tactics: string[];
  objections: string[];
  antiPatterns: string[];
  talkTracks: string[];
  competitiveAngles: string[];
}> {
  const items = await queryKnowledge({
    chapters: chapter ? [chapter] : undefined,
    context: 'roleplay',
    activeOnly: true,
    maxItems: 20,
  });

  const tactics: string[] = [];
  const objections: string[] = [];
  const antiPatterns: string[] = [];
  const talkTracks: string[] = [];
  const competitiveAngles: string[] = [];

  for (const item of items) {
    if (item.tactic_summary) tactics.push(item.tactic_summary);
    if (item.chapter === 'objection_handling' && item.tactic_summary) objections.push(item.tactic_summary);
    if (item.when_not_to_use) antiPatterns.push(item.when_not_to_use);
    if (item.example_usage) talkTracks.push(item.example_usage);
    if (item.knowledge_type === 'competitive' && item.tactic_summary) competitiveAngles.push(item.tactic_summary);
  }

  return { tactics, objections, antiPatterns, talkTracks, competitiveAngles };
}

/**
 * Get a count of operationalized resources
 * A resource is operationalized when it has at least one active knowledge item
 */
export async function getOperationalizedCount(): Promise<{ operationalized: number; total: number }> {
  const { data: activeItems } = await supabase
    .from(TABLE)
    .select('source_resource_id')
    .eq('active', true)
    .not('source_resource_id', 'is', null);

  const uniqueResourceIds = new Set((activeItems ?? []).map((i: any) => i.source_resource_id));

  const { count } = await supabase
    .from('resources')
    .select('id', { count: 'exact', head: true })
    .in('enrichment_status', ['enriched', 'deep_enriched', 'verified']);

  return {
    operationalized: uniqueResourceIds.size,
    total: count ?? 0,
  };
}

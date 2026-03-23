/**
 * Data access layer for intelligence_units and knowledge_signals tables.
 */
import { supabase } from '@/integrations/supabase/client';
import type { IdeaMaturity, ExtractedInsight, TrendSignal } from '@/lib/knowledgeIntelligence';

// ── Types ───────────────────────────────────────────────────────

export interface IntelligenceUnitRow {
  id: string;
  user_id: string;
  resource_id: string;
  chunk_id: string | null;
  unit_type: string;
  text: string;
  category: string | null;
  extraction_version: string;
  extracted_at: string;
  extraction_confidence: number;
  support_count: number;
  source_diversity: number;
  consistency_score: number;
  idea_maturity: string;
  conflicts: any[];
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSignalRow {
  id: string;
  user_id: string;
  resource_id: string;
  theme: string;
  author_or_speaker: string | null;
  signal_timestamp: string;
  confidence: number;
  relevance: number;
  created_at: string;
}

// ── Intelligence Units ──────────────────────────────────────────

export async function getIntelligenceUnits(filters?: {
  resourceId?: string;
  unitType?: string;
  maturity?: IdeaMaturity;
  category?: string;
  limit?: number;
}): Promise<IntelligenceUnitRow[]> {
  let query = (supabase as any)
    .from('intelligence_units')
    .select('*')
    .order('support_count', { ascending: false });

  if (filters?.resourceId) query = query.eq('resource_id', filters.resourceId);
  if (filters?.unitType) query = query.eq('unit_type', filters.unitType);
  if (filters?.maturity) query = query.eq('idea_maturity', filters.maturity);
  if (filters?.category) query = query.eq('category', filters.category);
  query = query.limit(filters?.limit || 100);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as IntelligenceUnitRow[];
}

export async function upsertIntelligenceUnits(
  units: Omit<IntelligenceUnitRow, 'id' | 'created_at' | 'updated_at'>[],
): Promise<void> {
  if (!units.length) return;
  const { error } = await (supabase as any)
    .from('intelligence_units')
    .upsert(
      units.map(u => ({ ...u, updated_at: new Date().toISOString() })),
      { onConflict: 'id' },
    );
  if (error) throw error;
}

export async function deleteIntelligenceUnits(resourceId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('intelligence_units')
    .delete()
    .eq('resource_id', resourceId);
  if (error) throw error;
}

// ── Knowledge Signals ───────────────────────────────────────────

export async function getKnowledgeSignals(filters?: {
  theme?: string;
  limit?: number;
}): Promise<KnowledgeSignalRow[]> {
  let query = (supabase as any)
    .from('knowledge_signals')
    .select('*')
    .order('signal_timestamp', { ascending: false });

  if (filters?.theme) query = query.ilike('theme', `%${filters.theme}%`);
  query = query.limit(filters?.limit || 200);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as KnowledgeSignalRow[];
}

export async function upsertKnowledgeSignals(
  signals: Omit<KnowledgeSignalRow, 'id' | 'created_at'>[],
): Promise<void> {
  if (!signals.length) return;
  const { error } = await (supabase as any)
    .from('knowledge_signals')
    .insert(signals);
  if (error) throw error;
}

// ── Conversion helpers ──────────────────────────────────────────

export function rowToExtractedInsight(row: IntelligenceUnitRow): ExtractedInsight {
  return {
    id: row.id,
    text: row.text,
    category: row.category || 'general',
    provenance: {
      source_content_id: row.resource_id,
      source_chunk_id: row.chunk_id,
      extracted_at: row.extracted_at,
      extraction_version: row.extraction_version,
      extraction_confidence: row.extraction_confidence,
    },
    support_count: row.support_count,
    source_diversity: row.source_diversity,
    consistency_score: row.consistency_score,
    idea_maturity: row.idea_maturity as IdeaMaturity,
    conflicts: row.conflicts || [],
  };
}

export function rowToTrendSignal(row: KnowledgeSignalRow): TrendSignal {
  return {
    theme: row.theme,
    source_content_id: row.resource_id,
    author_or_speaker: row.author_or_speaker,
    timestamp: row.signal_timestamp,
    confidence: row.confidence,
    relevance: row.relevance,
  };
}

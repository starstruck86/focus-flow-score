/**
 * Fetches full resource detail + knowledge items for the inspect drawer.
 */
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ResourceDetail {
  id: string;
  title: string;
  resource_type: string;
  content: string | null;
  content_length: number | null;
  content_status: string;
  content_classification: string | null;
  enrichment_status: string;
  enriched_at: string | null;
  original_url: string | null;
  file_url: string | null;
  source_resource_id: string | null;
  show_title: string | null;
  author_or_speaker: string | null;
  description: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
  transcript_status: string | null;
  extraction_method: string | null;
  extraction_attempt_count: number;
  extraction_depth_bucket: string | null;
  extraction_batch_status: string | null;
  extraction_batch_total: number | null;
  extraction_batches_completed: number | null;
  last_extraction_completed_at: string | null;
  last_extraction_run_status: string | null;
  last_extraction_saved_ki_count: number | null;
  last_extraction_returned_ki_count: number | null;
  last_extraction_error: string | null;
  last_extraction_summary: string | null;
  last_quality_score: number | null;
  last_quality_tier: string | null;
  current_resource_ki_count: number | null;
  block_reason: string | null;
  failure_reason: string | null;
  recovery_queue_bucket: string | null;
  enrichment_audit_log: any;
  extraction_audit_summary: any;
  manual_content_present: boolean | null;
  host_platform: string | null;
}

export interface KnowledgeItemDetail {
  id: string;
  title: string;
  active: boolean;
  applies_to_contexts: string[];
  knowledge_type: string;
  confidence_score: number;
  source_excerpt: string | null;
  source_heading: string | null;
  source_segment_index: number | null;
  source_char_range: any;
  tactic_summary: string | null;
  why_it_matters: string | null;
  when_to_use: string | null;
  example_usage: string | null;
  extraction_method: string | null;
  created_at: string;
  review_status: string;
  status: string;
  chapter: string;
  tags: string[];
}

export interface ResourceInspectData {
  resource: ResourceDetail | null;
  knowledgeItems: KnowledgeItemDetail[];
  loading: boolean;
  error: string | null;
}

const RESOURCE_FIELDS = `
  id, title, resource_type, content, content_length, content_status,
  content_classification, enrichment_status, enriched_at, original_url,
  file_url, source_resource_id, show_title, author_or_speaker, description,
  tags, created_at, updated_at, transcript_status, extraction_method,
  extraction_attempt_count, extraction_depth_bucket, extraction_batch_status,
  extraction_batch_total, extraction_batches_completed, last_extraction_completed_at,
  last_extraction_run_status, last_extraction_saved_ki_count,
  last_extraction_returned_ki_count, last_extraction_error,
  last_extraction_summary, last_quality_score, last_quality_tier,
  current_resource_ki_count, block_reason, failure_reason,
  recovery_queue_bucket, enrichment_audit_log, extraction_audit_summary,
  manual_content_present, host_platform
`.replace(/\n/g, '');

const KI_FIELDS = `
  id, title, active, applies_to_contexts, knowledge_type, confidence_score,
  source_excerpt, source_heading, source_segment_index, source_char_range,
  tactic_summary, why_it_matters, when_to_use, example_usage,
  extraction_method, created_at, review_status, status, chapter, tags
`.replace(/\n/g, '');

export function useResourceInspectData(resourceId: string | null): ResourceInspectData {
  const [resource, setResource] = useState<ResourceDetail | null>(null);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItemDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!resourceId) {
      setResource(null);
      setKnowledgeItems([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      const [resResult, kiResult] = await Promise.all([
        supabase.from('resources').select(RESOURCE_FIELDS).eq('id', resourceId!).single(),
        supabase.from('knowledge_items' as any).select(KI_FIELDS)
          .eq('source_resource_id', resourceId!)
          .order('created_at', { ascending: false }),
      ]);

      if (cancelled) return;

      if (resResult.error) {
        setError(resResult.error.message);
        setLoading(false);
        return;
      }

      setResource(resResult.data as any);
      setKnowledgeItems((kiResult.data ?? []) as any);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [resourceId]);

  return { resource, knowledgeItems, loading, error };
}

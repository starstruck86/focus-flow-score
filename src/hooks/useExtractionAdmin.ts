import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ExtractionAttemptRow {
  id: string;
  resource_id: string;
  attempt_number: number;
  strategy: string;
  ki_count: number;
  raw_item_count: number;
  validated_count: number;
  deduped_count: number;
  min_ki_floor: number;
  floor_met: boolean;
  failure_type: string | null;
  status: string;
  duration_ms: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ExtractionResourceSummary {
  id: string;
  title: string;
  enrichment_status: string | null;
  extraction_attempt_count: number | null;
  max_extraction_attempts: number | null;
  extraction_failure_type: string | null;
  extractor_strategy: string | null;
  extraction_retry_eligible: boolean | null;
  next_retry_at: string | null;
  retry_scheduled_at: string | null;
  extraction_audit_summary: any;
  resource_type: string | null;
  content_length: number | null;
  updated_at: string;
}

export function useExtractionResourceList(filters: {
  status?: string;
  failureType?: string;
  retryDueNow?: boolean;
  requiresReview?: boolean;
  lessonsOnly?: boolean;
}) {
  return useQuery({
    queryKey: ['extraction-admin-list', filters],
    queryFn: async () => {
      let query = supabase
        .from('resources')
        .select('id, title, enrichment_status, extraction_attempt_count, max_extraction_attempts, extraction_failure_type, extractor_strategy, extraction_retry_eligible, next_retry_at, retry_scheduled_at, extraction_audit_summary, resource_type, content_length, updated_at')
        .not('extraction_attempt_count', 'is', null)
        .gt('extraction_attempt_count', 0)
        .order('updated_at', { ascending: false })
        .limit(200);

      if (filters.status) {
        query = query.eq('enrichment_status', filters.status);
      }
      if (filters.failureType) {
        query = query.eq('extraction_failure_type', filters.failureType);
      }
      if (filters.requiresReview) {
        query = query.eq('enrichment_status', 'extraction_requires_review');
      }
      if (filters.lessonsOnly) {
        query = query.eq('resource_type', 'video');
      }

      const { data, error } = await query;
      if (error) throw error;

      let results = (data || []) as ExtractionResourceSummary[];

      if (filters.retryDueNow) {
        const now = new Date().toISOString();
        results = results.filter(r =>
          r.enrichment_status === 'extraction_retrying' &&
          (!r.next_retry_at || r.next_retry_at <= now)
        );
      }

      return results;
    },
    refetchInterval: 30000,
  });
}

export function useExtractionAttempts(resourceId: string | null) {
  return useQuery({
    queryKey: ['extraction-attempts', resourceId],
    queryFn: async () => {
      if (!resourceId) return [];
      const { data, error } = await supabase
        .from('resource_extraction_attempts')
        .select('*')
        .eq('resource_id', resourceId)
        .order('attempt_number', { ascending: true });
      if (error) throw error;
      return (data || []) as ExtractionAttemptRow[];
    },
    enabled: !!resourceId,
  });
}

export function useExtractionResourceDetail(resourceId: string | null) {
  return useQuery({
    queryKey: ['extraction-resource-detail', resourceId],
    queryFn: async () => {
      if (!resourceId) return null;
      const { data, error } = await supabase
        .from('resources')
        .select('id, title, enrichment_status, extraction_attempt_count, max_extraction_attempts, extraction_failure_type, extractor_strategy, extraction_retry_eligible, next_retry_at, retry_scheduled_at, extraction_audit_summary, resource_type, content_length, updated_at')
        .eq('id', resourceId)
        .single();
      if (error) throw error;
      return data as ExtractionResourceSummary;
    },
    enabled: !!resourceId,
  });
}

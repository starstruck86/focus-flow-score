/**
 * useActiveJobQueue — Canonical hook for real job-based Processing counts.
 *
 * Queries background_jobs + podcast_import_queue for actual in-flight work.
 * Refreshes via realtime subscription + periodic polling.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const STALE_THRESHOLD_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 15_000;

export type QueueJobStatus = 'running' | 'queued' | 'retrying' | 'stalled';

export interface QueueJob {
  id: string;
  resourceTitle: string;
  jobType: string;
  status: QueueJobStatus;
  stepLabel: string | null;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
  progressPercent: number | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  error: string | null;
  entityId: string | null;
  retryCount?: number;
  source: 'background_jobs' | 'podcast_queue';
}

export interface QueueSummary {
  total: number;
  running: number;
  queued: number;
  retrying: number;
  stalled: number;
  byType: Record<string, number>;
}

export interface ActiveJobQueueState {
  jobs: QueueJob[];
  summary: QueueSummary;
  loading: boolean;
  refresh: () => void;
}

function classifyStatus(status: string, updatedAt: string, substatus?: string | null): QueueJobStatus {
  if (substatus === 'retrying' || status === 'retrying') return 'retrying';
  if (status === 'queued' || status === 'waiting_on_dependency' || substatus === 'waiting_on_dependency') {
    return 'queued';
  }
  if (status === 'running' || status === 'processing' || status === 'awaiting_review') {
    const elapsed = Date.now() - new Date(updatedAt).getTime();
    if (elapsed > STALE_THRESHOLD_MS) return 'stalled';
    return 'running';
  }
  return 'queued';
}

function normalizeJobType(type: string): string {
  const map: Record<string, string> = {
    extraction: 'extraction',
    re_extraction: 'extraction',
    batch_extract_kis: 'extraction',
    'batch-extract-kis': 'extraction',
    extract_tactics: 'extraction',
    'extract-tactics': 'extraction',
    enrichment: 'enrichment',
    re_enrichment: 'enrichment',
    deep_enrich: 'enrichment',
    remediation: 'remediation',
    activation: 'activation',
    digest_generation: 'digest',
    auth_re_import: 'auth re-import',
    podcast_import: 'podcast import',
    ki_generation: 'extraction',
    transcript_preprocessing: 'transcript',
    transcribe_audio: 'transcript',
    bulk_action: 'bulk action',
    playbook_generation: 'playbook',
    parse: 'parse',
    pdf_parse: 'parse',
  };
  return map[type] || type.replace(/_/g, ' ');
}

export function useActiveJobQueue(): ActiveJobQueueState {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchJobs = useCallback(async () => {
    if (!user?.id) {
      if (mountedRef.current) {
        setJobs([]);
        setLoading(false);
      }
      return;
    }

    const [bgResult, podcastResult] = await Promise.all([
      supabase
        .from('background_jobs')
        .select('id, type, title, status, substatus, step_label, started_at, created_at, updated_at, progress_percent, progress_current, progress_total, error, entity_id')
        .eq('user_id', user.id)
        .in('status', ['queued', 'running', 'retrying', 'waiting_on_dependency', 'awaiting_review'])
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('podcast_import_queue')
        .select('id, episode_title, status, pipeline_stage, created_at, updated_at, error_message, resource_id')
        .eq('user_id', user.id)
        .in('status', ['queued', 'processing'])
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    if (!mountedRef.current) return;

    const allJobs: QueueJob[] = [];

    if (bgResult.data) {
      for (const row of bgResult.data) {
        allJobs.push({
          id: row.id,
          resourceTitle: row.title || 'Unknown',
          jobType: normalizeJobType(row.type),
          status: classifyStatus(row.status, row.updated_at, row.substatus),
          stepLabel: row.step_label,
          startedAt: row.started_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          progressPercent: row.progress_percent,
          progressCurrent: row.progress_current,
          progressTotal: row.progress_total,
          error: row.error,
          entityId: row.entity_id,
          source: 'background_jobs',
        });
      }
    }

    if (podcastResult.data) {
      for (const row of podcastResult.data) {
        allJobs.push({
          id: row.id,
          resourceTitle: row.episode_title || 'Podcast Episode',
          jobType: 'podcast import',
          status: row.status === 'queued' ? 'queued' : classifyStatus('processing', row.updated_at),
          stepLabel: row.pipeline_stage || null,
          startedAt: row.status === 'processing' ? row.updated_at : null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          progressPercent: null,
          progressCurrent: null,
          progressTotal: null,
          error: row.error_message,
          entityId: row.resource_id,
          source: 'podcast_queue',
        });
      }
    }

    setJobs(allJobs);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    mountedRef.current = true;
    fetchJobs();
    const interval = setInterval(fetchJobs, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchJobs]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`active-job-queue:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'background_jobs',
          filter: `user_id=eq.${user.id}`,
        },
        fetchJobs,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'podcast_import_queue',
          filter: `user_id=eq.${user.id}`,
        },
        fetchJobs,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, fetchJobs]);

  const summary = useMemo<QueueSummary>(() => {
    const next: QueueSummary = {
      total: 0,
      running: 0,
      queued: 0,
      retrying: 0,
      stalled: 0,
      byType: {},
    };

    for (const job of jobs) {
      next.total += 1;
      next[job.status] += 1;
      next.byType[job.jobType] = (next.byType[job.jobType] || 0) + 1;
    }

    return next;
  }, [jobs]);

  return { jobs, summary, loading, refresh: fetchJobs };
}

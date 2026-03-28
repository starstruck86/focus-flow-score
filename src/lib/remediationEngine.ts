/**
 * Remediation Engine
 * 
 * Consumes verification results and executes recovery actions per fixability queue.
 * Each action maps to a real DB mutation via the resource lifecycle system.
 */
import { supabase } from '@/integrations/supabase/client';
import type { VerifiedResource, FixabilityBucket } from './enrichmentVerification';

// ── Action Queue Types ────────────────────────────────────

export type RemediationQueue =
  | 'auto_fix_now'
  | 'retry_different_strategy'
  | 'needs_transcript'
  | 'needs_pasted_content'
  | 'needs_access_auth'
  | 'needs_alternate_source'
  | 'accept_metadata_only'
  | 'needs_quarantine'
  | 'bad_scoring_state_bug';

export const QUEUE_LABELS: Record<RemediationQueue, string> = {
  auto_fix_now: 'Auto Fix Now',
  retry_different_strategy: 'Retry Different Strategy',
  needs_transcript: 'Needs Transcript',
  needs_pasted_content: 'Needs Pasted Content',
  needs_access_auth: 'Needs Access/Auth',
  needs_alternate_source: 'Needs Alternate Source',
  accept_metadata_only: 'Accept Metadata Only',
  needs_quarantine: 'Quarantined',
  bad_scoring_state_bug: 'State/Scoring Bug',
};

export const QUEUE_DESCRIPTIONS: Record<RemediationQueue, string> = {
  auto_fix_now: 'Valid source, can re-enrich automatically',
  retry_different_strategy: 'Needs a different extraction approach',
  needs_transcript: 'Audio/podcast requiring transcript paste',
  needs_pasted_content: 'Auth-gated or inaccessible — paste content',
  needs_access_auth: 'Requires authentication to access source',
  needs_alternate_source: 'Multiple failures — provide a different URL',
  accept_metadata_only: 'No enrichable content — accept as metadata',
  needs_quarantine: 'Repeated failures — removed from auto-retry',
  bad_scoring_state_bug: 'Score and status contradict — needs reconciliation',
};

export const QUEUE_ACTIONS: Record<RemediationQueue, string> = {
  auto_fix_now: 'Reset to not_enriched so next batch picks them up',
  retry_different_strategy: 'Reset with cleared failure, allow retry',
  needs_transcript: 'Mark as manual_input_needed',
  needs_pasted_content: 'Mark as manual_input_needed',
  needs_access_auth: 'Mark as manual_input_needed',
  needs_alternate_source: 'Mark as manual_input_needed',
  accept_metadata_only: 'Accept current state as metadata-only complete',
  needs_quarantine: 'Set quarantined status',
  bad_scoring_state_bug: 'Re-validate quality and reconcile status',
};

// Maps fixability buckets to remediation queues
const BUCKET_TO_QUEUE: Record<string, RemediationQueue | null> = {
  auto_fix_now: 'auto_fix_now',
  retry_different_strategy: 'retry_different_strategy',
  needs_alternate_source: 'needs_alternate_source',
  needs_transcript: 'needs_transcript',
  needs_pasted_content: 'needs_pasted_content',
  needs_access_auth: 'needs_access_auth',
  accept_metadata_only: 'accept_metadata_only',
  needs_quarantine: 'needs_quarantine',
  bad_scoring_state_bug: 'bad_scoring_state_bug',
  already_fixed_stale_ui: 'bad_scoring_state_bug',
  true_unsupported: null,
  truly_complete: null,
};

// ── Build Queues from Verified Resources ──────────────────

export function buildRemediationQueues(
  verified: VerifiedResource[]
): Record<RemediationQueue, VerifiedResource[]> {
  const queues: Record<RemediationQueue, VerifiedResource[]> = {
    auto_fix_now: [],
    retry_different_strategy: [],
    needs_transcript: [],
    needs_pasted_content: [],
    needs_access_auth: [],
    needs_alternate_source: [],
    accept_metadata_only: [],
    needs_quarantine: [],
    bad_scoring_state_bug: [],
  };

  for (const v of verified) {
    const queue = BUCKET_TO_QUEUE[v.fixabilityBucket];
    if (queue) {
      queues[queue].push(v);
    }
  }

  return queues;
}

// ── Bulk Action Results ───────────────────────────────────

export interface BulkActionResult {
  queue: RemediationQueue;
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ id: string; title: string; error: string }>;
}

// ── Execute Bulk Actions ──────────────────────────────────

export async function executeBulkAction(
  queue: RemediationQueue,
  resources: VerifiedResource[],
): Promise<BulkActionResult> {
  const result: BulkActionResult = {
    queue,
    attempted: resources.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  if (resources.length === 0) return result;

  const ids = resources.map(r => r.id);

  switch (queue) {
    case 'auto_fix_now': {
      // Reset to not_enriched so the next enrich batch picks them up
      const { error } = await supabase
        .from('resources')
        .update({
          enrichment_status: 'not_enriched',
          failure_reason: null,
          last_status_change_at: new Date().toISOString(),
        } as any)
        .in('id', ids);
      if (error) {
        result.failed = ids.length;
        result.errors.push({ id: 'bulk', title: 'All', error: error.message });
      } else {
        result.succeeded = ids.length;
      }
      break;
    }

    case 'retry_different_strategy': {
      // Reset failure state, clear failure_reason so a different strategy can be tried
      const { error } = await supabase
        .from('resources')
        .update({
          enrichment_status: 'not_enriched',
          failure_reason: null,
          failure_count: 0,
          last_status_change_at: new Date().toISOString(),
        } as any)
        .in('id', ids);
      if (error) {
        result.failed = ids.length;
        result.errors.push({ id: 'bulk', title: 'All', error: error.message });
      } else {
        result.succeeded = ids.length;
      }
      break;
    }

    case 'needs_transcript':
    case 'needs_pasted_content':
    case 'needs_access_auth':
    case 'needs_alternate_source': {
      // Mark as needing manual input — set incomplete with descriptive failure_reason
      const reasonMap: Record<string, string> = {
        needs_transcript: 'Transcript required — paste transcript via Manual Assist',
        needs_pasted_content: 'Content inaccessible — paste content via Manual Assist',
        needs_access_auth: 'Authentication required — provide access or paste content',
        needs_alternate_source: 'Multiple extraction failures — provide alternate URL',
      };
      const { error } = await supabase
        .from('resources')
        .update({
          enrichment_status: 'incomplete',
          failure_reason: reasonMap[queue],
          last_status_change_at: new Date().toISOString(),
        } as any)
        .in('id', ids);
      if (error) {
        result.failed = ids.length;
        result.errors.push({ id: 'bulk', title: 'All', error: error.message });
      } else {
        result.succeeded = ids.length;
      }
      break;
    }

    case 'accept_metadata_only': {
      // Accept as complete with metadata-only quality
      const { error } = await supabase
        .from('resources')
        .update({
          enrichment_status: 'deep_enriched',
          failure_reason: null,
          last_quality_tier: 'metadata_only',
          last_status_change_at: new Date().toISOString(),
          enriched_at: new Date().toISOString(),
        } as any)
        .in('id', ids);
      if (error) {
        result.failed = ids.length;
        result.errors.push({ id: 'bulk', title: 'All', error: error.message });
      } else {
        result.succeeded = ids.length;
      }
      break;
    }

    case 'needs_quarantine': {
      const { error } = await supabase
        .from('resources')
        .update({
          enrichment_status: 'quarantined',
          last_status_change_at: new Date().toISOString(),
        } as any)
        .in('id', ids);
      if (error) {
        result.failed = ids.length;
        result.errors.push({ id: 'bulk', title: 'All', error: error.message });
      } else {
        result.succeeded = ids.length;
      }
      break;
    }

    case 'bad_scoring_state_bug': {
      // For each, re-evaluate and reconcile
      for (const resource of resources) {
        try {
          const update: Record<string, any> = {
            last_status_change_at: new Date().toISOString(),
          };

          if (resource.qualityScore >= 95 && resource.enrichmentStatus !== 'deep_enriched') {
            // High score but wrong status → promote
            update.enrichment_status = 'deep_enriched';
            update.failure_reason = null;
            update.enriched_at = new Date().toISOString();
          } else if (resource.qualityScore < 50 && resource.enrichmentStatus === 'deep_enriched') {
            // Low score but marked complete → downgrade
            update.enrichment_status = 'incomplete';
            update.failure_reason = `Reconciled: score ${resource.qualityScore} too low for deep_enriched`;
          } else if (resource.enrichmentStatus === 'deep_enriched' && resource.qualityScore < 70) {
            update.enrichment_status = 'incomplete';
            update.failure_reason = `Reconciled: score ${resource.qualityScore} below threshold`;
          } else {
            // Stale UI — clear failure_reason
            update.failure_reason = null;
          }

          const { error } = await supabase
            .from('resources')
            .update(update as any)
            .eq('id', resource.id);

          if (error) {
            result.failed++;
            result.errors.push({ id: resource.id, title: resource.title, error: error.message });
          } else {
            result.succeeded++;
          }
        } catch (e: any) {
          result.failed++;
          result.errors.push({ id: resource.id, title: resource.title, error: e.message });
        }
      }
      break;
    }
  }

  return result;
}

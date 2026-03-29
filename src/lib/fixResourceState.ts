/**
 * fixResourceStateFromContent — 1-click repair for resources with valid content
 * but stale failure/blocker state.
 *
 * RULE: CONTENT ALWAYS WINS OVER FAILURE.
 *
 * If a resource has substantial content (>1000 chars, manual_content_present,
 * or actual content text >1000 chars), this function clears all stale blocker
 * state and marks the resource as resolved.
 */

import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';

// ── Types ─────────────────────────────────────────────────

export interface FixResult {
  success: boolean;
  message: string;
  fieldsCleared: string[];
  previousStatus?: string;
  newStatus?: string;
}

// ── Eligibility check ─────────────────────────────────────

export function isFixEligible(resource: any): boolean {
  const contentLength = resource.content_length ?? 0;
  const manualPresent = resource.manual_content_present === true;
  const actualContent = typeof resource.content === 'string' ? resource.content.trim().length : 0;
  const hasValidContent = contentLength > 1000 || manualPresent || actualContent > 1000;

  if (!hasValidContent) return false;

  // Check if resource is in a stale/blocked state
  const status = resource.enrichment_status;
  const isBlockedStatus = ['failed', 'incomplete', 'not_enriched', 'stale', 'quarantined'].includes(status);
  const hasBlockerFields = resource.manual_input_required === true
    || resource.recovery_queue_bucket
    || resource.failure_reason
    || (resource.recovery_status && resource.recovery_status !== 'resolved_manual' && resource.recovery_status !== 'resolved_metadata_only');

  // Also eligible if score is high but status doesn't reflect it
  const highScoreBlocked = (resource.last_quality_score ?? 0) >= 80 && isBlockedStatus;

  return isBlockedStatus || hasBlockerFields || highScoreBlocked;
}

// ── Fix a single resource ─────────────────────────────────

export async function fixResourceStateFromContent(
  resourceId: string,
  userId: string,
  options?: { triggerReEnrich?: boolean },
): Promise<FixResult> {
  // Fetch current resource state
  const { data: resource, error: fetchErr } = await (supabase as any)
    .from('resources')
    .select('*')
    .eq('id', resourceId)
    .single();

  if (fetchErr || !resource) {
    return { success: false, message: 'Resource not found', fieldsCleared: [] };
  }

  const contentLength = resource.content_length ?? 0;
  const manualPresent = resource.manual_content_present === true;
  const actualContent = typeof resource.content === 'string' ? resource.content.trim().length : 0;
  const effectiveLength = Math.max(contentLength, actualContent);
  const hasValidContent = effectiveLength > 1000 || manualPresent;

  if (!hasValidContent) {
    return { success: false, message: 'No valid content found (need >1000 chars or manual content)', fieldsCleared: [] };
  }

  const previousStatus = resource.enrichment_status;
  const now = new Date().toISOString();

  // Build the update
  const update: Record<string, any> = {
    enrichment_status: 'deep_enriched',
    recovery_status: 'resolved_manual',
    manual_input_required: false,
    recovery_queue_bucket: null,
    failure_reason: null,
    recovery_reason: null,
    next_best_action: null,
    last_recovery_error: null,
    platform_status: null,
    failure_count: 0,
    content_status: 'full',
    enriched_at: now,
    last_status_change_at: now,
    manual_content_present: manualPresent || effectiveLength > 1000,
  };

  // Preserve existing resolution_method or set a new one
  if (!resource.resolution_method) {
    update.resolution_method = 'fixed_from_existing_content';
  }

  // Preserve existing extraction_method or set default
  if (!resource.extraction_method) {
    update.extraction_method = 'manual_content';
  }

  // Update content_length if the actual content is longer than recorded
  if (actualContent > contentLength) {
    update.content_length = actualContent;
  }

  // Track which fields we actually cleared
  const fieldsCleared: string[] = [];
  if (resource.failure_reason) fieldsCleared.push('failure_reason');
  if (resource.failure_count > 0) fieldsCleared.push('failure_count');
  if (resource.manual_input_required) fieldsCleared.push('manual_input_required');
  if (resource.recovery_queue_bucket) fieldsCleared.push('recovery_queue_bucket');
  if (resource.recovery_reason) fieldsCleared.push('recovery_reason');
  if (resource.next_best_action) fieldsCleared.push('next_best_action');
  if (resource.last_recovery_error) fieldsCleared.push('last_recovery_error');
  if (resource.platform_status) fieldsCleared.push('platform_status');
  if (previousStatus !== 'deep_enriched') fieldsCleared.push('enrichment_status');

  // Persist
  const { error: updateErr } = await (supabase as any)
    .from('resources')
    .update(update)
    .eq('id', resourceId);

  if (updateErr) {
    return { success: false, message: updateErr.message, fieldsCleared: [] };
  }

  // Record provenance
  await (supabase as any).from('enrichment_attempts').insert({
    resource_id: resourceId,
    user_id: userId,
    attempt_type: 'fix_resource',
    strategy: 'content_wins_over_failure',
    result: 'success',
    content_found: true,
    content_length_extracted: effectiveLength,
    started_at: now,
    completed_at: now,
    metadata: {
      previous_status: previousStatus,
      fields_cleared: fieldsCleared,
    },
  });

  // Optionally trigger re-enrichment (uses manual content fast-path)
  if (options?.triggerReEnrich && previousStatus !== 'deep_enriched') {
    try {
      await invokeEnrichResource(
        { resource_id: resourceId, force: true },
        { componentName: 'FixResource', timeoutMs: 90000 },
      );
    } catch {
      // Non-fatal — the fix itself succeeded
    }
  }

  return {
    success: true,
    message: `Fixed: ${fieldsCleared.length} stale fields cleared, status → deep_enriched`,
    fieldsCleared,
    previousStatus,
    newStatus: 'deep_enriched',
  };
}

// ── Batch repair for retroactive fix ──────────────────────

export async function repairResourcesWithValidContent(
  userId: string,
): Promise<{ fixed: number; errors: number; details: string[] }> {
  const details: string[] = [];
  let fixed = 0;
  let errors = 0;

  // Find resources with valid content but stale states
  const { data: candidates } = await (supabase as any)
    .from('resources')
    .select('id, enrichment_status, content_length, manual_content_present, failure_reason, manual_input_required, recovery_queue_bucket, resolution_method')
    .eq('user_id', userId)
    .or('content_length.gt.1000,manual_content_present.eq.true');

  if (!candidates || candidates.length === 0) {
    return { fixed: 0, errors: 0, details: ['No candidates found'] };
  }

  for (const r of candidates) {
    if (!isFixEligible(r)) continue;

    const result = await fixResourceStateFromContent(r.id, userId, { triggerReEnrich: false });
    if (result.success) {
      fixed++;
      details.push(`✓ ${r.id.slice(0, 8)} — ${result.fieldsCleared.length} fields cleared (was: ${result.previousStatus})`);
    } else {
      errors++;
      details.push(`✗ ${r.id.slice(0, 8)} — ${result.message}`);
    }
  }

  return { fixed, errors, details };
}

// ── Query invalidation keys ───────────────────────────────

export const FIX_RESOURCE_INVALIDATION_KEYS = [
  ['resources'],
  ['incoming-queue'],
  ['all-resources'],
  ['resource-folders'],
  ['enrichment-status'],
  ['recovery-queue'],
  ['verification-runs'],
];

/**
 * postExtractionState.ts — SINGLE POST-RUN CANONICAL STATE per resource.
 *
 * ── PURPOSE ──
 * After extraction runs, every resource gets exactly ONE canonical state.
 * All audit panels (Under-Extracted, Bottleneck Review, Re-Extraction Queue)
 * MUST derive from this — not from independent heuristics.
 *
 * ── PANEL ROUTING (strict single-home) ──
 * Every canonical state maps to exactly ONE primary panel. No overlaps.
 *
 * ── VERIFICATION QUEUE (derived, not a panel) ──
 * The Verification Queue is NOT a routing destination. It is a prioritized
 * review queue built from a deterministic subset of canonical states:
 *   - under_extracted_candidate
 *   - needs_first_extraction
 *   - reextract_completed_no_lift
 * It exists as a convenience view for manual review triage.
 * It does NOT appear in STATE_PANELS.
 *
 * ── SEPARATION FROM PROGRESS ──
 * post_extraction_state = what the resource IS now (post-run outcome)
 * active_job_*           = what it is DOING right now (progress layer)
 * These coexist independently. Progress is rendered by ResourceOperationProgress.
 *
 * ── DETERMINISM ──
 * Same inputs → same state. First matching rule wins. No randomness.
 *
 * ── ROUTING RULES (evaluated top to bottom) ──
 * 1.  excluded:                     resource_type = 'reference_only'
 * 2.  reextract_running:            active_job_status in (running, queued, partial)
 * 3.  needs_enrichment:             no content (<200 chars), never enriched
 * 4.  needs_first_extraction:       has content, 0 KIs, no extraction run ever
 * 5.  api_failure_review:           last run had chunk failures (API/credit errors)
 * 6.  legacy_pipeline_rejection:    last run was single_pass with quality-gate rejection
 * 7.  extractor_weak_review:        last run raw=0 → 0 → 0 (true extractor weakness, no API failure)
 * 8.  validator_review:             last run raw>0, validated=0
 * 9.  dedup_review:                 last run validated>0, saved=0
 * 10. reextract_completed_with_lift: last run saved>0 AND density still low
 * 11. reextract_completed_no_lift:  last run saved=0, has prior KIs, density low
 * 12. under_extracted_candidate:    under_extracted_flag OR density below threshold
 * 13. done:                         healthy density or strong depth bucket
 */

import type { ResourceAuditRow } from '@/hooks/useKnowledgeCoverageAudit';

// ── Canonical States ──────────────────────────────────────

export type PostExtractionState =
  | 'needs_first_extraction'
  | 'under_extracted_candidate'
  | 'reextract_running'
  | 'reextract_completed_with_lift'
  | 'reextract_completed_no_lift'
  | 'api_failure_review'
  | 'legacy_pipeline_rejection'
  | 'extractor_weak_review'
  | 'needs_rerun'
  | 'validator_review'
  | 'dedup_review'
  | 'needs_enrichment'
  | 'done'
  | 'excluded';

export interface PostExtractionStateResult {
  state: PostExtractionState;
  label: string;
  /** Human-readable explanation of why this state was assigned */
  explanation: string;
  /** The ONE primary panel this resource belongs in — strict single-home */
  panels: PostExtractionPanel[];
}

/**
 * Primary panels — each resource maps to exactly one.
 * 'verification_queue' is intentionally NOT here; it is a derived view.
 */
export type PostExtractionPanel =
  | 'under_extracted'
  | 'bottleneck_review'
  | 'reextraction_queue'
  | 'none';
// ── Labels ────────────────────────────────────────────────

export const STATE_LABELS: Record<PostExtractionState, string> = {
  needs_first_extraction: 'Needs First Extraction',
  under_extracted_candidate: 'Under-Extracted',
  reextract_running: 'Re-Extracting',
  reextract_completed_with_lift: 'Lift Achieved',
  reextract_completed_no_lift: 'No Lift',
  api_failure_review: 'API Failure',
  legacy_pipeline_rejection: 'Legacy Rejection',
  extractor_weak_review: 'Extractor Weak',
  needs_rerun: 'Needs Rerun',
  validator_review: 'Validator Review',
  dedup_review: 'Dedup Review',
  needs_enrichment: 'Needs Enrichment',
  done: 'Done',
  excluded: 'Excluded',
};

// ── Panel Mapping (strict single-home) ────────────────────
/**
 * Each state maps to exactly ONE primary panel.
 * No resource can appear in multiple conflicting panels.
 * verification_queue is NOT here — it is a derived view (see VERIFICATION_QUEUE_STATES).
 */
const STATE_PANELS: Record<PostExtractionState, PostExtractionPanel[]> = {
  needs_first_extraction:        ['under_extracted'],
  under_extracted_candidate:     ['under_extracted'],
  reextract_running:             ['reextraction_queue'],
  reextract_completed_with_lift: ['none'],
  reextract_completed_no_lift:   ['bottleneck_review'],
  api_failure_review:            ['bottleneck_review'],
  legacy_pipeline_rejection:     ['bottleneck_review'],
  extractor_weak_review:         ['bottleneck_review'],
  needs_rerun:                   ['under_extracted'],
  validator_review:              ['bottleneck_review'],
  dedup_review:                  ['bottleneck_review'],
  needs_enrichment:              ['none'],
  done:                          ['none'],
  excluded:                      ['none'],
};

// ── Verification Queue (derived view, not a panel) ────────
/**
 * The Verification Queue is a prioritized review queue built from a
 * deterministic subset of canonical states. It is NOT a routing destination.
 * Resources here still "live" in their primary panel (under_extracted or bottleneck_review).
 */
export const VERIFICATION_QUEUE_STATES: PostExtractionState[] = [
  'under_extracted_candidate',
  'needs_first_extraction',
  'needs_rerun',
  'reextract_completed_no_lift',
];

// ── Content-type-aware density thresholds ──────────────────

function getDensityThreshold(resourceType: string): number {
  const t = resourceType.toLowerCase();
  if (['transcript', 'podcast', 'audio', 'podcast_episode', 'lesson'].includes(t)) return 0.5;
  if (['document', 'presentation', 'article'].includes(t)) return 0.75;
  return 0.6;
}

function isHealthyDensity(kisPer1k: number, resourceType: string): boolean {
  // "done" threshold = 2× the minimum density threshold
  return kisPer1k >= getDensityThreshold(resourceType) * 2;
}

function isEnrichedStatus(status: string): boolean {
  return ['deep_enriched', 'enriched', 'verified', 'extracted', 'content_ready', 'extraction_retrying'].includes(status);
}

// ── API / chunk failure detection ─────────────────────────

function hasChunkFailures(r: ResourceAuditRow): boolean {
  const failed = (r as any).last_extraction_chunks_failed ?? 0;
  const total = (r as any).last_extraction_chunks_total ?? 0;
  // All chunks failed, or more chunks failed than processed
  return failed > 0 && (total === 0 || failed >= total);
}

function isLegacySinglePass(r: ResourceAuditRow): boolean {
  const mode = (r as any).last_extraction_mode;
  return mode === 'single_pass';
}

// ── Main Derivation ───────────────────────────────────────

export function derivePostExtractionState(r: ResourceAuditRow): PostExtractionStateResult {
  // 1. Excluded
  if (r.resource_type === 'reference_only') {
    return mk('excluded', 'Resource type is reference_only — excluded from processing.');
  }

  // 2. Currently running (coexists with progress layer — state tracks WHAT it is, progress tracks HOW FAR)
  const activeStatus = r.active_job_status;
  if (activeStatus === 'running' || activeStatus === 'queued' || activeStatus === 'partial') {
    return mk('reextract_running', `Active job status: ${activeStatus}.`);
  }

  const hasExtractionRun = !!r.last_extraction_run_id;
  const enriched = isEnrichedStatus(r.enrichment_status);

  // 3. Needs enrichment (no content, not enriched)
  if (r.ki_count_total === 0 && !hasExtractionRun && !enriched && r.content_length < 200) {
    return mk('needs_enrichment', `No extraction run, not enriched, content length ${r.content_length} chars.`);
  }

  // 4. Needs first extraction (content available, never extracted)
  if (r.ki_count_total === 0 && !hasExtractionRun) {
    return mk('needs_first_extraction', `Content present (${r.content_length} chars) but no extraction run recorded.`);
  }

  // 5-11: Post-extraction outcome routing
  if (hasExtractionRun) {
    const raw = r.last_extraction_returned_ki_count ?? 0;
    const validated = r.last_extraction_validated_ki_count ?? 0;
    const saved = r.last_extraction_saved_ki_count ?? 0;

    // ── TELEMETRY INTEGRITY CHECK ──
    // If the run exists but ALL counter fields are null (not zero), the telemetry
    // was never populated. Route to needs_rerun, NOT extractor_weak_review.
    const hasRealTelemetry =
      r.last_extraction_returned_ki_count != null ||
      r.last_extraction_validated_ki_count != null ||
      r.last_extraction_saved_ki_count != null;

    if (!hasRealTelemetry) {
      return mk('needs_rerun',
        `Latest run exists but telemetry fields are missing (run_id: ${r.last_extraction_run_id || 'unknown'}). ` +
        `Resource has ${r.ki_count_total} KIs from prior extractions. Needs a fresh rerun to populate telemetry.`);
    }

    // 5. API / chunk failure: all chunks failed → not an extractor problem
    // Also catches backfilled resources with extraction_failure_type set
    const failureType = (r as any).extraction_failure_type;
    if (hasChunkFailures(r) || failureType === 'api_failure' || failureType === 'api_credits_exhausted' || failureType === 'api_rate_limited') {
      const failed = (r as any).last_extraction_chunks_failed ?? 0;
      const errSnippet = r.last_extraction_error
        ? ` Error: ${r.last_extraction_error.slice(0, 80)}`
        : failureType ? ` Type: ${failureType}` : '';
      return mk('api_failure_review',
        `${failed > 0 ? `${failed} chunk(s) failed` : 'API failure detected'} — likely API credit/rate-limit issue.${errSnippet}`);
    }

    // 6. Legacy single_pass rejection: old pipeline quality-gate blocked valid items
    if (isLegacySinglePass(r) && saved === 0 && raw > 0) {
      const summary = r.last_extraction_summary || '';
      return mk('legacy_pipeline_rejection',
        `Legacy single_pass pipeline rejected output. ${raw} raw items generated but not saved. ${summary ? `Reason: ${summary.slice(0, 100)}` : ''}`);
    }

    // 7. True extractor weak: 0→0→0 with NO API failures
    //    Only applies if fallback ladder was exhausted (passesRun includes fallback passes)
    //    or if the resource is too short for fallbacks (<1500 chars)
    if (raw === 0 && validated === 0 && saved === 0) {
      const passesRun = (r as any).extraction_passes_run as string[] | null;
      const fallbacksRan = passesRun && (passesRun.includes('fallback_aggressive') || passesRun.includes('fallback_segmented'));
      const tooShortForFallback = r.content_length < 1500;
      const summary = r.last_extraction_summary || '';
      const isTrueZeroAfterFallbacks = summary.includes('true_zero_after_fallbacks');

      if (fallbacksRan || tooShortForFallback || isTrueZeroAfterFallbacks) {
        return mk('extractor_weak_review',
          `Latest run: 0 raw → 0 validated → 0 saved from ${(r.content_length / 1000).toFixed(1)}k chars.${fallbacksRan ? ' All fallback tiers exhausted.' : ''}`);
      }
      // Fallback ladder hasn't run yet — route to needs_rerun so it can run with fallbacks
      return mk('needs_rerun',
        `Latest run returned 0 items but fallback ladder has not been attempted. Needs rerun with fallback extraction.`);
    }

    // 8. Validator too strict: raw > 0, validated = 0
    if (raw > 0 && validated === 0) {
      return mk('validator_review',
        `Latest run: ${raw} raw → 0 validated → 0 saved. All items rejected by validation.`);
    }

    // 9. Dedup too aggressive: validated > 0, saved = 0
    if (validated > 0 && saved === 0) {
      return mk('dedup_review',
        `Latest run: ${raw} raw → ${validated} validated → 0 saved. All items removed by dedup.`);
    }

    // 10. Positive lift
    if (saved > 0) {
      if (isHealthyDensity(r.kis_per_1k_chars, r.resource_type)) {
        return mk('done',
          `Latest run saved ${saved} KIs. Density ${r.kis_per_1k_chars.toFixed(2)}/1k is healthy.`);
      }
      return mk('reextract_completed_with_lift',
        `Latest run saved ${saved} KIs. Density ${r.kis_per_1k_chars.toFixed(2)}/1k — may benefit from further extraction.`);
    }

    // 11. No lift (had extraction, 0 saved, but already has KIs from prior runs)
    if (r.ki_count_total > 0 && saved === 0) {
      if (isHealthyDensity(r.kis_per_1k_chars, r.resource_type)) {
        return mk('done',
          `Latest run added 0 new KIs but density ${r.kis_per_1k_chars.toFixed(2)}/1k is healthy. Fully mined.`);
      }
      return mk('reextract_completed_no_lift',
        `Latest run added 0 new KIs. Total: ${r.ki_count_total}, density ${r.kis_per_1k_chars.toFixed(2)}/1k.`);
    }
  }

  // 12. Under-extracted candidate (has KIs but density is low)
  if (r.under_extracted_flag || isUnderDensity(r)) {
    return mk('under_extracted_candidate',
      `Density ${r.kis_per_1k_chars.toFixed(2)}/1k below threshold (${getDensityThreshold(r.resource_type)}/1k) for ${r.resource_type}.`);
  }

  // 13. Done
  return mk('done',
    `${r.ki_count_total} KIs, density ${r.kis_per_1k_chars.toFixed(2)}/1k. Depth: ${r.extraction_depth_bucket}.`);
}

// ── Helpers ───────────────────────────────────────────────

function mk(state: PostExtractionState, explanation: string): PostExtractionStateResult {
  return {
    state,
    label: STATE_LABELS[state],
    explanation,
    panels: STATE_PANELS[state],
  };
}

function isUnderDensity(r: ResourceAuditRow): boolean {
  if (r.content_length < 500) return false;
  if (r.ki_count_total === 0) return false;
  return r.kis_per_1k_chars < getDensityThreshold(r.resource_type);
}

// ── Panel filter helpers ──────────────────────────────────

/** Get all resources that belong to a specific panel */
export function filterByPanel(resources: ResourceAuditRow[], panel: PostExtractionPanel): ResourceAuditRow[] {
  return resources.filter(r => derivePostExtractionState(r).panels.includes(panel));
}

/** Get all resources matching one or more states */
export function filterByState(resources: ResourceAuditRow[], ...states: PostExtractionState[]): ResourceAuditRow[] {
  return resources.filter(r => states.includes(derivePostExtractionState(r).state));
}

// ── Aggregate stats ───────────────────────────────────────

export function aggregatePostExtractionStates(resources: ResourceAuditRow[]): Record<PostExtractionState, number> {
  const counts = {} as Record<PostExtractionState, number>;
  for (const s of Object.keys(STATE_LABELS) as PostExtractionState[]) counts[s] = 0;
  for (const r of resources) counts[derivePostExtractionState(r).state]++;
  return counts;
}

// ── Raw count helper ──────────────────────────────────────
/**
 * Compute total raw count from pass-keyed JSON object.
 * raw_candidate_counts is stored as e.g. { "standard": 18, "deep": 12 }
 * NOT as { "total": 30 }. Sum all pass values.
 */
export function computeTotalRawCount(rawCounts: Record<string, number> | null | undefined): number {
  if (!rawCounts || typeof rawCounts !== 'object') return 0;
  return Object.values(rawCounts).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
}

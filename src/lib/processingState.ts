/**
 * Canonical Processing State — the single user-facing truth layer.
 * 
 * Maps raw enrichment_status + audio job state → one of 6 states.
 * UI should render from this, not raw DB fields.
 */

import type { Resource } from '@/hooks/useResources';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';
import { classifyEnrichability, type EnrichabilityState } from '@/lib/salesBrain/resourceSubtype';

export type ProcessingState =
  | 'READY'
  | 'RUNNING'
  | 'RETRYABLE_FAILURE'
  | 'MANUAL_REQUIRED'
  | 'METADATA_ONLY'
  | 'COMPLETED';

export type ActionState =
  | 'RUN_ENRICH'
  | 'RETRY_FIXABLE'
  | 'MANUAL_REQUIRED'
  | 'DONE';

export interface ProcessingStateResult {
  state: ProcessingState;
  label: string;
  description: string;
  nextAction: string | null;
}

// ── Per-resource processing state ──────────────────────────
export function deriveProcessingState(
  resource: Resource,
  audioJob?: AudioJobRecord | null,
): ProcessingStateResult {
  const status = resource.enrichment_status;

  // Currently running
  if (
    status === 'deep_enrich_in_progress' ||
    status === 'reenrich_in_progress' ||
    status === 'queued_for_deep_enrich' ||
    status === 'queued_for_reenrich'
  ) {
    return {
      state: 'RUNNING',
      label: 'Processing',
      description: 'Enrichment is running',
      nextAction: null,
    };
  }

  // Audio job overrides for audio resources
  if (audioJob) {
    const stage = audioJob.stage;

    if (stage === 'completed' || stage === 'quality_checked') {
      if (audioJob.transcript_mode === 'metadata_only' || stage === 'metadata_only_complete') {
        return {
          state: 'METADATA_ONLY',
          label: 'Metadata Only',
          description: 'Only metadata captured — no transcript available',
          nextAction: 'Open Manual Assist to provide transcript',
        };
      }
      return {
        state: 'COMPLETED',
        label: 'Completed',
        description: audioJob.has_transcript
          ? `Transcribed (${audioJob.transcript_word_count ?? 0} words)`
          : 'Processing complete',
        nextAction: null,
      };
    }

    if (stage === 'metadata_only_complete') {
      return {
        state: 'METADATA_ONLY',
        label: 'Metadata Only',
        description: 'Only metadata captured — no direct audio access',
        nextAction: 'Open Manual Assist to provide transcript or alternate URL',
      };
    }

    if (stage === 'needs_manual_assist') {
      return {
        state: 'MANUAL_REQUIRED',
        label: 'Manual Input Needed',
        description: audioJob.failure_reason || 'Automatic processing exhausted',
        nextAction: audioJob.recommended_action || 'Open Manual Assist',
      };
    }

    if (stage === 'failed') {
      if (audioJob.retryable) {
        return {
          state: 'RETRYABLE_FAILURE',
          label: 'Retry Available',
          description: audioJob.failure_reason || 'Processing failed but can be retried',
          nextAction: 'Retry transcription or resolution',
        };
      }
      return {
        state: 'MANUAL_REQUIRED',
        label: 'Manual Input Needed',
        description: audioJob.failure_reason || 'Processing failed — automatic retry not available',
        nextAction: audioJob.recommended_action || 'Open Manual Assist',
      };
    }

    // Actively processing audio stages
    if (['queued', 'resolving', 'downloading', 'transcribing', 'assembling'].includes(stage)) {
      return {
        state: 'RUNNING',
        label: 'Processing',
        description: `Audio pipeline: ${stage}`,
        nextAction: null,
      };
    }
  }

  // Completed enrichment
  if (status === 'deep_enriched') {
    return {
      state: 'COMPLETED',
      label: 'Completed',
      description: 'Enrichment complete',
      nextAction: null,
    };
  }

  // Failed enrichment
  if (status === 'failed') {
    // Check enrichability to determine if manual is needed
    const ea = classifyEnrichability(resource.file_url, resource.resource_type);
    if (ea.enrichability === 'manual_input_needed' || ea.enrichability === 'needs_auth') {
      return {
        state: 'MANUAL_REQUIRED',
        label: 'Manual Input Needed',
        description: ea.reason,
        nextAction: 'Open Manual Assist or provide alternate source',
      };
    }
    return {
      state: 'RETRYABLE_FAILURE',
      label: 'Retry Available',
      description: resource.failure_reason || 'Enrichment failed',
      nextAction: 'Retry enrichment',
    };
  }

  // Incomplete
  if (status === 'incomplete') {
    return {
      state: 'RETRYABLE_FAILURE',
      label: 'Incomplete',
      description: 'Partial enrichment — can be retried',
      nextAction: 'Re-enrich to complete',
    };
  }

  // Stale / quarantined
  if (status === 'stale' || status === 'quarantined') {
    return {
      state: 'RETRYABLE_FAILURE',
      label: status === 'stale' ? 'Stale' : 'Quarantined',
      description: `Resource is ${status} — re-enrich recommended`,
      nextAction: 'Re-enrich',
    };
  }

  // Not enriched — check enrichability
  if (status === 'not_enriched' || !status) {
    const ea = classifyEnrichability(resource.file_url, resource.resource_type);
    if (ea.enrichability === 'manual_input_needed') {
      return {
        state: 'MANUAL_REQUIRED',
        label: 'Manual Input Needed',
        description: ea.reason,
        nextAction: 'Open Manual Assist',
      };
    }
    if (ea.enrichability === 'needs_auth') {
      return {
        state: 'MANUAL_REQUIRED',
        label: 'Needs Auth',
        description: ea.reason,
        nextAction: 'Provide accessible link or paste content manually',
      };
    }
    if (ea.enrichability === 'metadata_only') {
      return {
        state: 'METADATA_ONLY',
        label: 'Metadata Only',
        description: ea.reason,
        nextAction: 'Open Manual Assist to provide transcript',
      };
    }
    if (ea.enrichability === 'no_source' || ea.enrichability === 'unsupported') {
      return {
        state: 'MANUAL_REQUIRED',
        label: ea.enrichability === 'no_source' ? 'No Source' : 'Unsupported',
        description: ea.reason,
        nextAction: null,
      };
    }
    return {
      state: 'READY',
      label: 'Ready',
      description: 'Ready for enrichment',
      nextAction: 'Run Deep Enrich',
    };
  }

  // Duplicate / superseded
  if (status === 'duplicate' || status === 'superseded') {
    return {
      state: 'COMPLETED',
      label: status === 'duplicate' ? 'Duplicate' : 'Superseded',
      description: `Resource is ${status}`,
      nextAction: null,
    };
  }

  // Fallback
  return {
    state: 'READY',
    label: 'Ready',
    description: 'Ready for processing',
    nextAction: 'Run Deep Enrich',
  };
}

// ── Badge colors for ProcessingState ───────────────────────
export function getProcessingStateColor(state: ProcessingState): string {
  switch (state) {
    case 'READY': return 'bg-primary/20 text-primary';
    case 'RUNNING': return 'bg-status-yellow/20 text-status-yellow';
    case 'RETRYABLE_FAILURE': return 'bg-orange-500/20 text-orange-600';
    case 'MANUAL_REQUIRED': return 'bg-status-red/20 text-status-red';
    case 'METADATA_ONLY': return 'bg-orange-500/20 text-orange-600';
    case 'COMPLETED': return 'bg-status-green/20 text-status-green';
    default: return 'bg-muted text-muted-foreground';
  }
}

// ── Derive modal ActionState from a set of resources ───────
export function deriveModalActionState(
  resources: Resource[],
  audioJobsMap?: Map<string, AudioJobRecord>,
): { actionState: ActionState; counts: { runnable: number; retryable: number; manual: number; done: number } } {
  let runnable = 0;
  let retryable = 0;
  let manual = 0;
  let done = 0;

  for (const r of resources) {
    const job = audioJobsMap?.get(r.id) ?? null;
    const ps = deriveProcessingState(r, job);
    switch (ps.state) {
      case 'READY': runnable++; break;
      case 'RUNNING': runnable++; break; // still counts as active
      case 'RETRYABLE_FAILURE': retryable++; break;
      case 'MANUAL_REQUIRED': manual++; break;
      case 'METADATA_ONLY': manual++; break;
      case 'COMPLETED': done++; break;
    }
  }

  let actionState: ActionState;
  if (runnable > 0) actionState = 'RUN_ENRICH';
  else if (retryable > 0) actionState = 'RETRY_FIXABLE';
  else if (manual > 0) actionState = 'MANUAL_REQUIRED';
  else actionState = 'DONE';

  return { actionState, counts: { runnable, retryable, manual, done } };
}

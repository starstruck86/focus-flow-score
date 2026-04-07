/**
 * EnrichmentJobBridge — LEGACY CLIENT-SIDE PATH ONLY.
 *
 * ⚠️  DEPRECATED: This bridge is DISABLED by default.
 *
 * The preferred path for ALL enrichment (including URL-based) is
 * `startDurableEnrichment()` which creates a durable DB row and dispatches
 * to the `run-enrichment-job` edge function.
 *
 * This bridge exists ONLY for explicit legacy/dev usage gated behind
 * the `VITE_ENABLE_LEGACY_ENRICHMENT_BRIDGE` env var.
 *
 * It syncs the legacy useEnrichmentJobStore (client-side batch loop)
 * into the global useBackgroundJobs store for UI display.
 *
 * IMPORTANT: This path is BROWSER-DEPENDENT. If the tab is closed, the job dies.
 */
import { useEffect, useRef } from 'react';
import { useEnrichmentJobStore } from '@/store/useEnrichmentJobStore';
import { useBackgroundJobs } from '@/store/useBackgroundJobs';

/** Non-UUID sentinel — intentionally NOT a valid UUID to prevent accidental DB writes */
const LEGACY_JOB_ID = 'legacy-enrichment-client-only';

/** Gate: only active if explicitly enabled via env var */
const LEGACY_BRIDGE_ENABLED = import.meta.env.VITE_ENABLE_LEGACY_ENRICHMENT_BRIDGE === 'true';

export function EnrichmentJobBridge() {
  const enrichState = useEnrichmentJobStore((s) => s.state);
  const addJob = useBackgroundJobs((s) => s.addJob);
  const updateJob = useBackgroundJobs((s) => s.updateJob);
  const removeJob = useBackgroundJobs((s) => s.removeJob);
  const prevStatus = useRef(enrichState.status);
  const bridged = useRef(false);

  useEffect(() => {
    // If the legacy bridge is not enabled, do nothing
    if (!LEGACY_BRIDGE_ENABLED) return;

    const { status, mode, totalItems, processedCount, successCount, failedCount, currentBatch, totalBatches } = enrichState;
    const modeLabel = mode === 'deep_enrich' ? 'Deep Enrich' : 'Re-enrich';

    if (status === 'running' && prevStatus.current !== 'running') {
      if (!bridged.current) {
        console.warn(`[ENRICHMENT BRIDGE] ⚠️ LEGACY path active: "${modeLabel}" — ${totalItems} resources (browser-dependent)`);
        // No userId → no DB write. This is intentional for the legacy path.
        addJob({
          id: LEGACY_JOB_ID,
          type: mode === 'deep_enrich' ? 'deep_enrich' : 're_enrichment',
          title: `${modeLabel}: ${totalItems} resources (client)`,
          status: 'running',
          progressMode: totalItems > 0 ? 'determinate' : 'indeterminate',
          progress: { current: processedCount, total: totalItems },
          progressPercent: totalItems > 0 ? Math.round((processedCount / totalItems) * 100) : 0,
          stepLabel: `Batch ${currentBatch} of ${totalBatches}`,
          substatus: 'enriching',
        });
        bridged.current = true;
      }
    } else if (status === 'running') {
      const pct = totalItems > 0 ? Math.round((processedCount / totalItems) * 100) : 0;
      updateJob(LEGACY_JOB_ID, {
        progress: { current: processedCount, total: totalItems },
        progressPercent: pct,
        stepLabel: totalBatches > 1
          ? `Batch ${currentBatch} of ${totalBatches} · ${successCount} done${failedCount > 0 ? ` · ${failedCount} failed` : ''}`
          : `${processedCount} of ${totalItems}${failedCount > 0 ? ` · ${failedCount} failed` : ''}`,
      });
    } else if (status === 'paused' && prevStatus.current === 'running') {
      updateJob(LEGACY_JOB_ID, {
        substatus: 'Paused',
        stepLabel: `Paused at ${processedCount}/${totalItems}`,
      });
    } else if (status === 'completed' && prevStatus.current !== 'completed') {
      updateJob(LEGACY_JOB_ID, {
        status: 'completed',
        progressPercent: 100,
        stepLabel: `${successCount} done${failedCount > 0 ? ` · ${failedCount} failed` : ''}`,
        substatus: undefined,
      });
      bridged.current = false;
    } else if (status === 'failed' && prevStatus.current !== 'failed') {
      updateJob(LEGACY_JOB_ID, {
        status: 'failed',
        error: `${failedCount} of ${totalItems} failed`,
        stepLabel: `${successCount} done · ${failedCount} failed`,
        substatus: undefined,
      });
      bridged.current = false;
    } else if (status === 'cancelled' && prevStatus.current !== 'cancelled') {
      updateJob(LEGACY_JOB_ID, {
        status: 'cancelled',
        stepLabel: `Cancelled at ${processedCount}/${totalItems}`,
        substatus: undefined,
      });
      bridged.current = false;
    } else if (status === 'idle' && prevStatus.current !== 'idle') {
      removeJob(LEGACY_JOB_ID);
      bridged.current = false;
    }

    prevStatus.current = status;
  }, [enrichState, addJob, updateJob, removeJob]);

  return null;
}

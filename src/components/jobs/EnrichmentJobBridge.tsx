/**
 * EnrichmentJobBridge — syncs useEnrichmentJobStore state into the global
 * useBackgroundJobs store so the unified indicator/drawer shows enrichment progress.
 * This is the LEGACY client-side path. Durable enrichment uses startDurableEnrichment instead.
 */
import { useEffect, useRef } from 'react';
import { useEnrichmentJobStore } from '@/store/useEnrichmentJobStore';
import { useBackgroundJobs } from '@/store/useBackgroundJobs';

const JOB_ID = 'enrichment-batch'; // Legacy client-side enrichment — no DB persistence (not UUID)

export function EnrichmentJobBridge() {
  const enrichState = useEnrichmentJobStore((s) => s.state);
  const addJob = useBackgroundJobs((s) => s.addJob);
  const updateJob = useBackgroundJobs((s) => s.updateJob);
  const removeJob = useBackgroundJobs((s) => s.removeJob);
  const prevStatus = useRef(enrichState.status);
  const bridged = useRef(false);

  useEffect(() => {
    const { status, mode, totalItems, processedCount, successCount, failedCount, currentBatch, totalBatches } = enrichState;
    const modeLabel = mode === 'deep_enrich' ? 'Deep Enrich' : 'Re-enrich';

    if (status === 'running' && prevStatus.current !== 'running') {
      // Job just started — only add once
      if (!bridged.current) {
        console.info(`[ENRICHMENT JOB] Bridge: starting "${modeLabel}" job — ${totalItems} resources`);
        addJob({
          id: JOB_ID,
          type: mode === 'deep_enrich' ? 'deep_enrich' : 're_enrichment',
          title: `${modeLabel}: ${totalItems} resources`,
          status: 'running',
          progressMode: totalItems > 0 ? 'determinate' : 'indeterminate',
          progress: { current: processedCount, total: totalItems },
          progressPercent: totalItems > 0 ? Math.round((processedCount / totalItems) * 100) : 0,
          stepLabel: `Batch ${currentBatch} of ${totalBatches}`,
          substatus: 'enriching',
          // No userId — this is the legacy client-side path, not durable
        });
        bridged.current = true;
      }
    } else if (status === 'running') {
      // Progress update
      const pct = totalItems > 0 ? Math.round((processedCount / totalItems) * 100) : 0;
      updateJob(JOB_ID, {
        progress: { current: processedCount, total: totalItems },
        progressPercent: pct,
        stepLabel: totalBatches > 1
          ? `Batch ${currentBatch} of ${totalBatches} · ${successCount} done${failedCount > 0 ? ` · ${failedCount} failed` : ''}`
          : `${processedCount} of ${totalItems}${failedCount > 0 ? ` · ${failedCount} failed` : ''}`,
      });
    } else if (status === 'paused' && prevStatus.current === 'running') {
      console.info(`[ENRICHMENT JOB] Bridge: paused at ${processedCount}/${totalItems}`);
      updateJob(JOB_ID, {
        substatus: 'Paused',
        stepLabel: `Paused at ${processedCount}/${totalItems}`,
      });
    } else if (status === 'completed' && prevStatus.current !== 'completed') {
      console.info(`[ENRICHMENT JOB] Bridge: completed — ${successCount} done, ${failedCount} failed`);
      updateJob(JOB_ID, {
        status: 'completed',
        progressPercent: 100,
        stepLabel: `${successCount} done${failedCount > 0 ? ` · ${failedCount} failed` : ''}`,
        substatus: undefined,
      });
      bridged.current = false;
    } else if (status === 'failed' && prevStatus.current !== 'failed') {
      console.info(`[ENRICHMENT JOB] Bridge: failed — ${failedCount} of ${totalItems}`);
      updateJob(JOB_ID, {
        status: 'failed',
        error: `${failedCount} of ${totalItems} failed`,
        stepLabel: `${successCount} done · ${failedCount} failed`,
        substatus: undefined,
      });
      bridged.current = false;
    } else if (status === 'cancelled' && prevStatus.current !== 'cancelled') {
      console.info(`[ENRICHMENT JOB] Bridge: cancelled at ${processedCount}/${totalItems}`);
      updateJob(JOB_ID, {
        status: 'cancelled',
        stepLabel: `Cancelled at ${processedCount}/${totalItems}`,
        substatus: undefined,
      });
      bridged.current = false;
    } else if (status === 'idle' && prevStatus.current !== 'idle') {
      console.info('[ENRICHMENT JOB] Bridge: idle — cleaning up');
      removeJob(JOB_ID);
      bridged.current = false;
    }

    prevStatus.current = status;
  }, [enrichState, addJob, updateJob, removeJob]);

  return null;
}

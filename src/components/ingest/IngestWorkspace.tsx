/**
 * Ingest Workspace — merges Enrich + Ingest into one place.
 * 
 * File upload, URL import, transcript import, enrichment status/failures.
 */

import { SourceRegistryManager } from '@/components/prep/SourceRegistryManager';
import { IncomingQueue } from '@/components/prep/IncomingQueue';
import { EnrichmentEngine } from '@/components/prep/EnrichmentEngine';
import { AudioTestHarness } from '@/components/prep/AudioTestHarness';
import { KnowledgeOpsDashboard } from '@/components/knowledge/KnowledgeOpsDashboard';
import { SignalInbox } from '@/components/signal-inbox/SignalInbox';

export function IngestWorkspace() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">
          Add new source material — files, URLs, transcripts, feeds. Monitor enrichment and extraction pipeline.
        </p>
      </div>
      <SignalInbox />
      <KnowledgeOpsDashboard />
      <EnrichmentEngine />
      <SourceRegistryManager />
      <IncomingQueue />
      <AudioTestHarness />
    </div>
  );
}

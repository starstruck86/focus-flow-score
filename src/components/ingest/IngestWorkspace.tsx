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
import { Radio } from 'lucide-react';

export function IngestWorkspace() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">
          Add new source material — files, URLs, transcripts, feeds. Monitor enrichment and extraction pipeline.
        </p>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Radio className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Signal Inbox</p>
        <span className="text-xs text-muted-foreground">· auto-routes to Competitive / Product / Market / Sales intelligence</span>
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

/**
 * Resource Audio Inspector — validation panel showing DB audio job state
 * for a selected resource. For debugging real resources in the library.
 */
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, RefreshCw, HelpCircle, FileAudio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAudioStageLabel, getAudioFailureDescription, detectAudioSubtype } from '@/lib/salesBrain/audioPipeline';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';
import type { AudioFailureCode } from '@/lib/salesBrain/audioPipeline';
import type { Resource } from '@/hooks/useResources';

interface ResourceAudioInspectorProps {
  resource: Resource;
  audioJob: AudioJobRecord | null;
  onClose: () => void;
  onRetryResolve?: () => void;
  onRetryTranscription?: () => void;
  onOpenManualAssist?: () => void;
}

function Row({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-2 py-1 border-b border-border/30 last:border-0">
      <span className="text-[10px] text-muted-foreground shrink-0">{label}</span>
      <span className={cn('text-[10px] text-foreground text-right break-all max-w-[60%]', mono && 'font-mono')}>
        {value || '—'}
      </span>
    </div>
  );
}

export const ResourceAudioInspector = memo(function ResourceAudioInspector({
  resource,
  audioJob,
  onClose,
  onRetryResolve,
  onRetryTranscription,
  onOpenManualAssist,
}: ResourceAudioInspectorProps) {
  const detectedSubtype = detectAudioSubtype(resource.file_url, resource.resource_type);
  const failureDesc = audioJob?.failure_code
    ? getAudioFailureDescription(audioJob.failure_code as AudioFailureCode)
    : null;

  return (
    <div className="border border-border rounded-lg bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <FileAudio className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">Audio Inspector</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground truncate">{resource.title}</p>

      <ScrollArea className="max-h-[350px]">
        <div className="space-y-0.5">
          <Row label="Detected Subtype" value={detectedSubtype} />
          <Row label="DB Audio Job" value={audioJob ? 'Yes' : 'No'} />

          {audioJob && (
            <>
              <Row label="Job ID" value={audioJob.id.slice(0, 8)} mono />
              <Row label="Stage" value={getAudioStageLabel(audioJob.stage as any)} />
              <Row label="Transcript Mode" value={audioJob.transcript_mode} />
              <Row label="Audio Subtype (DB)" value={audioJob.audio_subtype} />
              <Row label="Source URL" value={audioJob.source_url} mono />
              <Row label="Resolved Audio URL" value={audioJob.resolved_audio_url} mono />
              <Row label="RSS Feed URL" value={audioJob.rss_feed_url} mono />
              <Row label="Transcript Source URL" value={audioJob.transcript_source_url} mono />
              <Row label="Canonical Episode URL" value={audioJob.canonical_episode_url} mono />
              <Row label="Platform Source Type" value={audioJob.platform_source_type} />
              <Row label="Episode ID" value={audioJob.source_episode_id} mono />
              <Row label="Show ID" value={audioJob.source_show_id} mono />
              <Row label="Transcript Quality" value={audioJob.transcript_quality} />
              <Row label="Word Count" value={audioJob.transcript_word_count?.toString()} />
              <Row label="Has Transcript" value={audioJob.has_transcript ? 'Yes' : 'No'} />
              <Row label="Provider" value={audioJob.provider_used} />
              <Row label="Attempts" value={audioJob.attempts_count.toString()} />
              <Row label="Resolver Attempts" value={audioJob.resolver_attempts?.toString()} />
              <Row label="Last Successful Stage" value={audioJob.last_successful_stage} />
              <Row label="Last Resolution Stage" value={audioJob.last_resolution_stage} />
              <Row label="Final Resolution" value={audioJob.final_resolution_status} />
              <Row label="Failure Code" value={audioJob.failure_code} />
              <Row label="Failure Reason" value={audioJob.failure_reason} />
              <Row label="Retryable" value={audioJob.retryable ? 'Yes' : 'No'} />
              <Row label="Recommended Action" value={audioJob.recommended_action} />

              {audioJob.metadata_json && Object.keys(audioJob.metadata_json).length > 0 && (
                <>
                  <div className="pt-1">
                    <span className="text-[10px] font-medium text-foreground">Metadata</span>
                  </div>
                  {Object.entries(audioJob.metadata_json).map(([k, v]) => (
                    <Row key={k} label={k} value={v != null ? String(v) : null} />
                  ))}
                </>
              )}

              {audioJob.quality_result && (
                <>
                  <div className="pt-1">
                    <span className="text-[10px] font-medium text-foreground">Quality Result</span>
                  </div>
                  {Object.entries(audioJob.quality_result as Record<string, any>).map(([k, v]) => (
                    <Row key={k} label={k} value={v != null ? String(v) : null} />
                  ))}
                </>
              )}
            </>
          )}

          {!audioJob && (
            <p className="text-[10px] text-muted-foreground py-2">
              No audio job exists for this resource yet. Use Deep Enrich to create one.
            </p>
          )}
        </div>
      </ScrollArea>

      {audioJob && (
        <div className="flex items-center gap-1 flex-wrap pt-1">
          {audioJob.retryable && onRetryResolve && (
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={onRetryResolve}>
              <RefreshCw className="h-2.5 w-2.5" /> Retry Resolve
            </Button>
          )}
          {audioJob.retryable && onRetryTranscription && (
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={onRetryTranscription}>
              <RefreshCw className="h-2.5 w-2.5" /> Retry Transcription
            </Button>
          )}
          {onOpenManualAssist && (
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={onOpenManualAssist}>
              <HelpCircle className="h-2.5 w-2.5" /> Manual Assist
            </Button>
          )}
        </div>
      )}

      {failureDesc && (
        <div className="bg-muted/50 rounded px-2 py-1.5 space-y-0.5">
          <p className="text-[10px] text-foreground">{failureDesc.explanation}</p>
          <p className="text-[10px] text-muted-foreground">→ {failureDesc.nextAction}</p>
        </div>
      )}
    </div>
  );
});

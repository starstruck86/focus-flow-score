/**
 * Overview tab — resource metadata, lineage, and clickable diagnostic metrics.
 */
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, FileText,
  Brain, Mic, GitBranch, Eye, Zap, Wrench, Play,
} from 'lucide-react';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';
import { BLOCKED_LABELS } from '@/lib/canonicalLifecycle';
import type { ControlPlaneState } from '@/lib/controlPlaneState';
import { CONTROL_PLANE_LABELS, CONTROL_PLANE_COLORS, deriveStateEvidence, detectConflicts } from '@/lib/controlPlaneState';
import type { ResourceDetail } from '@/hooks/useResourceInspectData';

interface Props {
  canonical: CanonicalResourceStatus;
  state: ControlPlaneState;
  detail: ResourceDetail | null;
  loading: boolean;
  onNavigateTab: (tab: string) => void;
}

export function InspectOverviewTab({ canonical, state, detail, loading, onNavigateTab }: Props) {
  const evidence = deriveStateEvidence(canonical, state);
  const colors = CONTROL_PLANE_COLORS[state];
  const conflicts = detectConflicts(canonical);

  const contentLength = detail?.content_length ?? detail?.content?.length ?? 0;
  const wordCount = detail?.content ? detail.content.split(/\s+/).filter(Boolean).length : 0;
  const hasTranscript = detail?.transcript_status === 'transcript_ready' || detail?.transcript_status === 'completed';
  const transcriptWordCount = hasTranscript && detail?.content ? wordCount : null;

  return (
    <div className="space-y-4">
      {/* ── Identity ── */}
      <Section title="Resource">
        <div className="space-y-1 text-xs">
          <Row label="Type" value={detail?.resource_type ?? '—'} />
          <Row label="State">
            <Badge variant="outline" className={cn('text-[10px]', colors.text, colors.bg, colors.border)}>
              {CONTROL_PLANE_LABELS[state]}
            </Badge>
          </Row>
          <Row label="Internal Stage" value={canonical.canonical_stage} mono />
          {canonical.blocked_reason !== 'none' && (
            <Row label="Blocked" value={BLOCKED_LABELS[canonical.blocked_reason] ?? canonical.blocked_reason.replace(/_/g, ' ')} destructive />
          )}
          <Row label="Content Status" value={detail?.content_status ?? '—'} />
          <Row label="Enrichment" value={detail?.enrichment_status ?? '—'} />
          {detail?.author_or_speaker && <Row label="Author" value={detail.author_or_speaker} />}
        </div>
      </Section>

      {/* ── Diagnostic Metrics ── */}
      <Section title="Metrics">
        <div className="grid grid-cols-2 gap-1.5">
          <MetricChip label="Characters" value={contentLength.toLocaleString()} onClick={() => onNavigateTab('content')} />
          <MetricChip label="Words" value={wordCount.toLocaleString()} onClick={() => onNavigateTab('content')} />
          <MetricChip
            label="Transcript"
            value={hasTranscript ? (transcriptWordCount ? `${transcriptWordCount.toLocaleString()} words` : '✓') : '—'}
            onClick={hasTranscript ? () => onNavigateTab('content') : undefined}
            muted={!hasTranscript}
          />
          <MetricChip label="Total KIs" value={String(canonical.knowledge_item_count)} onClick={() => onNavigateTab('knowledge')} />
          <MetricChip label="Active KIs" value={String(canonical.active_ki_count)} onClick={() => onNavigateTab('knowledge')} accent={canonical.active_ki_count > 0} />
          <MetricChip label="With Contexts" value={String(canonical.active_ki_with_context_count)} onClick={() => onNavigateTab('knowledge')} accent={canonical.active_ki_with_context_count > 0} />
        </div>
      </Section>

      {/* ── Why this state ── */}
      <Section title={`Why: ${CONTROL_PLANE_LABELS[state]}`}>
        <p className="text-muted-foreground italic text-xs mb-1.5">{evidence.reason}</p>
        <div className="space-y-1">
          {evidence.evidence.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {e.pass
                ? <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                : <XCircle className="h-3 w-3 text-destructive shrink-0" />
              }
              <span className="text-muted-foreground">{e.label}</span>
              <span className="ml-auto font-mono tabular-nums">{e.value}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Lineage ── */}
      <Section title="Lineage">
        <div className="space-y-1 text-xs">
          <Row label="Resource ID" value={canonical.resource_id.slice(0, 8) + '…'} mono />
          {detail?.original_url && (
            <Row label="Source URL">
              <a href={detail.original_url} target="_blank" rel="noopener noreferrer"
                className="text-primary hover:underline truncate max-w-[200px] inline-block text-[10px]">
                {detail.original_url.replace(/^https?:\/\//, '').slice(0, 40)}…
              </a>
            </Row>
          )}
          {detail?.source_resource_id && <Row label="Parent" value={detail.source_resource_id.slice(0, 8) + '…'} mono />}
          {detail?.show_title && <Row label="Show/Course" value={detail.show_title} />}
          {detail?.host_platform && <Row label="Platform" value={detail.host_platform} />}
          {detail?.file_url && <Row label="Storage" value="File stored ✓" />}
        </div>
      </Section>

      {/* ── Timestamps ── */}
      <Section title="Timeline">
        <div className="space-y-1 text-xs">
          <Row label="Created" value={detail?.created_at ? new Date(detail.created_at).toLocaleString() : '—'} />
          <Row label="Updated" value={detail?.updated_at ? new Date(detail.updated_at).toLocaleString() : '—'} />
          {detail?.enriched_at && <Row label="Enriched" value={new Date(detail.enriched_at).toLocaleString()} />}
          {detail?.last_extraction_completed_at && (
            <Row label="Last Extraction" value={new Date(detail.last_extraction_completed_at).toLocaleString()} />
          )}
        </div>
      </Section>

      {/* ── Conflicts ── */}
      {conflicts.length > 0 && (
        <Section title="Conflicts" destructive>
          <div className="space-y-1.5">
            {conflicts.map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <AlertTriangle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                <span className="text-destructive/90">{c}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────
function Section({ title, children, destructive }: { title: string; children: React.ReactNode; destructive?: boolean }) {
  return (
    <div className="space-y-1.5">
      <h4 className={cn('text-[11px] font-semibold uppercase tracking-wide', destructive ? 'text-destructive' : 'text-muted-foreground')}>
        {title}
      </h4>
      {children}
    </div>
  );
}

function Row({ label, value, mono, destructive, children }: {
  label: string; value?: string; mono?: boolean; destructive?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}</span>
      {children ?? (
        <span className={cn(
          mono && 'font-mono text-[10px]',
          destructive && 'text-destructive font-medium',
        )}>{value}</span>
      )}
    </div>
  );
}

function MetricChip({ label, value, onClick, muted, accent }: {
  label: string; value: string; onClick?: () => void; muted?: boolean; accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition-colors',
        onClick && 'hover:bg-accent/50 cursor-pointer',
        !onClick && 'cursor-default',
        muted && 'opacity-50',
      )}
    >
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-semibold tabular-nums', accent && 'text-emerald-600')}>{value}</span>
    </button>
  );
}

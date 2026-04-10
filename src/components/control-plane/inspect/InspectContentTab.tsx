/**
 * Content tab — stored content preview, raw toggle, transcript, extraction diagnostics.
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, FileText, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { isPlaceholderContent } from '@/lib/canonicalLifecycle';
import type { ResourceDetail } from '@/hooks/useResourceInspectData';

interface Props {
  detail: ResourceDetail | null;
  loading: boolean;
}

export function InspectContentTab({ detail, loading }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  if (loading) {
    return <p className="text-xs text-muted-foreground italic py-4">Loading content…</p>;
  }

  if (!detail) {
    return <p className="text-xs text-muted-foreground italic py-4">No resource data available</p>;
  }

  const content = detail.content ?? '';
  const contentLength = content.length;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const previewLength = 2000;
  const isTruncated = content.length > previewLength;
  const hasTranscript = detail.transcript_status === 'transcript_ready' || detail.transcript_status === 'completed';

  // Detect potential issues
  const issues: string[] = [];

  // Rule B: Placeholder content detection
  if (isPlaceholderContent(content)) {
    issues.push('Placeholder content only — PDF parse incomplete. Real content has not been extracted yet.');
  }

  if (contentLength === 0 && detail.content_length && detail.content_length > 0) {
    issues.push('content_length is set but stored content is empty — possible truncation or fetch failure');
  }
  if (contentLength > 0 && contentLength < 200 && !isPlaceholderContent(content)) {
    issues.push('Content is very short (<200 chars) — may be incomplete');
  }
  if (content.includes('<nav') || content.includes('<footer') || content.includes('<aside')) {
    issues.push('Content may contain HTML page chrome (nav/footer/aside tags)');
  }
  const duplicateCheck = detectDuplicateParagraphs(content);
  if (duplicateCheck) {
    issues.push(duplicateCheck);
  }

  return (
    <div className="space-y-4">
      {/* ── Content Summary ── */}
      <div className="flex items-center gap-3 text-xs">
        <Badge variant="outline" className="text-[10px]">{wordCount.toLocaleString()} words</Badge>
        <Badge variant="outline" className="text-[10px]">{contentLength.toLocaleString()} chars</Badge>
        {detail.content_classification && (
          <Badge variant="outline" className="text-[10px]">{detail.content_classification}</Badge>
        )}
        {hasTranscript && (
          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200">Transcript ✓</Badge>
        )}
      </div>

      {/* ── Issues ── */}
      {issues.length > 0 && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 space-y-1">
          {issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
              <span className="text-amber-700 dark:text-amber-400">{issue}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Content Preview ── */}
      <Section title="Stored Content">
        {contentLength === 0 ? (
          <p className="text-xs text-muted-foreground italic">No content stored</p>
        ) : (
          <div className="space-y-2">
            <pre className={cn(
              'text-xs font-mono bg-muted/30 rounded-md p-3 whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto border',
              showRaw ? 'max-h-[600px]' : '',
            )}>
              {showRaw ? content : (isTruncated ? content.slice(0, previewLength) + '\n\n…[truncated]' : content)}
            </pre>
            {isTruncated && (
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setShowRaw(!showRaw)}>
                {showRaw ? 'Show preview' : `Show full content (${contentLength.toLocaleString()} chars)`}
              </Button>
            )}
          </div>
        )}
      </Section>

      {/* ── Extraction Diagnostics ── */}
      <Collapsible
        title="Extraction Diagnostics"
        open={showDiagnostics}
        onToggle={() => setShowDiagnostics(!showDiagnostics)}
      >
        <div className="space-y-1 text-xs">
          <DiagRow label="Method" value={detail.extraction_method ?? '—'} />
          <DiagRow label="Attempts" value={String(detail.extraction_attempt_count)} />
          <DiagRow label="Depth Bucket" value={detail.extraction_depth_bucket ?? '—'} />
          <DiagRow label="Last Run Status" value={detail.last_extraction_run_status ?? '—'} pass={detail.last_extraction_run_status === 'completed'} />
          <DiagRow label="Saved KIs" value={String(detail.last_extraction_saved_ki_count ?? 0)} />
          <DiagRow label="Returned KIs" value={String(detail.last_extraction_returned_ki_count ?? 0)} />
          <DiagRow label="Quality Score" value={detail.last_quality_score != null ? String(detail.last_quality_score) : '—'} />
          <DiagRow label="Quality Tier" value={detail.last_quality_tier ?? '—'} />
          {detail.extraction_batch_status && (
            <>
              <DiagRow label="Batch Status" value={detail.extraction_batch_status} />
              <DiagRow label="Batches" value={`${detail.extraction_batches_completed ?? 0} / ${detail.extraction_batch_total ?? '?'}`} />
            </>
          )}
          {detail.last_extraction_error && (
            <div className="mt-1.5 rounded border border-destructive/20 bg-destructive/5 px-2 py-1.5">
              <p className="text-[10px] text-destructive font-mono">{detail.last_extraction_error}</p>
            </div>
          )}
          {detail.last_extraction_summary && (
            <div className="mt-1.5 rounded border bg-muted/30 px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground">{detail.last_extraction_summary}</p>
            </div>
          )}
        </div>
      </Collapsible>

      {/* ── Enrichment Audit ── */}
      {detail.enrichment_audit_log && typeof detail.enrichment_audit_log === 'object' && Object.keys(detail.enrichment_audit_log).length > 0 && (
        <Collapsible
          title="Enrichment Audit Log"
          open={false}
          onToggle={() => {}}
          renderOnce
        >
          <pre className="text-[10px] font-mono bg-muted/30 rounded p-2 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
            {JSON.stringify(detail.enrichment_audit_log, null, 2)}
          </pre>
        </Collapsible>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function Collapsible({ title, open: defaultOpen, onToggle, children, renderOnce }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode; renderOnce?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const toggle = renderOnce ? () => setIsOpen(!isOpen) : onToggle;
  const open = renderOnce ? isOpen : defaultOpen;

  return (
    <div className="space-y-1.5">
      <button onClick={toggle} className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && children}
    </div>
  );
}

function DiagRow({ label, value, pass }: { label: string; value: string; pass?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        {pass !== undefined && (
          pass ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" /> : <XCircle className="h-2.5 w-2.5 text-destructive" />
        )}
        <span className="font-mono text-[10px]">{value}</span>
      </div>
    </div>
  );
}

function detectDuplicateParagraphs(content: string): string | null {
  if (!content || content.length < 500) return null;
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 50);
  const seen = new Set<string>();
  let dupes = 0;
  for (const p of paragraphs) {
    const normalized = p.trim().slice(0, 100);
    if (seen.has(normalized)) dupes++;
    seen.add(normalized);
  }
  if (dupes >= 3) return `${dupes} duplicate paragraphs detected — possible content duplication`;
  return null;
}

/**
 * Knowledge > Overview — the management dashboard.
 * 
 * Answers: What do I have? What is usable? What is blocked? What should I do next?
 * All counts from canonical lifecycle only.
 */

import { memo, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2, AlertTriangle, ArrowRight, Brain, Zap, Ban, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCanonicalLifecycle, STAGE_LABELS, BLOCKED_LABELS } from '@/hooks/useCanonicalLifecycle';
import type { LifecycleSummary, CanonicalResourceStatus } from '@/lib/canonicalLifecycle';

interface Props {
  onNavigateToResources?: () => void;
  onNavigateToAudit?: () => void;
  onNavigateToKnowledgeItems?: () => void;
}

export const KnowledgeOverview = memo(function KnowledgeOverview({
  onNavigateToResources,
  onNavigateToAudit,
  onNavigateToKnowledgeItems,
}: Props) {
  const { summary, loading, refetch } = useCanonicalLifecycle();

  if (loading || !summary) {
    return (
      <div className="flex items-center justify-center py-12">
        <Brain className="h-5 w-5 animate-pulse text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Loading knowledge overview…</span>
      </div>
    );
  }

  const totalBlocked = summary.blocked.empty_content + summary.blocked.no_extraction
    + summary.blocked.no_activation + summary.blocked.missing_contexts
    + summary.blocked.stale_blocker_state;

  // "What should I do next?" — prioritized actions
  const nextActions = buildNextActions(summary, totalBlocked);

  // Top resources by lifecycle stage
  const neverUsed = summary.resources.filter(
    r => r.active_ki_count > 0 && r.active_ki_with_context_count === 0
  );
  const biggestLeak = summary.blocked.no_extraction > 0
    ? 'no_extraction'
    : summary.blocked.missing_contexts > 0
    ? 'missing_contexts'
    : summary.blocked.no_activation > 0
    ? 'no_activation'
    : null;

  return (
    <div className="space-y-4">
      {/* Source of truth notice */}
      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Info className="h-3 w-3 shrink-0" />
        All counts from the canonical lifecycle model — one source of truth for every surface.
      </p>

      {/* ── Primary Funnel ── */}
      <div className="grid grid-cols-3 gap-2">
        <FunnelCard
          label="Total Resources"
          value={summary.total_resources}
          sublabel="Raw source material in library"
          color="text-foreground"
        />
        <FunnelCard
          label="Ready to Use"
          value={summary.operationalized}
          sublabel="Active knowledge with contexts"
          color="text-emerald-600"
          accent
        />
        <FunnelCard
          label="Blocked"
          value={totalBlocked}
          sublabel="Need action to become usable"
          color="text-destructive"
          warn={totalBlocked > 0}
        />
      </div>

      {/* ── Blocker Breakdown ── */}
      {totalBlocked > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Ban className="h-3.5 w-3.5 text-destructive" />
              Why resources are blocked
            </p>
            <div className="space-y-1">
              {summary.blocked.no_extraction > 0 && (
                <BlockerRow label="Needs extraction" count={summary.blocked.no_extraction} />
              )}
              {summary.blocked.no_activation > 0 && (
                <BlockerRow label="Needs activation" count={summary.blocked.no_activation} />
              )}
              {summary.blocked.missing_contexts > 0 && (
                <BlockerRow label="Needs context repair" count={summary.blocked.missing_contexts} />
              )}
              {summary.blocked.empty_content > 0 && (
                <BlockerRow label="Empty content" count={summary.blocked.empty_content} />
              )}
              {summary.blocked.stale_blocker_state > 0 && (
                <BlockerRow label="Needs review" count={summary.blocked.stale_blocker_state} />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── What Should I Do Next? ── */}
      {nextActions.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground">What should I do next?</p>
            {nextActions.map((action, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="font-bold text-primary shrink-0 mt-px">{i + 1}.</span>
                <span className="text-foreground">{action}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Lifecycle Pipeline ── */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">Lifecycle Pipeline</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            <MiniStat label="Uploaded" value={summary.total_resources} />
            <MiniStat label="Content Ready" value={summary.content_ready} />
            <MiniStat label="Enriched" value={summary.enriched} />
            <MiniStat label="With Knowledge" value={summary.with_knowledge} />
            <MiniStat label="Activated" value={summary.activated} />
            <MiniStat label="Ready to Use" value={summary.operationalized} accent />
          </div>
          <p className="text-[9px] text-muted-foreground">
            Resources → Content → Knowledge → Activation → Operationalized
          </p>
        </CardContent>
      </Card>

      {/* ── Biggest Leak ── */}
      {biggestLeak && (
        <Card className="border-amber-500/20">
          <CardContent className="p-3">
            <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Biggest leak: {BLOCKED_LABELS[biggestLeak] ?? biggestLeak}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {summary.blocked[biggestLeak as keyof typeof summary.blocked]} resources are stuck at this stage.
              {onNavigateToAudit && (
                <Button variant="link" size="sm" className="h-auto p-0 ml-1 text-[10px]" onClick={onNavigateToAudit}>
                  View in Audit <ArrowRight className="h-3 w-3 ml-0.5" />
                </Button>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Navigation shortcuts ── */}
      <div className="flex gap-2 flex-wrap">
        {onNavigateToResources && (
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onNavigateToResources}>
            View Resources <ArrowRight className="h-3 w-3" />
          </Button>
        )}
        {onNavigateToKnowledgeItems && (
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onNavigateToKnowledgeItems}>
            View Knowledge Items <ArrowRight className="h-3 w-3" />
          </Button>
        )}
        {onNavigateToAudit && (
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onNavigateToAudit}>
            Deep Audit <ArrowRight className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
});

function FunnelCard({ label, value, sublabel, color, accent, warn }: {
  label: string; value: number; sublabel: string; color: string; accent?: boolean; warn?: boolean;
}) {
  return (
    <Card className={cn(accent && 'border-emerald-500/30', warn && 'border-destructive/30')}>
      <CardContent className="p-3 text-center">
        <p className={cn('text-2xl font-bold', color)}>{value}</p>
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-[9px] text-muted-foreground">{sublabel}</p>
      </CardContent>
    </Card>
  );
}

function BlockerRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant="outline" className="text-[10px] text-destructive">{count}</Badge>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-1.5 text-center">
      <p className={cn('text-sm font-bold', accent ? 'text-emerald-600' : 'text-foreground')}>{value}</p>
      <p className="text-[8px] text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}

function buildNextActions(summary: LifecycleSummary, totalBlocked: number): string[] {
  const actions: string[] = [];
  if (summary.blocked.stale_blocker_state > 0) {
    actions.push(`Fix ${summary.blocked.stale_blocker_state} resources stuck in stale state`);
  }
  if (summary.blocked.no_extraction > 0) {
    actions.push(`Extract knowledge from ${summary.blocked.no_extraction} enriched resources`);
  }
  if (summary.blocked.no_activation > 0) {
    actions.push(`Activate ${summary.blocked.no_activation} extracted knowledge items`);
  }
  if (summary.blocked.missing_contexts > 0) {
    actions.push(`Add contexts to ${summary.blocked.missing_contexts} active knowledge items`);
  }
  if (summary.blocked.empty_content > 0) {
    actions.push(`Add content to ${summary.blocked.empty_content} empty resources`);
  }
  if (actions.length === 0 && summary.operationalized > 0) {
    actions.push('All clear — your knowledge base is in good shape');
  }
  return actions.slice(0, 4);
}

/**
 * Low-yield review queue — resources with only 1–2 active KIs.
 * Defaults to showing only unreviewed items. Toggle to show all.
 * Resource-level actions: Keep As-Is, Re-Extract, Archive/Deprioritize.
 */
import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronDown, ChevronRight, CheckCircle2, Archive, RotateCcw, AlertTriangle,
  ThumbsUp, RefreshCw, FolderMinus, Loader2, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useLowYieldResources, useSetReviewStatus, useBulkSetReviewStatus,
  type ReviewStatus,
} from '@/hooks/useKnowledgeReview';
import type { KnowledgeItem } from '@/hooks/useKnowledgeItems';
import { useReExtractResource } from '@/hooks/useReExtractResource';
import { toast } from 'sonner';

function ReviewBadge({ status }: { status: ReviewStatus }) {
  const map: Record<ReviewStatus, { label: string; cls: string }> = {
    unreviewed: { label: 'Unreviewed', cls: 'bg-muted text-muted-foreground' },
    approved: { label: 'Approved', cls: 'bg-emerald-500/15 text-emerald-600' },
    needs_rework: { label: 'Needs Rework', cls: 'bg-amber-500/15 text-amber-600' },
    archived: { label: 'Archived', cls: 'bg-muted text-muted-foreground line-through' },
  };
  const { label, cls } = map[status] || map.unreviewed;
  return <Badge variant="outline" className={cn('text-[10px]', cls)}>{label}</Badge>;
}

function KIRow({ ki }: { ki: KnowledgeItem }) {
  const setReview = useSetReviewStatus();
  const status = (ki as any).review_status || 'unreviewed';

  return (
    <div className="border border-border rounded-md p-2.5 space-y-1.5 bg-background">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">{ki.title}</p>
          {ki.who && <p className="text-[10px] text-muted-foreground">{ki.framework ? `${ki.framework} — ${ki.who}` : ki.who}</p>}
        </div>
        <ReviewBadge status={status} />
      </div>
      {ki.tactic_summary && (
        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{ki.tactic_summary}</p>
      )}
      {ki.source_excerpt && (
        <p className="text-[10px] text-muted-foreground/70 italic line-clamp-2 border-l-2 border-border pl-2">{ki.source_excerpt}</p>
      )}
      <div className="flex gap-1 pt-0.5">
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
          onClick={() => setReview.mutate({ id: ki.id, status: 'approved' })}>
          <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
          onClick={() => setReview.mutate({ id: ki.id, status: 'needs_rework' })}>
          <RotateCcw className="h-3 w-3 mr-1" /> Rework
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
          onClick={() => setReview.mutate({ id: ki.id, status: 'archived' })}>
          <Archive className="h-3 w-3 mr-1" /> Archive
        </Button>
      </div>
    </div>
  );
}

export function LowYieldReviewQueue() {
  const allLowYield = useLowYieldResources();
  const bulkReview = useBulkSetReviewStatus();
  const { reExtract, getStatus } = useReExtractResource();
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [showReviewed, setShowReviewed] = useState(false);

  const lowYield = useMemo(() => {
    if (showReviewed) return allLowYield;
    return allLowYield.filter(r => r.unreviewedCount > 0);
  }, [allLowYield, showReviewed]);

  const totalUnreviewed = allLowYield.reduce((s, r) => s + r.unreviewedCount, 0);

  const toggle = (id: string) => setOpenIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleKeepAsIs = (kis: KnowledgeItem[]) => {
    const ids = kis.map(k => k.id);
    bulkReview.mutate({ ids, status: 'approved' });
  };

  const handleArchiveResource = (kis: KnowledgeItem[]) => {
    const ids = kis.map(k => k.id);
    bulkReview.mutate({ ids, status: 'archived' });
  };

  if (allLowYield.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No low-yield resources — all have 3+ KIs.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Low-Yield Resources
            <Badge variant="secondary" className="text-[10px]">
              {totalUnreviewed} unreviewed
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Show reviewed</span>
            <Switch checked={showReviewed} onCheckedChange={setShowReviewed} className="scale-75" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Resources with only 1–2 active Knowledge Items</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {lowYield.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">All low-yield resources reviewed. Toggle "Show reviewed" to see them.</p>
        )}
        {lowYield.map(({ resource, kis, unreviewedCount }) => {
          const isOpen = openIds.has(resource.id);
          return (
            <Collapsible key={resource.id} open={isOpen} onOpenChange={() => toggle(resource.id)}>
              <CollapsibleTrigger className="flex items-center gap-2 w-full text-left p-2 rounded-md hover:bg-muted/50 transition-colors">
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="text-xs font-medium text-foreground flex-1 truncate">{resource.title}</span>
                <Badge variant="outline" className="text-[10px]">{kis.length} KI{kis.length !== 1 ? 's' : ''}</Badge>
                {unreviewedCount > 0 && (
                  <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">{unreviewedCount} unreviewed</Badge>
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-6 space-y-1.5 pt-1 pb-2">
                {/* Resource-level actions */}
                <div className="flex gap-1.5 pb-1.5 border-b border-border mb-1.5">
                  <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]"
                    onClick={() => handleKeepAsIs(kis)}>
                    <ThumbsUp className="h-3 w-3 mr-1" /> Keep As-Is
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]"
                    onClick={handleReExtract}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Re-Extract
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]"
                    onClick={() => handleArchiveResource(kis)}>
                    <FolderMinus className="h-3 w-3 mr-1" /> Archive / Deprioritize
                  </Button>
                </div>
                {kis.map(ki => <KIRow key={ki.id} ki={ki} />)}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </CardContent>
    </Card>
  );
}

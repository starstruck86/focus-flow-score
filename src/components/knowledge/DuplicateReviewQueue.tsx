/**
 * Duplicate review queue — likely duplicate KI pairs ranked by similarity.
 * Shows same-resource vs cross-resource, attribution, overlapping words, excerpt strength.
 */
import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { CheckCircle2, Copy, XCircle, FileText, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDuplicateKIs, useDeactivateKI, type DuplicatePair } from '@/hooks/useKnowledgeReview';
import type { KnowledgeItem } from '@/hooks/useKnowledgeItems';

function excerptStrength(ki: KnowledgeItem): { label: string; cls: string } {
  const len = (ki.source_excerpt || '').length;
  if (len > 100) return { label: 'Strong excerpt', cls: 'text-emerald-600' };
  if (len > 30) return { label: 'Partial excerpt', cls: 'text-amber-600' };
  return { label: 'No excerpt', cls: 'text-muted-foreground' };
}

function attributionLabel(ki: KnowledgeItem): string {
  const parts: string[] = [];
  if (ki.framework && ki.framework !== 'General') parts.push(ki.framework);
  if (ki.who) parts.push(ki.who);
  return parts.length > 0 ? parts.join(' — ') : 'No attribution';
}

function KISide({ ki, resourceName }: { ki: KnowledgeItem; resourceName: string }) {
  const deactivate = useDeactivateKI();
  const exc = excerptStrength(ki);
  const reviewed = (ki as any).review_status && (ki as any).review_status !== 'unreviewed';

  return (
    <div className={cn('space-y-1.5 border border-border rounded-md p-2', reviewed && 'opacity-60')}>
      <p className="text-[11px] font-medium text-foreground line-clamp-2">{ki.title}</p>
      <p className="text-[10px] text-muted-foreground truncate">{resourceName}</p>
      {ki.tactic_summary && (
        <p className="text-[10px] text-muted-foreground/80 line-clamp-3">{ki.tactic_summary}</p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] text-muted-foreground">{attributionLabel(ki)}</span>
        <span className={cn('text-[9px]', exc.cls)}>{exc.label}</span>
        <AttributionProvenanceBadge activationMetadata={ki.activation_metadata} />
      </div>
      <div className="pt-1">
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-destructive"
          onClick={() => deactivate.mutate(ki.id)}
          disabled={deactivate.isPending}>
          <XCircle className="h-3 w-3 mr-1" /> Deactivate
        </Button>
      </div>
    </div>
  );
}

function PairCard({ pair }: { pair: DuplicatePair }) {
  return (
    <div className="border border-border rounded-lg p-3 space-y-2.5 bg-background">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/30">
          {Math.round(pair.similarity * 100)}% similar
        </Badge>
        {pair.sameResource ? (
          <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
            <Layers className="h-2.5 w-2.5 mr-0.5" /> Same resource
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
            <FileText className="h-2.5 w-2.5 mr-0.5" /> Cross-resource
          </Badge>
        )}
        {pair.overlappingWords.length > 0 && (
          <span className="text-[9px] text-muted-foreground">
            Overlap: {pair.overlappingWords.join(', ')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <KISide ki={pair.a} resourceName={pair.resourceNameA} />
        <KISide ki={pair.b} resourceName={pair.resourceNameB} />
      </div>
    </div>
  );
}

export function DuplicateReviewQueue() {
  const allPairs = useDuplicateKIs();
  const [showReviewed, setShowReviewed] = useState(false);

  const pairs = useMemo(() => {
    if (showReviewed) return allPairs;
    return allPairs.filter(p => {
      const aStatus = (p.a as any).review_status || 'unreviewed';
      const bStatus = (p.b as any).review_status || 'unreviewed';
      return aStatus === 'unreviewed' || bStatus === 'unreviewed';
    });
  }, [allPairs, showReviewed]);

  const unreviewedCount = allPairs.filter(p => {
    const a = (p.a as any).review_status || 'unreviewed';
    const b = (p.b as any).review_status || 'unreviewed';
    return a === 'unreviewed' || b === 'unreviewed';
  }).length;

  if (allPairs.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No likely duplicates detected.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Copy className="h-4 w-4 text-amber-500" />
            Likely Duplicates
            <Badge variant="secondary" className="text-[10px]">{unreviewedCount} unreviewed</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Show reviewed</span>
            <Switch checked={showReviewed} onCheckedChange={setShowReviewed} className="scale-75" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">KI pairs with &gt;50% title+summary overlap — deactivate one or keep both</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {pairs.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">All duplicate pairs reviewed. Toggle "Show reviewed" to see them.</p>
        )}
        {pairs.map((pair) => <PairCard key={`${pair.a.id}-${pair.b.id}`} pair={pair} />)}
      </CardContent>
    </Card>
  );
}

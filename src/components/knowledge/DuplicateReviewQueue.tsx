/**
 * Duplicate review queue — likely duplicate KI pairs ranked by similarity.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Copy, XCircle } from 'lucide-react';
import { useDuplicateKIs, useDeactivateKI, type DuplicatePair } from '@/hooks/useKnowledgeReview';

function PairCard({ pair }: { pair: DuplicatePair }) {
  const deactivate = useDeactivateKI();

  return (
    <div className="border border-border rounded-lg p-3 space-y-3 bg-background">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/30">
          {Math.round(pair.similarity * 100)}% similar
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[pair.a, pair.b].map((ki, idx) => (
          <div key={ki.id} className="space-y-1 border border-border rounded-md p-2">
            <p className="text-[11px] font-medium text-foreground line-clamp-2">{ki.title}</p>
            <p className="text-[10px] text-muted-foreground">
              {idx === 0 ? pair.resourceNameA : pair.resourceNameB}
            </p>
            {ki.tactic_summary && (
              <p className="text-[10px] text-muted-foreground/80 line-clamp-2">{ki.tactic_summary}</p>
            )}
            {ki.who && (
              <p className="text-[10px] text-muted-foreground/60">{ki.framework ? `${ki.framework} — ${ki.who}` : ki.who}</p>
            )}
            <div className="pt-1">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-destructive"
                onClick={() => deactivate.mutate(ki.id)}
                disabled={deactivate.isPending}>
                <XCircle className="h-3 w-3 mr-1" /> Deactivate
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DuplicateReviewQueue() {
  const pairs = useDuplicateKIs();

  if (pairs.length === 0) {
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
        <CardTitle className="text-sm flex items-center gap-2">
          <Copy className="h-4 w-4 text-amber-500" />
          Likely Duplicates
          <Badge variant="secondary" className="text-[10px]">{pairs.length} pairs</Badge>
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">KI pairs with &gt;50% title+summary overlap — deactivate one or keep both</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {pairs.map((pair, idx) => <PairCard key={`${pair.a.id}-${pair.b.id}`} pair={pair} />)}
      </CardContent>
    </Card>
  );
}

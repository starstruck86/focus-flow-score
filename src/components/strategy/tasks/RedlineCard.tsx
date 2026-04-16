import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, X as XIcon, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Redline } from '@/hooks/strategy/useTaskExecution';

interface Props {
  redline: Redline;
  onAccept: () => void;
  onReject: () => void;
}

export function RedlineCard({ redline, onAccept, onReject }: Props) {
  const isResolved = redline.status === 'accepted' || redline.status === 'rejected';

  return (
    <Card className={cn(
      'border-border/15 shadow-none transition-all',
      redline.status === 'accepted' && 'opacity-60 border-green-300/30 bg-green-50/20 dark:bg-green-950/10',
      redline.status === 'rejected' && 'opacity-40',
    )}>
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="text-[9px] font-medium border-primary/20 text-primary/70">
            {redline.section_name}
          </Badge>
          {redline.status === 'accepted' && (
            <Badge className="text-[8px] bg-green-100 text-green-700 border-0">Applied</Badge>
          )}
          {redline.status === 'rejected' && (
            <Badge className="text-[8px] bg-muted text-muted-foreground border-0">Dismissed</Badge>
          )}
        </div>

        {/* Current → Proposed */}
        <div className="space-y-1.5">
          <div className="rounded-md bg-red-50/50 dark:bg-red-950/15 border border-red-200/20 px-2.5 py-1.5">
            <p className="text-[9px] font-medium text-red-600 mb-0.5">Current</p>
            <p className="text-xs text-foreground/70 line-through decoration-red-300">{redline.current_text}</p>
          </div>
          <div className="flex justify-center">
            <ArrowRight className="h-3 w-3 text-muted-foreground/30" />
          </div>
          <div className="rounded-md bg-green-50/50 dark:bg-green-950/15 border border-green-200/20 px-2.5 py-1.5">
            <p className="text-[9px] font-medium text-green-600 mb-0.5">Proposed</p>
            <p className="text-xs text-foreground">{redline.proposed_text}</p>
          </div>
        </div>

        {/* Rationale */}
        <p className="text-[10px] text-muted-foreground italic leading-relaxed">
          {redline.rationale}
        </p>

        {/* Actions */}
        {!isResolved && (
          <div className="flex items-center gap-1.5 pt-1">
            <Button size="sm" className="h-6 text-[10px] gap-1 bg-green-600 hover:bg-green-700" onClick={onAccept}>
              <Check className="h-2.5 w-2.5" /> Accept
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={onReject}>
              <XIcon className="h-2.5 w-2.5" /> Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

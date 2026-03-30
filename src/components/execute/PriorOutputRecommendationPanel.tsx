import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { History, Eye, BookmarkPlus } from 'lucide-react';
import { useExecutionOutputs } from '@/hooks/useExecutionOutputs';
import type { ExecutionOutput, OutputType } from '@/lib/executionTemplateTypes';

interface Props {
  outputType: OutputType;
  onUseAsBase: (output: ExecutionOutput) => void;
  onPromote: (output: ExecutionOutput) => void;
}

export function PriorOutputRecommendationPanel({ outputType, onUseAsBase, onPromote }: Props) {
  const { data: outputs = [] } = useExecutionOutputs(outputType);

  const strongFirst = [...outputs].sort((a, b) => {
    if (a.is_strong_example && !b.is_strong_example) return -1;
    if (!a.is_strong_example && b.is_strong_example) return 1;
    return (b.times_reused || 0) - (a.times_reused || 0);
  }).slice(0, 5);

  if (!strongFirst.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <History className="h-3.5 w-3.5 text-primary" />
          Best Prior Outputs
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        {strongFirst.map(o => (
          <div key={o.id} className="flex items-start gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors group">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium truncate">{o.title}</span>
                {o.is_strong_example && <Badge className="text-[9px] bg-primary/20 text-primary">Strong</Badge>}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                {o.account_name && `${o.account_name} · `}{o.stage || 'No stage'} · {new Date(o.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => onUseAsBase(o)}>
                <Eye className="h-3 w-3 mr-1" /> Use
              </Button>
              {!o.is_promoted_to_template && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => onPromote(o)}>
                  <BookmarkPlus className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

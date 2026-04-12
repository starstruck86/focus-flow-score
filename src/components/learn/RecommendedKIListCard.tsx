import { Lightbulb } from 'lucide-react';

interface Props {
  kis: Array<{ id: string; title: string; reason: string }>;
}

export function RecommendedKIListCard({ kis }: Props) {
  if (kis.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        Best KIs to review
      </p>
      {kis.map((ki) => (
        <div
          key={ki.id}
          className="flex items-start gap-2 px-2.5 py-1.5 rounded-md bg-muted/30 border border-border/30"
        >
          <Lightbulb className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{ki.title}</p>
            <p className="text-[10px] text-muted-foreground">{ki.reason}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

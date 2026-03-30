/**
 * Best Assets panel — auto-filtered templates, examples, and knowledge items
 * ranked by relevance to current stage and context.
 */

import { Badge } from '@/components/ui/badge';
import { FileText, BookOpen, Brain } from 'lucide-react';
import type { RankedResource } from './resourceRanking';

interface Props {
  templates: RankedResource[];
  examples: RankedResource[];
  knowledgeItems: RankedResource[];
  isLoading?: boolean;
}

function AssetSection({ icon: Icon, label, items }: { icon: React.ElementType; label: string; items: RankedResource[] }) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="space-y-1">
        {items.map(item => (
          <div key={item.id} className="flex items-start gap-2 py-1.5 px-2.5 rounded-md bg-muted/20 border border-border">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{item.title}</p>
              {item.reasons.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{item.reasons.slice(0, 2).join(' · ')}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BestAssets({ templates, examples, knowledgeItems, isLoading }: Props) {
  const total = templates.length + examples.length + knowledgeItems.length;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Best Assets</h3>
        <p className="text-[10px] text-muted-foreground">Loading relevant assets…</p>
      </div>
    );
  }

  if (total === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Best Assets</h3>
        <Badge variant="secondary" className="text-[9px]">{total} matched</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <AssetSection icon={FileText} label="Templates" items={templates} />
        <AssetSection icon={BookOpen} label="Examples" items={examples} />
        <AssetSection icon={Brain} label="Knowledge" items={knowledgeItems} />
      </div>
    </div>
  );
}

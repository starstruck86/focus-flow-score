/**
 * Best Assets panel — Gold Standard Templates, Strong Examples, and Supporting Knowledge.
 */

import { Badge } from '@/components/ui/badge';
import { FileText, BookOpen, Brain, Crown } from 'lucide-react';
import type { RankedResource } from './resourceRanking';

interface Props {
  templates: RankedResource[];
  examples: RankedResource[];
  knowledgeItems: RankedResource[];
  isLoading?: boolean;
}

function AssetSection({
  icon: Icon,
  label,
  items,
  isGold,
}: {
  icon: React.ElementType;
  label: string;
  items: RankedResource[];
  isGold?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <Icon className={`h-3 w-3 ${isGold ? 'text-amber-500' : ''}`} />
        {label}
        {isGold && <Crown className="h-2.5 w-2.5 text-amber-500" />}
      </div>
      <div className="space-y-1">
        {items.map(item => (
          <div
            key={item.id}
            className={`flex items-start gap-2 py-1.5 px-2.5 rounded-md border ${
              isGold
                ? 'bg-amber-500/5 border-amber-500/20'
                : 'bg-muted/20 border-border'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="text-xs font-medium truncate">{item.title}</p>
                {item.score >= 5 && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
                    Top match
                  </Badge>
                )}
              </div>
              {item.reasons.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {item.reasons.slice(0, 3).join(' · ')}
                </p>
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
        <AssetSection icon={FileText} label="Gold Standard Templates" items={templates} isGold />
        <AssetSection icon={BookOpen} label="Strong Examples" items={examples} />
        <AssetSection icon={Brain} label="Supporting Knowledge" items={knowledgeItems} />
      </div>
    </div>
  );
}

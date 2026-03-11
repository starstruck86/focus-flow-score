// Smart Work Queue: Prioritized action list answering "What should I work on right now?"
import { useNavigate } from 'react-router-dom';
import { useTimeAllocation, type WorkItem, type WorkItemUrgency } from '@/hooks/useTimeAllocation';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Crosshair, 
  Clock, 
  DollarSign, 
  ArrowRight, 
  Calendar, 
  Building2, 
  TrendingUp,
  AlertTriangle,
  Zap,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const URGENCY_STYLES: Record<WorkItemUrgency, { bg: string; text: string; border: string; label: string }> = {
  critical: { bg: 'bg-status-red/10', text: 'text-status-red', border: 'border-l-status-red', label: 'NOW' },
  high:     { bg: 'bg-status-yellow/10', text: 'text-status-yellow', border: 'border-l-status-yellow', label: 'TODAY' },
  medium:   { bg: 'bg-primary/10', text: 'text-primary', border: 'border-l-primary', label: 'THIS WEEK' },
  low:      { bg: 'bg-muted/50', text: 'text-muted-foreground', border: 'border-l-border', label: 'SOON' },
};

const TYPE_ICONS: Record<string, typeof Building2> = {
  account: Building2,
  opportunity: TrendingUp,
  renewal: RefreshCw,
};

function WorkItemCard({ item, index }: { item: WorkItem; index: number }) {
  const navigate = useNavigate();
  const urgencyStyle = URGENCY_STYLES[item.urgency];
  const TypeIcon = TYPE_ICONS[item.type] || Building2;

  const formatArr = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;

  return (
    <button
      onClick={() => navigate(item.route)}
      className={cn(
        "w-full flex items-start gap-3 p-3 rounded-lg border-l-[3px] border border-border/50 transition-all text-left",
        "hover:bg-muted/30 hover:border-border hover:shadow-sm",
        urgencyStyle.border,
      )}
    >
      {/* Rank */}
      <div className={cn(
        "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
        index < 3 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
      )}>
        {index + 1}
      </div>

      <div className="flex-1 min-w-0">
        {/* Header line */}
        <div className="flex items-center gap-2 mb-0.5">
          <TypeIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{item.name}</span>
          {item.hasMeetingToday && (
            <Calendar className="h-3 w-3 text-primary shrink-0" />
          )}
        </div>

        {/* Reason + Action */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground truncate">{item.reason}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          <span className="text-foreground font-medium truncate">{item.action}</span>
        </div>

        {/* Bottom metadata */}
        <div className="flex items-center gap-3 mt-1.5">
          <Badge className={cn("text-[9px] h-4 px-1.5 font-bold", urgencyStyle.bg, urgencyStyle.text)}>
            {urgencyStyle.label}
          </Badge>
          {item.arrAtStake > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <DollarSign className="h-2.5 w-2.5" />
              {formatArr(item.arrAtStake)}
            </span>
          )}
          {item.daysUntilDeadline != null && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {item.daysUntilDeadline}d
            </span>
          )}
          {item.daysSinceLastTouch != null && (
            <span className={cn(
              "text-[10px] flex items-center gap-0.5",
              item.daysSinceLastTouch > 14 ? "text-status-red" :
              item.daysSinceLastTouch > 7 ? "text-status-yellow" : "text-muted-foreground"
            )}>
              <AlertTriangle className="h-2.5 w-2.5" />
              {item.daysSinceLastTouch}d ago
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function TimeAllocationBar() {
  const { timeAllocation } = useTimeAllocation();

  return (
    <div className="space-y-2">
      {timeAllocation.map(t => (
        <div key={t.label} className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground w-28 truncate">{t.label}</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                t.status === 'on-track' ? "bg-status-green" :
                t.status === 'over' ? "bg-status-yellow" : "bg-status-red"
              )}
              style={{ width: `${Math.min(100, t.actualPercent)}%` }}
            />
          </div>
          <span className={cn(
            "text-[10px] font-mono w-14 text-right",
            t.status === 'on-track' ? "text-status-green" :
            t.status === 'over' ? "text-status-yellow" : "text-status-red"
          )}>
            {t.actualPercent}% / {t.targetPercent}%
          </span>
        </div>
      ))}
    </div>
  );
}

export function SmartWorkQueue() {
  const { topWorkItems, totalArrAtRisk } = useTimeAllocation();
  const navigate = useNavigate();

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

  if (topWorkItems.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Crosshair className="h-4 w-4 text-primary" />
          <h3 className="font-display text-sm font-bold">Work Queue</h3>
        </div>
        <p className="text-xs text-muted-foreground">No high-priority items. You're on top of things! 🎯</p>
      </Card>
    );
  }

  const criticalCount = topWorkItems.filter(w => w.urgency === 'critical').length;

  return (
    <Card className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-primary" />
          <h3 className="font-display text-sm font-bold">Work Queue</h3>
          {criticalCount > 0 && (
            <Badge className="bg-status-red/15 text-status-red text-[10px] h-5">
              {criticalCount} critical
            </Badge>
          )}
        </div>
        {totalArrAtRisk > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Zap className="h-3 w-3 text-status-yellow" />
            <span className="font-mono font-semibold text-foreground">{formatCurrency(totalArrAtRisk)}</span>
            <span>at stake</span>
          </div>
        )}
      </div>

      {/* Time Allocation */}
      <div className="mb-4">
        <TimeAllocationBar />
      </div>

      {/* Work Items */}
      <div className="space-y-2">
        {topWorkItems.map((item, i) => (
          <WorkItemCard key={`${item.type}-${item.id}`} item={item} index={i} />
        ))}
      </div>
    </Card>
  );
}

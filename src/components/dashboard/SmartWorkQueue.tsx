// Smart Work Queue: Daily Action Plan with sectioned priorities and one-click task creation
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTimeAllocation, type WorkItem, type WorkItemType } from '@/hooks/useTimeAllocation';
import { useStore } from '@/store/useStore';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Crosshair, Clock, DollarSign, ArrowRight, Calendar, Building2, 
  TrendingUp, AlertTriangle, Zap, RefreshCw, Plus, Check, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCopilot } from '@/contexts/CopilotContext';
import { Sparkles } from 'lucide-react';
import { useLinkedRecordContext } from '@/contexts/LinkedRecordContext';
import { toast } from 'sonner';
import type { Workstream } from '@/types';
import { useDismissedItems } from '@/hooks/useWeeklyReview';

const URGENCY_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
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

function ActionItemCard({ item, onAddTask, taskAdded, onDismiss }: { 
  item: WorkItem; 
  onAddTask: (item: WorkItem) => void;
  taskAdded: boolean;
  onDismiss: (item: WorkItem) => void;
}) {
  const navigate = useNavigate();
  const { setCurrentRecord } = useLinkedRecordContext();
  const { ask } = useCopilot();
  const urgencyStyle = URGENCY_STYLES[item.urgency];
  const TypeIcon = TYPE_ICONS[item.type] || Building2;

  const formatArr = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;

  const handleClick = () => {
    setCurrentRecord({ 
      type: item.type as any, 
      id: item.id,
      accountId: item.accountId,
    });
    navigate(`${item.route}?highlight=${item.id}`);
  };

  return (
    <div className={cn(
      "flex items-start gap-2 p-2.5 rounded-lg border-l-[3px] border border-border/50 transition-all",
      "hover:bg-muted/30 hover:border-border",
      urgencyStyle.border,
    )}>
      {/* Main content - clickable */}
      <button onClick={handleClick} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2 mb-0.5">
          <TypeIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{item.name}</span>
          {item.hasMeetingToday && <Calendar className="h-3 w-3 text-primary shrink-0" />}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground truncate">{item.reason}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          <span className="text-foreground font-medium truncate">{item.action}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Badge className={cn("text-[9px] h-4 px-1.5 font-bold", urgencyStyle.bg, urgencyStyle.text)}>
            {urgencyStyle.label}
          </Badge>
          {item.arrAtStake > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <DollarSign className="h-2.5 w-2.5" />{formatArr(item.arrAtStake)}
            </span>
          )}
          {item.daysUntilDeadline != null && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />{item.daysUntilDeadline}d
            </span>
          )}
          {item.daysSinceLastTouch != null && (
            <span className={cn(
              "text-[10px] flex items-center gap-0.5",
              item.daysSinceLastTouch > 14 ? "text-status-red" :
              item.daysSinceLastTouch > 7 ? "text-status-yellow" : "text-muted-foreground"
            )}>
              <AlertTriangle className="h-2.5 w-2.5" />{item.daysSinceLastTouch}d ago
            </span>
          )}
        </div>
      </button>

      {/* Action buttons */}
      <div className="flex flex-col gap-1 shrink-0">
        <Button
          size="icon"
          variant={taskAdded ? "default" : "outline"}
          className={cn("h-7 w-7", taskAdded && "bg-status-green hover:bg-status-green")}
          onClick={(e) => { e.stopPropagation(); if (!taskAdded) onAddTask(item); }}
          title="Add as task"
        >
          {taskAdded ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            ask(`Tell me everything about ${item.name}. Signals, risk, and what to do next?`, 'deep', item.id);
          }}
          className="h-7 w-7 flex items-center justify-center text-primary/60 hover:text-primary transition-colors rounded-md hover:bg-muted"
          title="Ask AI"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, items, color, addedTasks, onAddTask, maxItems = 5 }: {
  title: string;
  icon: typeof Building2;
  items: WorkItem[];
  color: string;
  addedTasks: Set<string>;
  onAddTask: (item: WorkItem) => void;
  maxItems?: number;
}) {
  if (items.length === 0) return null;
  
  const displayed = items.slice(0, maxItems);
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-3.5 w-3.5", color)} />
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h4>
          <Badge variant="outline" className="text-[10px] h-4">{items.length}</Badge>
        </div>
      </div>
      <div className="space-y-1.5">
        {displayed.map(item => (
          <ActionItemCard 
            key={`${item.type}-${item.id}`} 
            item={item} 
            onAddTask={onAddTask}
            taskAdded={addedTasks.has(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function SmartWorkQueue() {
  const { workQueue, totalArrAtRisk } = useTimeAllocation();
  const { addTask, tasks } = useStore();
  const [addedTasks, setAddedTasks] = useState<Set<string>>(new Set());

  // Filter out items that already have linked tasks
  const existingTaskRecordIds = useMemo(() => {
    const ids = new Set<string>();
    tasks.forEach(t => {
      if (t.linkedRecordId) ids.add(t.linkedRecordId);
      if (t.linkedAccountId) ids.add(t.linkedAccountId);
      if (t.linkedOpportunityId) ids.add(t.linkedOpportunityId);
    });
    return ids;
  }, [tasks]);

  const filteredQueue = useMemo(() => 
    workQueue.filter(item => !existingTaskRecordIds.has(item.id) && !addedTasks.has(item.id)),
    [workQueue, existingTaskRecordIds, addedTasks]
  );

  const handleAddTask = (item: WorkItem) => {
    const workstream: Workstream = item.type === 'renewal' || item.isRenewalOpp ? 'renewals' : 'pg';
    
    addTask({
      title: `${item.action}: ${item.name}`,
      workstream,
      status: 'next',
      priority: item.urgency === 'critical' ? 'P0' : item.urgency === 'high' ? 'P1' : 'P2',
      dueDate: new Date().toISOString().split('T')[0],
      linkedAccountId: item.accountId || (item.type === 'account' ? item.id : undefined),
      linkedOpportunityId: item.type === 'opportunity' ? item.id : undefined,
      notes: item.reason,
      motion: workstream === 'renewals' ? 'renewal' : 'new-logo',
      linkedRecordType: item.type as any,
      linkedRecordId: item.id,
    } as any);

    setAddedTasks(prev => new Set(prev).add(item.id));
    toast.success('Task added', { description: `${item.action}: ${item.name}` });
  };

  // Categorize items
  const accountItems = filteredQueue.filter(w => w.type === 'account');
  const pipelineItems = filteredQueue.filter(w => w.type === 'opportunity' && !w.isRenewalOpp);
  const renewalItems = filteredQueue.filter(w => w.type === 'renewal' || (w.type === 'opportunity' && w.isRenewalOpp));

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

  const totalFilteredArr = filteredQueue
    .filter(w => w.urgency === 'critical' || w.urgency === 'high')
    .reduce((sum, w) => sum + w.arrAtStake, 0);

  if (filteredQueue.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Crosshair className="h-4 w-4 text-primary" />
          <h3 className="font-display text-sm font-bold">Daily Action Plan</h3>
        </div>
        <p className="text-xs text-muted-foreground">No high-priority items. You're on top of things! 🎯</p>
      </Card>
    );
  }

  const criticalCount = filteredQueue.filter(w => w.urgency === 'critical').length;

  return (
    <Card className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-primary" />
          <h3 className="font-display text-sm font-bold">Daily Action Plan</h3>
          {criticalCount > 0 && (
            <Badge className="bg-status-red/15 text-status-red text-[10px] h-5">
              {criticalCount} critical
            </Badge>
          )}
        </div>
        {totalFilteredArr > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Zap className="h-3 w-3 text-status-yellow" />
            <span className="font-mono font-semibold text-foreground">{formatCurrency(totalFilteredArr)}</span>
            <span>at stake</span>
          </div>
        )}
      </div>

      {/* Three sections */}
      <div className="space-y-4">
        <Section
          title="Target Accounts"
          icon={Building2}
          items={accountItems}
          color="text-primary"
          addedTasks={addedTasks}
          onAddTask={handleAddTask}
          maxItems={5}
        />
        <Section
          title="Pipeline Advancement"
          icon={TrendingUp}
          items={pipelineItems}
          color="text-status-yellow"
          addedTasks={addedTasks}
          onAddTask={handleAddTask}
          maxItems={5}
        />
        <Section
          title="Renewal Management"
          icon={RefreshCw}
          items={renewalItems}
          color="text-status-green"
          addedTasks={addedTasks}
          onAddTask={handleAddTask}
          maxItems={5}
        />
      </div>
    </Card>
  );
}

import { useState, useMemo, useRef } from 'react';
import { Calendar, Building2, Target, AlertCircle, Repeat, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import type { Task, Priority, TaskStatus } from '@/types';
import { STATUS_META, STATUS_CYCLE, PRIORITY_COLORS, WORKSTREAM_LABELS, DRIVER_TAG_META } from './constants';
import { getWorkstream, inferDriverTag, getAccountName, getOpportunityName } from './helpers';
import { TaskEditDialog } from './TaskEditDialog';

interface TaskRowProps {
  task: Task;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}

export function TaskRow({ task, selected, onToggleSelect }: TaskRowProps) {
  const { updateTask, deleteTask, accounts, opportunities, recurringTemplates } = useStore();
  const [editOpen, setEditOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);
  const rowRef = useRef<HTMLDivElement>(null);

  const workstream = getWorkstream(task);
  const accountName = getAccountName(task, accounts, opportunities);
  const oppName = getOpportunityName(task, opportunities);
  const inferredTag = useMemo(() => inferDriverTag(task), [task.title, task.notes]);
  const isRecurring = recurringTemplates.some(t => t.activeInstanceId === task.id);
  const effectiveStatus: TaskStatus = (task.status as string) === 'open' ? 'next' : task.status;
  const statusMeta = STATUS_META[effectiveStatus] || STATUS_META['next'];
  const today = new Date().toISOString().split('T')[0];
  const isOverdue = task.dueDate && task.dueDate < today && effectiveStatus !== 'done' && effectiveStatus !== 'dropped';
  const isTerminal = effectiveStatus === 'done' || effectiveStatus === 'dropped';

  const cycleStatus = () => {
    const idx = STATUS_CYCLE.indexOf(effectiveStatus);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    const updates: Partial<Task> = { status: next };
    if (next === 'done') updates.completedAt = new Date().toISOString();
    if (next !== 'done') updates.completedAt = undefined;
    updateTask(task.id, updates);
    toast.success(`→ ${STATUS_META[next].label}`, { duration: 1200 });
  };

  const cyclePriority = () => {
    const priorities: Priority[] = ['P0', 'P1', 'P2'];
    const idx = priorities.indexOf(task.priority);
    const next = priorities[(idx + 1) % priorities.length];
    updateTask(task.id, { priority: next });
    toast.success(`→ ${next}`, { duration: 1200 });
  };

  // Swipe handling for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
    if (rowRef.current) {
      const clamped = Math.max(-80, Math.min(80, touchDeltaX.current));
      rowRef.current.style.transform = `translateX(${clamped}px)`;
      rowRef.current.style.transition = 'none';
    }
  };
  const handleTouchEnd = () => {
    if (rowRef.current) {
      rowRef.current.style.transform = '';
      rowRef.current.style.transition = 'transform 0.2s ease';
    }
    if (touchDeltaX.current > 60 && effectiveStatus !== 'done') {
      const updates: Partial<Task> = { status: 'done', completedAt: new Date().toISOString() };
      updateTask(task.id, updates);
      toast.success('✓ Done', { duration: 1500 });
    } else if (touchDeltaX.current < -60 && task.dueDate) {
      // Snooze: push due date by 1 day
      const d = new Date(task.dueDate);
      d.setDate(d.getDate() + 1);
      updateTask(task.id, { dueDate: d.toISOString().split('T')[0] });
      toast('Snoozed +1 day', { duration: 1500 });
    }
    touchStartX.current = null;
    touchDeltaX.current = 0;
  };

  const formattedDate = task.dueDate ? (() => {
    if (task.dueDate === today) return 'Today';
    const d = new Date(task.dueDate + 'T12:00:00');
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    if (task.dueDate === tomorrow.toISOString().split('T')[0]) return 'Tmrw';
    return `${d.getMonth() + 1}/${d.getDate()}`;
  })() : null;

  return (
    <>
      <div
        ref={rowRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          "group/row flex items-center gap-2 px-2 py-1.5 rounded-md transition-all border border-transparent",
          isTerminal ? "opacity-50" : "hover:bg-muted/40 hover:border-border/50",
          selected && "bg-primary/5 border-primary/20",
          isOverdue && !isTerminal && "bg-destructive/5"
        )}
      >
        {/* Checkbox for bulk */}
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(task.id)}
          className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover/row:opacity-100 data-[state=checked]:opacity-100 transition-opacity"
        />

        {/* Status pill - click to cycle */}
        <button
          onClick={cycleStatus}
          className={cn(
            "shrink-0 h-6 px-2 rounded text-[10px] font-semibold border transition-colors",
            statusMeta.color
          )}
          title={`Click to cycle status (${STATUS_CYCLE.map(s => STATUS_META[s].shortLabel).join(' → ')})`}
        >
          {statusMeta.shortLabel}
        </button>

        {/* Priority pill - click to cycle */}
        <button
          onClick={cyclePriority}
          className={cn("shrink-0 h-5 w-7 rounded text-[10px] font-bold", PRIORITY_COLORS[task.priority])}
        >
          {task.priority}
        </button>

        {/* Title + account - main click area */}
        <button
          className={cn(
            "flex-1 min-w-0 text-left flex items-center gap-1.5",
            isTerminal && "line-through text-muted-foreground"
          )}
          onClick={() => { setEditOpen(true); }}
        >
          {isRecurring && <Repeat className="h-3 w-3 text-primary shrink-0" />}
          <span className="text-sm font-medium truncate">{task.title}</span>
          {accountName && (
            <span className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0 max-w-[120px] truncate">
              <Building2 className="h-2.5 w-2.5" />
              {accountName}
            </span>
          )}
        </button>

        {/* Workstream badge */}
        <span className="hidden sm:inline text-[9px] font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded shrink-0">
          {WORKSTREAM_LABELS[workstream]}
        </span>

        {/* Due date */}
        {formattedDate && (
          <span className={cn(
            "text-[11px] shrink-0 flex items-center gap-0.5",
            isOverdue ? "text-destructive font-semibold" : "text-muted-foreground"
          )}>
            {isOverdue && <AlertCircle className="h-3 w-3" />}
            {formattedDate}
          </span>
        )}

        {/* Expand toggle for details (driver tag + notes) */}
        {(inferredTag || task.notes) && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="shrink-0 h-5 w-5 flex items-center justify-center text-muted-foreground opacity-0 group-hover/row:opacity-100 transition-opacity"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
          </button>
        )}

        {/* Delete */}
        <button
          onClick={() => { deleteTask(task.id); toast.success('Deleted', { duration: 1500 }); }}
          className="shrink-0 h-5 w-5 flex items-center justify-center text-muted-foreground opacity-0 group-hover/row:opacity-100 transition-opacity hover:text-destructive text-xs"
        >
          ×
        </button>
      </div>

      {/* Expanded detail row */}
      {expanded && (
        <div className="ml-[72px] mr-2 pb-1.5 flex items-center gap-2 flex-wrap text-[10px]">
          {inferredTag && (
            <span className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border font-medium",
              DRIVER_TAG_META[inferredTag].color
            )}>
              {DRIVER_TAG_META[inferredTag].label}
            </span>
          )}
          {oppName && (
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <Target className="h-2.5 w-2.5" /> {oppName}
            </span>
          )}
          {accountName && (
            <span className="sm:hidden flex items-center gap-0.5 text-muted-foreground">
              <Building2 className="h-2.5 w-2.5" /> {accountName}
            </span>
          )}
          {task.notes && (
            <span className="text-muted-foreground italic truncate max-w-[300px]">
              {task.notes}
            </span>
          )}
        </div>
      )}

      <TaskEditDialog task={task} open={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}

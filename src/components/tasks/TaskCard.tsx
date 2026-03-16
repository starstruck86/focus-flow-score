import { useState, useMemo, useRef, useCallback } from 'react';
import { Calendar, Building2, Target, AlertCircle, Repeat, ChevronDown, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import type { Task, Priority, TaskStatus } from '@/types';
import { STATUS_META, STATUS_CYCLE, PRIORITY_COLORS, WORKSTREAM_LABELS, DRIVER_TAG_META } from './constants';
import { getWorkstream, inferDriverTag, getAccountName, getOpportunityName } from './helpers';
import { TaskEditDialog } from './TaskEditDialog';

interface TaskCardProps {
  task: Task;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}

export function TaskCard({ task, selected, onToggleSelect }: TaskCardProps) {
  const { updateTask, deleteTask, accounts, opportunities, recurringTemplates } = useStore();
  const [editOpen, setEditOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const titleInputRef = useRef<HTMLInputElement>(null);
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

  // Due date display
  const dueInfo = useMemo(() => {
    if (!task.dueDate) return null;
    const diff = Math.ceil((new Date(task.dueDate + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000);
    if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, color: 'text-destructive bg-destructive/10' };
    if (diff === 0) return { label: 'Today', color: 'text-status-yellow bg-status-yellow/10' };
    if (diff === 1) return { label: 'Tomorrow', color: 'text-muted-foreground bg-muted/60' };
    if (diff <= 7) return { label: `${diff}d`, color: 'text-muted-foreground bg-muted/60' };
    const d = new Date(task.dueDate + 'T12:00:00');
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, color: 'text-muted-foreground bg-muted/40' };
  }, [task.dueDate, today]);

  // Subtask progress
  const subtaskProgress = useMemo(() => {
    if (!task.subtasks || !Array.isArray(task.subtasks) || task.subtasks.length === 0) return null;
    const total = task.subtasks.length;
    const done = task.subtasks.filter((s: any) => s.done || s.completed).length;
    return { total, done, pct: Math.round((done / total) * 100) };
  }, [task.subtasks]);

  // Opp stage
  const oppStage = useMemo(() => {
    const oppId = task.linkedOpportunityId || (task.linkedRecordType === 'opportunity' ? task.linkedRecordId : undefined);
    if (!oppId) return null;
    const opp = opportunities.find(o => o.id === oppId);
    return opp?.stage || null;
  }, [task, opportunities]);

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

  // Inline title edit
  const startTitleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTitle(true);
    setTitleDraft(task.title);
    setTimeout(() => titleInputRef.current?.select(), 50);
  }, [task.title]);

  const saveTitleEdit = useCallback(() => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== task.title) {
      updateTask(task.id, { title: trimmed });
      toast.success('Title updated', { duration: 1000 });
    }
    setEditingTitle(false);
  }, [titleDraft, task.title, task.id, updateTask]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveTitleEdit();
    if (e.key === 'Escape') { setEditingTitle(false); setTitleDraft(task.title); }
  }, [saveTitleEdit, task.title]);

  // Swipe handling
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
    if (rowRef.current) {
      const clamped = Math.max(-100, Math.min(100, touchDeltaX.current));
      rowRef.current.style.transform = `translateX(${clamped}px)`;
      rowRef.current.style.transition = 'none';
      // Show swipe indicators
      if (clamped > 40) rowRef.current.style.background = 'hsl(var(--status-green) / 0.15)';
      else if (clamped < -40) rowRef.current.style.background = 'hsl(var(--status-yellow) / 0.15)';
      else rowRef.current.style.background = '';
    }
  };
  const handleTouchEnd = () => {
    if (rowRef.current) {
      rowRef.current.style.transform = '';
      rowRef.current.style.transition = 'transform 0.2s ease';
      rowRef.current.style.background = '';
    }
    if (touchDeltaX.current > 60 && effectiveStatus !== 'done') {
      updateTask(task.id, { status: 'done', completedAt: new Date().toISOString() });
      toast.success('✓ Done!', { duration: 1500 });
    } else if (touchDeltaX.current < -60 && task.dueDate) {
      const d = new Date(task.dueDate);
      d.setDate(d.getDate() + 1);
      updateTask(task.id, { dueDate: d.toISOString().split('T')[0] });
      toast('Snoozed +1 day', { duration: 1500 });
    }
    touchStartX.current = null;
    touchDeltaX.current = 0;
  };

  return (
    <>
      <div
        ref={rowRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          "group/card relative rounded-lg border transition-all",
          isTerminal
            ? "opacity-40 border-border/30 bg-card/30"
            : "border-border/50 bg-card/60 hover:bg-card hover:border-border hover:shadow-sm",
          selected && "ring-1 ring-primary/40 bg-primary/5",
          isOverdue && !isTerminal && "border-destructive/30 bg-destructive/5"
        )}
      >
        {/* Swipe hints - visible on mobile during swipe */}
        <div className="absolute inset-y-0 left-0 w-16 flex items-center justify-center text-status-green opacity-0 pointer-events-none">
          ✓
        </div>
        <div className="absolute inset-y-0 right-0 w-16 flex items-center justify-center text-status-yellow opacity-0 pointer-events-none">
          →
        </div>

        <div className="flex items-start gap-2.5 p-3">
          {/* Left: checkbox + status */}
          <div className="flex flex-col items-center gap-1 pt-0.5">
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect(task.id)}
              className="h-4 w-4 shrink-0"
            />
          </div>

          {/* Center: main content */}
          <div className="flex-1 min-w-0 space-y-1">
            {/* Top row: title */}
            <div className="flex items-center gap-1.5">
              <button onClick={cycleStatus} className={cn("shrink-0 h-6 px-2 rounded text-[10px] font-bold border transition-colors", statusMeta.color)}>
                {statusMeta.shortLabel}
              </button>
              <button onClick={cyclePriority} className={cn("shrink-0 h-6 w-7 rounded text-[10px] font-bold", PRIORITY_COLORS[task.priority])}>
                {task.priority}
              </button>
              {isRecurring && <Repeat className="h-3 w-3 text-primary shrink-0" />}

              {editingTitle ? (
                <Input
                  ref={titleInputRef}
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={saveTitleEdit}
                  onKeyDown={handleTitleKeyDown}
                  className="h-6 text-sm font-medium flex-1 min-w-0 px-1 py-0"
                  autoFocus
                />
              ) : (
                <span
                  onClick={startTitleEdit}
                  className={cn(
                    "text-[13px] font-semibold leading-snug flex-1 min-w-0 cursor-text hover:text-primary transition-colors",
                    isTerminal && "line-through text-muted-foreground"
                  )}
                  title="Click to edit title"
                >
                  {task.title}
                </span>
              )}
            </div>

            {/* Meta row: account, opp stage, due date, workstream */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {accountName && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md">
                  <Building2 className="h-2.5 w-2.5" />
                  <span className="truncate max-w-[100px]">{accountName}</span>
                </span>
              )}
              {oppStage && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-purple-500 bg-purple-500/10 px-1.5 py-0.5 rounded-md border border-purple-500/20">
                  <Target className="h-2.5 w-2.5" />
                  {oppStage}
                </span>
              )}
              {dueInfo && (
                <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md", dueInfo.color)}>
                  {isOverdue && <AlertCircle className="h-2.5 w-2.5" />}
                  <Calendar className="h-2.5 w-2.5" />
                  {dueInfo.label}
                </span>
              )}
              <span className="text-[9px] font-medium text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                {WORKSTREAM_LABELS[workstream]}
              </span>
              {inferredTag && (
                <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full border font-medium", DRIVER_TAG_META[inferredTag].color)}>
                  {DRIVER_TAG_META[inferredTag].label}
                </span>
              )}
              {task.estimatedMinutes && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
                  <Clock className="h-2.5 w-2.5" />
                  {task.estimatedMinutes}m
                </span>
              )}
            </div>

            {/* Subtask progress bar */}
            {subtaskProgress && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${subtaskProgress.pct}%` }}
                  />
                </div>
                <span className="text-[9px] text-muted-foreground">{subtaskProgress.done}/{subtaskProgress.total}</span>
              </div>
            )}

            {/* Notes preview */}
            {task.notes && !expanded && (
              <p className="text-[10px] text-muted-foreground/60 italic truncate">
                {task.notes}
              </p>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <button
              onClick={() => setEditOpen(true)}
              className="h-6 w-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors rounded hover:bg-muted/50 text-[10px]"
              title="Open full editor"
            >
              ⋮
            </button>
            <button
              onClick={() => { deleteTask(task.id); toast.success('Deleted', { duration: 1500 }); }}
              className="h-5 w-5 flex items-center justify-center text-muted-foreground/30 opacity-0 group-hover/card:opacity-100 transition-all hover:text-destructive text-xs"
            >
              ×
            </button>
          </div>
        </div>
      </div>

      <TaskEditDialog task={task} open={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}

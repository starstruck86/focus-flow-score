import { useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import type { Task, TaskStatus } from '@/types';
import { STATUS_ORDER, STATUS_META } from './constants';
import { TaskCard } from './TaskCard';

interface TaskKanbanBoardProps {
  tasks: Task[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}

const COLUMN_STATUSES: TaskStatus[] = STATUS_ORDER;

export function TaskKanbanBoard({ tasks, selectedIds, onToggleSelect }: TaskKanbanBoardProps) {
  const { updateTask } = useStore();
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const dragCounter = useRef<Record<string, number>>({});

  const columns = COLUMN_STATUSES.reduce<Record<TaskStatus, Task[]>>((acc, status) => {
    acc[status] = tasks.filter(t => {
      const effective = (t.status as string) === 'open' ? 'next' : t.status;
      return effective === status;
    });
    return acc;
  }, {} as Record<TaskStatus, Task[]>);

  const handleDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    // Make drag image slightly transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.4';
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedTaskId(null);
    setDragOverColumn(null);
    dragCounter.current = {};
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    dragCounter.current[status] = (dragCounter.current[status] || 0) + 1;
    setDragOverColumn(status);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent, status: TaskStatus) => {
    dragCounter.current[status] = (dragCounter.current[status] || 0) - 1;
    if (dragCounter.current[status] <= 0) {
      dragCounter.current[status] = 0;
      if (dragOverColumn === status) setDragOverColumn(null);
    }
  }, [dragOverColumn]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault();
    setDragOverColumn(null);
    dragCounter.current = {};
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const currentStatus = (task.status as string) === 'open' ? 'next' : task.status;
    if (currentStatus === targetStatus) return;

    const updates: Partial<Task> = { status: targetStatus };
    if (targetStatus === 'done') updates.completedAt = new Date().toISOString();
    if (targetStatus !== 'done') updates.completedAt = undefined;

    updateTask(taskId, updates);
    toast.success(`Moved to ${STATUS_META[targetStatus].label}`, { duration: 1200 });
  }, [tasks, updateTask]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2 snap-x snap-mandatory min-h-[400px]">
      {COLUMN_STATUSES.map(status => {
        const meta = STATUS_META[status];
        const colTasks = columns[status];
        const isOver = dragOverColumn === status;

        return (
          <div
            key={status}
            className={cn(
              "flex-shrink-0 w-[280px] sm:w-[300px] lg:flex-1 lg:min-w-[240px] snap-start",
              "flex flex-col rounded-xl border bg-card/40 backdrop-blur-sm transition-all",
              isOver && "border-primary/50 bg-primary/5 shadow-lg shadow-primary/10"
            )}
            onDragEnter={(e) => handleDragEnter(e, status)}
            onDragLeave={(e) => handleDragLeave(e, status)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, status)}
          >
            {/* Column Header */}
            <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-border/40">
              <span className={cn("h-3 w-3 rounded-full ring-2 ring-offset-1 ring-offset-background", meta.dot, `ring-${meta.dot.replace('bg-', '')}/30`)} />
              <span className="text-sm font-bold tracking-tight">{meta.label}</span>
              <span className="ml-auto text-[11px] text-muted-foreground font-semibold bg-muted/80 h-6 min-w-6 px-2 rounded-full flex items-center justify-center">
                {colTasks.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 min-h-[140px] max-h-[calc(100vh-300px)]">
              {colTasks.length === 0 ? (
                <div className={cn(
                  "flex items-center justify-center h-20 rounded-lg border-2 border-dashed transition-colors text-[11px] text-muted-foreground/50",
                  isOver ? "border-primary/40 text-primary/60" : "border-border/30"
                )}>
                  {isOver ? 'Drop here' : 'No tasks'}
                </div>
              ) : (
                colTasks.map(task => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      "cursor-grab active:cursor-grabbing",
                      draggedTaskId === task.id && "opacity-40"
                    )}
                  >
                    <TaskCard
                      task={task}
                      selected={selectedIds.has(task.id)}
                      onToggleSelect={onToggleSelect}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

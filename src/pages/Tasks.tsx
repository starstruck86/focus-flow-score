import { useState, useMemo, useEffect, useCallback } from 'react';
import { Plus, ChevronDown, ChevronRight, Repeat, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus, Workstream } from '@/types';
import {
  MomentumHeader, TaskCard, AddTaskDialog, FilterBar, OverdueSection, TaskBulkBar, DayTimeline,
  TaskKanbanBoard,
  STATUS_ORDER, STATUS_META, getWorkstream, sortTasks, getAccountName,
  type GroupMode,
} from '@/components/tasks';

export default function Tasks() {
  const { tasks, accounts, opportunities, recurringTemplates, generateDueRecurringInstances } = useStore();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({ done: true, dropped: true });
  const [filterWorkstream, setFilterWorkstream] = useState<'all' | Workstream>('all');
  const [filterDue, setFilterDue] = useState<'all' | 'today' | 'week'>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('status');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => { generateDueRecurringInstances(); }, [generateDueRecurringInstances]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setShowAddDialog(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const today = new Date().toISOString().split('T')[0];
  const weekEnd = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  }, []);

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      if (filterWorkstream !== 'all' && getWorkstream(task) !== filterWorkstream) return false;
      if (filterDue === 'today' && task.dueDate !== today) return false;
      if (filterDue === 'week' && (!task.dueDate || task.dueDate > weekEnd)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!task.title.toLowerCase().includes(q) && !(task.notes || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tasks, filterWorkstream, filterDue, searchQuery, today, weekEnd]);

  const overdueTasks = useMemo(() =>
    sortTasks(filteredTasks.filter(t =>
      t.dueDate && t.dueDate < today && t.status !== 'done' && t.status !== 'dropped'
    )),
    [filteredTasks, today]
  );
  const overdueIds = useMemo(() => new Set(overdueTasks.map(t => t.id)), [overdueTasks]);

  const groupedByStatus = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = { 'next': [], 'in-progress': [], 'blocked': [], 'done': [], 'dropped': [] };
    filteredTasks.forEach(task => {
      if (overdueIds.has(task.id)) return;
      const status = (task.status as string) === 'open' ? 'next' : task.status as TaskStatus;
      (groups[status] || groups['next']).push(task);
    });
    Object.keys(groups).forEach(k => { groups[k as TaskStatus] = sortTasks(groups[k as TaskStatus]); });
    return groups;
  }, [filteredTasks, overdueIds]);

  const groupedByAccount = useMemo(() => {
    const groups: Record<string, Task[]> = {};
    filteredTasks.forEach(task => {
      if (overdueIds.has(task.id)) return;
      if (task.status === 'done' || task.status === 'dropped') return;
      const name = getAccountName(task, accounts, opportunities) || 'Unlinked';
      if (!groups[name]) groups[name] = [];
      groups[name].push(task);
    });
    Object.keys(groups).forEach(k => { groups[k] = sortTasks(groups[k]); });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filteredTasks, overdueIds, accounts, opportunities]);

  const toggleGroup = (key: string) => setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const activeCount = filteredTasks.filter(t => t.status !== 'done' && t.status !== 'dropped').length;

  return (
    <Layout>
      <div className="p-4 lg:p-6 max-w-4xl mx-auto">
        {/* Day Progress Timeline */}
        <DayTimeline />

        <MomentumHeader workstreamFilter={filterWorkstream} />

        {/* Title row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-bold">Tasks</h1>
            <span className="text-xs text-muted-foreground">{activeCount} active</span>
            {overdueTasks.length > 0 && (
              <Badge variant="destructive" className="text-[10px] h-5 px-1.5">{overdueTasks.length} overdue</Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Link to="/recurring">
              <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]">
                <Repeat className="h-3 w-3" /> Recurring
                {recurringTemplates.length > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[9px] ml-0.5">{recurringTemplates.length}</Badge>
                )}
              </Button>
            </Link>
            <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-3 w-3" /> Add
            </Button>
          </div>
        </div>

        <FilterBar
          filterWorkstream={filterWorkstream} setFilterWorkstream={setFilterWorkstream}
          filterDue={filterDue} setFilterDue={setFilterDue}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          groupMode={groupMode} setGroupMode={setGroupMode}
        />

        {/* Pinned overdue section */}
        <OverdueSection tasks={overdueTasks} selectedIds={selectedIds} onToggleSelect={toggleSelect} />

        {/* Kanban Board - excludes done/dropped/overdue */}
        <TaskKanbanBoard
          tasks={filteredTasks.filter(t => !overdueIds.has(t.id) && t.status !== 'done' && t.status !== 'dropped')}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />

        {/* Completed tasks - expandable */}
        {(() => {
          const doneTasks = filteredTasks.filter(t => t.status === 'done' || t.status === 'dropped');
          if (doneTasks.length === 0) return null;
          const showDone = !collapsedGroups['done-section'];
          return (
            <div className="mt-4 rounded-xl border border-border/40 bg-card/30">
              <button
                className="flex items-center gap-2 w-full text-left px-4 py-3"
                onClick={() => setCollapsedGroups(prev => ({ ...prev, 'done-section': !prev['done-section'] }))}
              >
                {showDone ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <CheckCircle2 className="h-4 w-4 text-status-green" />
                <span className="text-sm font-semibold">Completed</span>
                <span className="text-[11px] text-muted-foreground">({doneTasks.length})</span>
              </button>
              {showDone && (
                <div className="px-4 pb-3 space-y-2">
                  {doneTasks.map(task => (
                    <TaskCard key={task.id} task={task} selected={selectedIds.has(task.id)} onToggleSelect={toggleSelect} />
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {filteredTasks.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm">
              {tasks.length === 0 ? "No tasks yet. Press N to add your first task!" : "No tasks match your filters."}
            </p>
          </div>
        )}

        <TaskBulkBar selectedIds={selectedIds} onClear={() => setSelectedIds(new Set())} />
      </div>

      <AddTaskDialog open={showAddDialog} onOpenChange={setShowAddDialog} defaultWorkstream={filterWorkstream === 'all' ? 'pg' : filterWorkstream} />
    </Layout>
  );
}

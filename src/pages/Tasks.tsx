import { useState, useMemo, useEffect, useCallback } from 'react';
import { Plus, ChevronDown, ChevronRight, Repeat, AlertCircle } from 'lucide-react';
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
  const [filterWorkstream, setFilterWorkstream] = useState<'all' | Workstream>('pg');
  const [filterDue, setFilterDue] = useState<'all' | 'today' | 'week'>('all');
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

        {/* Task list */}
        {groupMode === 'status' ? (
          <div className="space-y-4">
            {STATUS_ORDER.map(status => {
              const groupTasks = groupedByStatus[status];
              const isCollapsed = collapsedGroups[status];
              const meta = STATUS_META[status];
              return (
                <div key={status}>
                  <button
                    className="flex items-center gap-1.5 w-full text-left py-1.5 mb-1"
                    onClick={() => toggleGroup(status)}
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className={cn("h-2.5 w-2.5 rounded-full", meta.dot)} />
                    <span className="text-xs font-semibold">{meta.label}</span>
                    <span className="text-[10px] text-muted-foreground">({groupTasks.length})</span>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-1.5 ml-5">
                      {groupTasks.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic py-2 pl-2">No tasks</p>
                      ) : (
                        groupTasks.map(task => (
                          <TaskCard key={task.id} task={task} selected={selectedIds.has(task.id)} onToggleSelect={toggleSelect} />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            {groupedByAccount.map(([accountName, accountTasks]) => {
              const isCollapsed = collapsedGroups[`acct-${accountName}`];
              return (
                <div key={accountName}>
                  <button
                    className="flex items-center gap-1.5 w-full text-left py-1.5 mb-1"
                    onClick={() => toggleGroup(`acct-${accountName}`)}
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="text-xs font-semibold">{accountName}</span>
                    <span className="text-[10px] text-muted-foreground">({accountTasks.length})</span>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-1.5 ml-5">
                      {accountTasks.map(task => (
                        <TaskCard key={task.id} task={task} selected={selectedIds.has(task.id)} onToggleSelect={toggleSelect} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {groupedByAccount.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">No active tasks to group</p>
            )}
          </div>
        )}

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

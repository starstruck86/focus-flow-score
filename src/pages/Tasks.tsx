import { useState, useMemo } from 'react';
import { 
  Plus, 
  ChevronDown,
  ChevronRight,
  Calendar,
  Building2,
  Target,
  AlertCircle,
  Search,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Task, Priority, TaskStatus, Workstream } from '@/types';

// ── Constants ──────────────────────────────────────────────

const STATUS_ORDER: TaskStatus[] = ['next', 'in-progress', 'blocked', 'done', 'dropped'];

const STATUS_META: Record<TaskStatus, { label: string; color: string; dot: string }> = {
  'next':        { label: 'Next',        color: 'bg-primary/10 text-primary border-primary/20',        dot: 'bg-primary' },
  'in-progress': { label: 'In Progress', color: 'bg-status-blue/10 text-status-blue border-status-blue/20', dot: 'bg-status-blue' },
  'blocked':     { label: 'Blocked',     color: 'bg-status-red/10 text-status-red border-status-red/20',     dot: 'bg-status-red' },
  'done':        { label: 'Done',        color: 'bg-status-green/10 text-status-green border-status-green/20', dot: 'bg-status-green' },
  'dropped':     { label: 'Dropped',     color: 'bg-muted text-muted-foreground border-border',               dot: 'bg-muted-foreground' },
};

const PRIORITY_COLORS: Record<Priority, string> = {
  P0: 'bg-status-red text-white',
  P1: 'bg-status-red/70 text-white',
  P2: 'bg-status-yellow text-black',
  P3: 'bg-muted text-muted-foreground',
};

const WORKSTREAM_LABELS: Record<Workstream, string> = {
  pg: 'PG',
  renewals: 'Renewals',
};

// ── Helper: derive workstream from legacy data ─────────────
function getWorkstream(task: Task): Workstream {
  if (task.workstream) return task.workstream;
  // Legacy: derive from motion
  if (task.motion === 'renewal') return 'renewals';
  return 'pg';
}

// ── Helper: get account name for display ───────────────────
function useAccountName(task: Task) {
  const { accounts, opportunities } = useStore();
  
  // New model
  if (task.linkedAccountId) {
    const account = accounts.find(a => a.id === task.linkedAccountId);
    return account?.name;
  }
  // Legacy: linkedRecordType pattern
  if (task.linkedRecordType === 'opportunity' && task.linkedRecordId) {
    const opp = opportunities.find(o => o.id === task.linkedRecordId);
    if (opp?.accountId) {
      const account = accounts.find(a => a.id === opp.accountId);
      return account?.name || opp.accountName;
    }
    return opp?.accountName;
  }
  if (task.linkedRecordType === 'account' && task.linkedRecordId) {
    const account = accounts.find(a => a.id === task.linkedRecordId);
    return account?.name;
  }
  return undefined;
}

function useOpportunityName(task: Task) {
  const { opportunities } = useStore();
  const oppId = task.linkedOpportunityId || (task.linkedRecordType === 'opportunity' ? task.linkedRecordId : undefined);
  if (!oppId) return undefined;
  return opportunities.find(o => o.id === oppId)?.name;
}

// ── Sort helper ────────────────────────────────────────────
function sortTasks(tasks: Task[]): Task[] {
  const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return [...tasks].sort((a, b) => {
    // Priority
    const pa = priorityOrder[a.priority] ?? 3;
    const pb = priorityOrder[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    // Due date (no date at bottom)
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    // Last updated desc
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

// ── Task Row Component ─────────────────────────────────────

function TaskRow({ task }: { task: Task }) {
  const { updateTask, deleteTask, accounts, opportunities } = useStore();
  const accountName = useAccountName(task);
  const oppName = useOpportunityName(task);
  const [editOpen, setEditOpen] = useState(false);
  const [editState, setEditState] = useState<Task>(task);
  const workstream = getWorkstream(task);
  const today = new Date().toISOString().split('T')[0];
  // Normalize legacy 'open' status to 'next'
  const effectiveStatus: TaskStatus = (task.status as string) === 'open' ? 'next' : task.status;
  const statusMeta = STATUS_META[effectiveStatus] || STATUS_META['next'];
  const isOverdue = task.dueDate && task.dueDate < today && effectiveStatus !== 'done' && effectiveStatus !== 'dropped';
  const isTerminal = effectiveStatus === 'done' || effectiveStatus === 'dropped';

  // Inline status change
  const handleStatusChange = (newStatus: TaskStatus) => {
    const updates: Partial<Task> = { status: newStatus };
    if (newStatus === 'done') updates.completedAt = new Date().toISOString();
    if (newStatus !== 'done') updates.completedAt = undefined;
    updateTask(task.id, updates);
    toast.success(`Status → ${STATUS_META[newStatus].label}`, { duration: 1500 });
  };

  // Save edit dialog
  const handleSaveEdit = () => {
    const updates: Partial<Task> = {
      title: editState.title,
      priority: editState.priority,
      status: editState.status,
      dueDate: editState.dueDate,
      notes: editState.notes,
      workstream: editState.workstream,
      linkedAccountId: editState.linkedAccountId,
      linkedOpportunityId: editState.linkedOpportunityId,
    };
    if (editState.status === 'done' && task.status !== 'done') {
      updates.completedAt = new Date().toISOString();
    }
    if (editState.status !== 'done') {
      updates.completedAt = undefined;
    }
    updateTask(task.id, updates);
    setEditOpen(false);
    toast.success('Saved', { duration: 1500 });
  };

  // Filter opps to selected account
  const accountOpps = editState.linkedAccountId
    ? opportunities.filter(o => o.accountId === editState.linkedAccountId)
    : [];

  return (
    <>
      <div className={cn(
        "flex items-start gap-3 p-3 rounded-lg border transition-all group",
        isTerminal
          ? "bg-muted/20 border-border/30 opacity-70"
          : "bg-card border-border/50 hover:border-border hover:shadow-sm"
      )}>
        {/* Status pill */}
        <Select value={effectiveStatus} onValueChange={(v) => handleStatusChange(v as TaskStatus)}>
          <SelectTrigger className={cn(
            "h-7 w-[110px] text-xs font-medium border shrink-0",
            statusMeta.color
          )}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_ORDER.map(s => (
              <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Account / Opp context */}
          {(accountName || oppName) && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
              {accountName && (
                <>
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="font-medium">{accountName}</span>
                </>
              )}
              {oppName && (
                <>
                  <span className="text-muted-foreground/50">›</span>
                  <Target className="h-3 w-3 shrink-0" />
                  <span>{oppName}</span>
                </>
              )}
            </div>
          )}

          {/* Title - clickable to edit */}
          <button
            className={cn(
              "font-medium text-left hover:text-primary transition-colors cursor-pointer text-sm",
              isTerminal && "line-through text-muted-foreground"
            )}
            onClick={() => { setEditState({ ...task }); setEditOpen(true); }}
          >
            {task.title}
          </button>

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge className={cn('text-[10px] h-5 cursor-pointer', PRIORITY_COLORS[task.priority])}
              onClick={() => {
                const priorities: Priority[] = ['P0', 'P1', 'P2'];
                const idx = priorities.indexOf(task.priority);
                const next = priorities[(idx + 1) % priorities.length];
                updateTask(task.id, { priority: next });
                toast.success(`Priority → ${next}`, { duration: 1500 });
              }}
            >
              {task.priority}
            </Badge>
            <Badge variant="outline" className="text-[10px] h-5">
              {WORKSTREAM_LABELS[workstream]}
            </Badge>
            {task.dueDate && (
              <span className={cn(
                "flex items-center gap-1 text-[11px] text-muted-foreground",
                isOverdue && "text-status-red font-medium"
              )}>
                <Calendar className="h-3 w-3" />
                {task.dueDate}
                {isOverdue && <AlertCircle className="h-3 w-3" />}
              </span>
            )}
          </div>

          {/* Note preview */}
          {task.notes && (
            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1 italic">
              {task.notes}
            </p>
          )}
        </div>

        {/* Delete - appears on hover */}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={() => {
            deleteTask(task.id);
            toast.success('Task deleted', { duration: 1500 });
          }}
        >
          ×
        </Button>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
            <DialogDescription>Update task details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={editState.title}
                onChange={(e) => setEditState({ ...editState, title: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Workstream</Label>
                <Select value={editState.workstream || getWorkstream(editState)} onValueChange={(v) => setEditState({ ...editState, workstream: v as Workstream })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pg">PG (New Logo)</SelectItem>
                    <SelectItem value="renewals">Renewals</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editState.status} onValueChange={(v) => setEditState({ ...editState, status: v as TaskStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map(s => (
                      <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={editState.priority} onValueChange={(v) => setEditState({ ...editState, priority: v as Priority })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="P0">P0 - Critical</SelectItem>
                    <SelectItem value="P1">P1 - High</SelectItem>
                    <SelectItem value="P2">P2 - Medium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={editState.dueDate || ''}
                  onChange={(e) => setEditState({ ...editState, dueDate: e.target.value || undefined })}
                />
              </div>
            </div>

            {/* Linked Account */}
            <div className="space-y-2">
              <Label>Linked Account</Label>
              <Select
                value={editState.linkedAccountId || '__none__'}
                onValueChange={(v) => setEditState({
                  ...editState,
                  linkedAccountId: v === '__none__' ? undefined : v,
                  linkedOpportunityId: v === '__none__' ? undefined : editState.linkedOpportunityId,
                })}
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {accounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Linked Opportunity (only if account set) */}
            {editState.linkedAccountId && accountOpps.length > 0 && (
              <div className="space-y-2">
                <Label>Linked Opportunity</Label>
                <Select
                  value={editState.linkedOpportunityId || '__none__'}
                  onValueChange={(v) => setEditState({ ...editState, linkedOpportunityId: v === '__none__' ? undefined : v })}
                >
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {accountOpps.map(o => (
                      <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Note</Label>
              <Input
                value={editState.notes || ''}
                onChange={(e) => setEditState({ ...editState, notes: e.target.value || undefined })}
                placeholder="Quick context or blocker..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Add Task Dialog ────────────────────────────────────────

function AddTaskDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { addTask, accounts, opportunities } = useStore();
  const [title, setTitle] = useState('');
  const [workstream, setWorkstream] = useState<Workstream>('pg');
  const [priority, setPriority] = useState<Priority>('P1');
  const [dueDate, setDueDate] = useState('');
  const [accountId, setAccountId] = useState<string>('');
  const [oppId, setOppId] = useState<string>('');
  const [notes, setNotes] = useState('');

  const accountOpps = accountId
    ? opportunities.filter(o => o.accountId === accountId)
    : [];

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    addTask({
      title: title.trim(),
      workstream,
      status: 'next',
      priority,
      dueDate: dueDate || undefined,
      linkedAccountId: accountId || undefined,
      linkedOpportunityId: oppId || undefined,
      notes: notes.trim() || undefined,
      // Legacy compat fields
      motion: workstream === 'renewals' ? 'renewal' : 'new-logo',
      linkedRecordType: oppId ? 'opportunity' : (accountId ? 'account' : 'account'),
      linkedRecordId: oppId || accountId || '',
    } as any);
    toast.success('Task added');
    onOpenChange(false);
    // Reset
    setTitle('');
    setWorkstream('pg');
    setPriority('P1');
    setDueDate('');
    setAccountId('');
    setOppId('');
    setNotes('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Task</DialogTitle>
          <DialogDescription>Create a task for PG or Renewals.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Workstream *</Label>
              <Select value={workstream} onValueChange={(v) => setWorkstream(v as Workstream)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pg">PG (New Logo)</SelectItem>
                  <SelectItem value="renewals">Renewals</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="P0">P0 - Critical</SelectItem>
                  <SelectItem value="P1">P1 - High</SelectItem>
                  <SelectItem value="P2">P2 - Medium</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Linked Account</Label>
            <Select value={accountId || '__none__'} onValueChange={(v) => {
              setAccountId(v === '__none__' ? '' : v);
              setOppId('');
            }}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {accounts.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {accountId && accountOpps.length > 0 && (
            <div className="space-y-2">
              <Label>Linked Opportunity</Label>
              <Select value={oppId || '__none__'} onValueChange={(v) => setOppId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {accountOpps.map(o => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Note</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Quick context..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>Add Task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────

export default function Tasks() {
  const { tasks } = useStore();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    done: true,
    dropped: true,
  });
  const [filterWorkstream, setFilterWorkstream] = useState<'all' | Workstream>('all');
  const [filterDue, setFilterDue] = useState<'all' | 'today' | 'week'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const today = new Date().toISOString().split('T')[0];
  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const weekEnd = weekFromNow.toISOString().split('T')[0];

  // Apply filters
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      // Workstream filter
      if (filterWorkstream !== 'all' && getWorkstream(task) !== filterWorkstream) return false;
      // Due filter
      if (filterDue === 'today' && task.dueDate !== today) return false;
      if (filterDue === 'week' && (!task.dueDate || task.dueDate > weekEnd)) return false;
      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!task.title.toLowerCase().includes(q) && !(task.notes || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tasks, filterWorkstream, filterDue, searchQuery, today, weekEnd]);

  // Group by status
  const grouped = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      'next': [],
      'in-progress': [],
      'blocked': [],
      'done': [],
      'dropped': [],
    };
    filteredTasks.forEach(task => {
      const status = task.status as TaskStatus;
      // Handle legacy 'open' status
      const effectiveStatus = status === ('open' as any) ? 'next' : status;
      if (groups[effectiveStatus]) {
        groups[effectiveStatus].push(task);
      } else {
        groups['next'].push(task);
      }
    });
    // Sort each group
    Object.keys(groups).forEach(k => {
      groups[k as TaskStatus] = sortTasks(groups[k as TaskStatus]);
    });
    return groups;
  }, [filteredTasks]);

  const toggleGroup = (status: string) => {
    setCollapsedGroups(prev => ({ ...prev, [status]: !prev[status] }));
  };

  const activeCount = tasks.filter(t => t.status !== 'done' && t.status !== 'dropped').length;
  const doneCount = tasks.filter(t => t.status === 'done').length;

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">Tasks</h1>
            <p className="text-sm text-muted-foreground">
              {activeCount} active • {doneCount} done
            </p>
          </div>
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Task
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {/* Workstream */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['all', 'pg', 'renewals'] as const).map(w => (
              <button
                key={w}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  filterWorkstream === w
                    ? "bg-primary text-primary-foreground"
                    : "bg-card hover:bg-muted text-muted-foreground"
                )}
                onClick={() => setFilterWorkstream(w)}
              >
                {w === 'all' ? 'All' : w === 'pg' ? 'PG' : 'Renewals'}
              </button>
            ))}
          </div>

          {/* Due filter */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {([
              { value: 'all', label: 'All' },
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This Week' },
            ] as const).map(f => (
              <button
                key={f.value}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  filterDue === f.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-card hover:bg-muted text-muted-foreground"
                )}
                onClick={() => setFilterDue(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        {/* Grouped list */}
        <div className="space-y-4">
          {STATUS_ORDER.map(status => {
            const groupTasks = grouped[status];
            const isCollapsed = collapsedGroups[status];
            const meta = STATUS_META[status];
            
            return (
              <div key={status}>
                {/* Group header */}
                <button
                  className="flex items-center gap-2 w-full text-left py-2 group"
                  onClick={() => toggleGroup(status)}
                >
                  {isCollapsed
                    ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  }
                  <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                  <span className="font-display text-sm font-semibold">{meta.label}</span>
                  <span className="text-xs text-muted-foreground font-normal">({groupTasks.length})</span>
                </button>

                {/* Group tasks */}
                {!isCollapsed && (
                  <div className="space-y-1.5 ml-6">
                    {groupTasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic py-2">No tasks</p>
                    ) : (
                      groupTasks.map(task => <TaskRow key={task.id} task={task} />)
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filteredTasks.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">
              {tasks.length === 0
                ? "No tasks yet. Add your first task!"
                : "No tasks match your filters."}
            </p>
          </div>
        )}
      </div>

      <AddTaskDialog open={showAddDialog} onOpenChange={setShowAddDialog} />
    </Layout>
  );
}

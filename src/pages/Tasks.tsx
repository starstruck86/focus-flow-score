import { useState, useMemo, useEffect } from 'react';
import { 
  Plus, 
  ChevronDown,
  ChevronRight,
  Calendar,
  Building2,
  Target,
  AlertCircle,
  Search,
  Zap,
  TrendingUp,
  MessageSquare,
  UserPlus,
  Phone,
  Mail,
  Lightbulb,
  ArrowRight,
  Repeat,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Task, Priority, TaskStatus, Workstream } from '@/types';
import { useWeekToDateMetrics } from '@/hooks/useGoodDayMetrics';

// ── Driver Tag type ────────────────────────────────────────
export type DriverTag = 'cadence' | 'calls' | 'manager-outreach' | 'meeting-set' | 'opp-creation';

const DRIVER_TAG_META: Record<DriverTag, { label: string; icon: typeof UserPlus; color: string }> = {
  'cadence':          { label: 'Cadence/Prospects', icon: UserPlus, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  'calls':            { label: 'Calls/Conversations', icon: Phone, color: 'bg-green-500/10 text-green-600 border-green-500/20' },
  'manager-outreach': { label: 'Manager+ Outreach', icon: Mail, color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  'meeting-set':      { label: 'Meeting Set', icon: Calendar, color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  'opp-creation':     { label: 'Opp Creation', icon: Target, color: 'bg-rose-500/10 text-rose-600 border-rose-500/20' },
};

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

// Good Day driver targets (from daily template defaults)
const DEFAULT_DRIVER_TARGETS = {
  prospectsAdded: 20,
  conversations: 3,
  managerPlusMessages: 5,
  meetingsSet: 1,
  oppsCreated: 0,
};

// ── Helper: derive workstream from legacy data ─────────────
function getWorkstream(task: Task): Workstream {
  if (task.workstream) return task.workstream;
  if (task.motion === 'renewal') return 'renewals';
  return 'pg';
}

// ── Helper: get account name for display ───────────────────
function useAccountName(task: Task) {
  const { accounts, opportunities } = useStore();
  if (task.linkedAccountId) {
    return accounts.find(a => a.id === task.linkedAccountId)?.name;
  }
  if (task.linkedRecordType === 'opportunity' && task.linkedRecordId) {
    const opp = opportunities.find(o => o.id === task.linkedRecordId);
    if (opp?.accountId) {
      return accounts.find(a => a.id === opp.accountId)?.name || opp.accountName;
    }
    return opp?.accountName;
  }
  if (task.linkedRecordType === 'account' && task.linkedRecordId) {
    return accounts.find(a => a.id === task.linkedRecordId)?.name;
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
    const pa = priorityOrder[a.priority] ?? 3;
    const pb = priorityOrder[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

// ── Momentum Header ────────────────────────────────────────

function MomentumHeader({ workstreamFilter }: { workstreamFilter: 'pg' | 'renewals' | 'all' }) {
  const { currentDay, initializeToday } = useStore();
  const { data: wtdMetrics } = useWeekToDateMetrics();
  
  useEffect(() => { initializeToday(); }, [initializeToday]);

  const isPG = workstreamFilter !== 'renewals';
  const pointsToday = currentDay?.scores?.dailyScore ?? 0;
  const hasCheckIn = currentDay && (currentDay.scores?.dailyScore ?? 0) > 0;

  // Today's actuals from store's currentDay
  const todayActuals = {
    prospectsAdded: currentDay?.rawInputs?.prospectsAddedToCadence ?? 0,
    conversations: currentDay?.rawInputs?.coldCallsWithConversations ?? 0,
    managerPlusMessages: currentDay?.rawInputs?.emailsInMailsToManager ?? 0,
    meetingsSet: currentDay?.rawInputs?.initialMeetingsSet ?? 0,
    oppsCreated: currentDay?.rawInputs?.opportunitiesCreated ?? 0,
    pd: currentDay?.rawInputs?.personalDevelopment ?? 0,
  };

  const drivers = isPG ? [
    { key: 'prospectsAdded', label: 'Prospects/Cadence', actual: todayActuals.prospectsAdded, target: DEFAULT_DRIVER_TARGETS.prospectsAdded, icon: UserPlus, action: 'quick-log' },
    { key: 'conversations', label: 'Conversations', actual: todayActuals.conversations, target: DEFAULT_DRIVER_TARGETS.conversations, icon: Phone, action: 'power-hour' },
    { key: 'managerPlusMessages', label: 'Manager+ Msgs', actual: todayActuals.managerPlusMessages, target: DEFAULT_DRIVER_TARGETS.managerPlusMessages, icon: Mail, action: 'quick-log' },
    { key: 'meetingsSet', label: 'Meetings Set', actual: todayActuals.meetingsSet, target: DEFAULT_DRIVER_TARGETS.meetingsSet, icon: Calendar, action: 'quick-log' },
    { key: 'oppsCreated', label: 'Opps Created', actual: todayActuals.oppsCreated, target: DEFAULT_DRIVER_TARGETS.oppsCreated, icon: Target, action: 'add-opp' },
  ] : [
    { key: 'conversations', label: 'Conversations', actual: todayActuals.conversations, target: DEFAULT_DRIVER_TARGETS.conversations, icon: Phone, action: 'power-hour' },
    { key: 'meetingsSet', label: 'Meetings Set', actual: todayActuals.meetingsSet, target: DEFAULT_DRIVER_TARGETS.meetingsSet, icon: Calendar, action: 'quick-log' },
  ];

  // Dispatch keyboard shortcut to open FAB actions
  const triggerAction = (action: string) => {
    if (action === 'quick-log') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    } else if (action === 'power-hour') {
      // Open FAB then click power hour - for now just quick log
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    } else if (action === 'add-opp') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    }
  };

  // Compute suggested next 3 (biggest gaps for PG drivers)
  const gaps = isPG ? [
    { tag: 'cadence' as DriverTag, gap: Math.max(0, DEFAULT_DRIVER_TARGETS.prospectsAdded - todayActuals.prospectsAdded), action: 'quick-log' },
    { tag: 'calls' as DriverTag, gap: Math.max(0, DEFAULT_DRIVER_TARGETS.conversations - todayActuals.conversations), action: 'power-hour' },
    { tag: 'manager-outreach' as DriverTag, gap: Math.max(0, DEFAULT_DRIVER_TARGETS.managerPlusMessages - todayActuals.managerPlusMessages), action: 'quick-log' },
    { tag: 'meeting-set' as DriverTag, gap: Math.max(0, DEFAULT_DRIVER_TARGETS.meetingsSet - todayActuals.meetingsSet), action: 'quick-log' },
    { tag: 'opp-creation' as DriverTag, gap: Math.max(0, DEFAULT_DRIVER_TARGETS.oppsCreated - todayActuals.oppsCreated), action: 'add-opp' },
  ].filter(g => g.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 3) : [];

  const title = isPG ? 'New Logo Momentum' : 'Renewals Focus';
  const pointsColor = pointsToday >= 8 ? 'text-status-green' : pointsToday >= 5 ? 'text-status-yellow' : 'text-foreground';

  return (
    <div className="rounded-xl border border-border bg-card p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="font-display text-base font-bold">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Points Today</span>
          <span className={cn("font-display text-xl font-bold", pointsColor)}>
            {pointsToday}
          </span>
          <span className="text-sm text-muted-foreground">/ 8</span>
        </div>
      </div>

      {/* Driver chips - now clickable to launch actions */}
      <div className="flex flex-wrap gap-2 mb-2">
        {drivers.map(d => {
          const met = d.target > 0 ? d.actual >= d.target : d.actual > 0;
          const Icon = d.icon;
          return (
            <button
              key={d.key}
              onClick={() => !met && triggerAction(d.action)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all",
                met
                  ? "bg-status-green/10 text-status-green border-status-green/20"
                  : "bg-muted/50 text-muted-foreground border-border hover:bg-primary/10 hover:border-primary/30 hover:text-primary cursor-pointer"
              )}
              title={met ? 'Target met!' : `Click to log ${d.label}`}
            >
              <Icon className="h-3 w-3" />
              <span>{d.label}</span>
              <span className="font-bold">{d.actual}</span>
              {d.target > 0 && <span className="opacity-60">/ {d.target}</span>}
            </button>
          );
        })}
        {/* PD as secondary */}
        {isPG && (
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-medium",
            todayActuals.pd ? "bg-status-green/10 text-status-green border-status-green/20" : "bg-muted/30 text-muted-foreground/60 border-border/50"
          )}>
            <Lightbulb className="h-3 w-3" />
            PD {todayActuals.pd ? '✓' : '—'}
          </div>
        )}
      </div>

      {/* No check-in banner */}
      {!hasCheckIn && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span>No activity logged today.</span>
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))}
            className="text-primary font-medium hover:underline"
          >
            Quick Log →
          </button>
        </div>
      )}

      {/* Suggested Next 3 - now clickable */}
      {isPG && pointsToday < 8 && gaps.length > 0 && (
        <div className="mt-2 flex items-center gap-2 text-xs bg-primary/5 rounded-lg px-3 py-2 border border-primary/10">
          <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-muted-foreground">Build momentum:</span>
          {gaps.map(g => {
            const meta = DRIVER_TAG_META[g.tag];
            const Icon = meta.icon;
            return (
              <button
                key={g.tag}
                onClick={() => triggerAction(g.action)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity",
                  meta.color
                )}
                title={`Click to log ${meta.label}`}
              >
                <Icon className="h-2.5 w-2.5" />
                {meta.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Renewal Due Banner ─────────────────────────────────────

function RenewalDueBanner({ tasks, onSwitchFilter }: { tasks: Task[]; onSwitchFilter: () => void }) {
  const today = new Date().toISOString().split('T')[0];
  const renewalsDueToday = tasks.filter(t => {
    const ws = getWorkstream(t);
    return ws === 'renewals' && t.status !== 'done' && t.status !== 'dropped' && t.dueDate && t.dueDate <= today;
  });

  if (renewalsDueToday.length === 0) return null;

  return (
    <div className="flex items-center gap-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-4">
      <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
      <span className="text-amber-700 dark:text-amber-400 font-medium">
        {renewalsDueToday.length} Renewal task{renewalsDueToday.length > 1 ? 's' : ''} due today
      </span>
      <button onClick={onSwitchFilter} className="text-primary font-medium hover:underline ml-1">
        View Renewals →
      </button>
    </div>
  );
}

// ── Task Row Component ─────────────────────────────────────

function TaskRow({ task }: { task: Task }) {
  const { updateTask, deleteTask, accounts, opportunities, recurringTemplates } = useStore();
  const accountName = useAccountName(task);
  const oppName = useOpportunityName(task);
  const [editOpen, setEditOpen] = useState(false);
  const [editState, setEditState] = useState<Task>(task);
  const workstream = getWorkstream(task);
  const today = new Date().toISOString().split('T')[0];
  const isRecurringInstance = recurringTemplates.some(t => t.activeInstanceId === task.id);
  const effectiveStatus: TaskStatus = (task.status as string) === 'open' ? 'next' : task.status;
  const statusMeta = STATUS_META[effectiveStatus] || STATUS_META['next'];
  const isOverdue = task.dueDate && task.dueDate < today && effectiveStatus !== 'done' && effectiveStatus !== 'dropped';
  const isTerminal = effectiveStatus === 'done' || effectiveStatus === 'dropped';

  const handleStatusChange = (newStatus: TaskStatus) => {
    const updates: Partial<Task> = { status: newStatus };
    if (newStatus === 'done') updates.completedAt = new Date().toISOString();
    if (newStatus !== 'done') updates.completedAt = undefined;
    updateTask(task.id, updates);
    toast.success(`Status → ${STATUS_META[newStatus].label}`, { duration: 1500 });
  };

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

  const accountOpps = editState.linkedAccountId
    ? opportunities.filter(o => o.accountId === editState.linkedAccountId)
    : [];

  // Infer driver tag from task title keywords (lightweight heuristic)
  const inferredTag = useMemo(() => {
    const t = (task.title + ' ' + (task.notes || '')).toLowerCase();
    if (t.includes('cadence') || t.includes('prospect') || t.includes('sequence')) return 'cadence' as DriverTag;
    if (t.includes('call') || t.includes('dial') || t.includes('conversation') || t.includes('connect')) return 'calls' as DriverTag;
    if (t.includes('manager') || t.includes('vp') || t.includes('director') || t.includes('exec') || t.includes('custom outreach')) return 'manager-outreach' as DriverTag;
    if (t.includes('meeting') || t.includes('demo') || t.includes('schedule')) return 'meeting-set' as DriverTag;
    if (t.includes('opp') || t.includes('opportunity') || t.includes('create opp')) return 'opp-creation' as DriverTag;
    return null;
  }, [task.title, task.notes]);

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
          <SelectTrigger className={cn("h-7 w-[110px] text-xs font-medium border shrink-0", statusMeta.color)}>
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

          <div className="flex items-center gap-1.5">
            {isRecurringInstance && (
              <Repeat className="h-3 w-3 text-primary shrink-0" />
            )}
            <button
              className={cn(
                "font-medium text-left hover:text-primary transition-colors cursor-pointer text-sm",
                isTerminal && "line-through text-muted-foreground"
              )}
              onClick={() => { setEditState({ ...task }); setEditOpen(true); }}
            >
              {task.title}
            </button>
          </div>

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
            {/* Driver tag chip */}
            {inferredTag && (
              <span className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] font-medium",
                DRIVER_TAG_META[inferredTag].color
              )}>
                {DRIVER_TAG_META[inferredTag].label}
              </span>
            )}
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

          {task.notes && (
            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1 italic">
              {task.notes}
            </p>
          )}
        </div>

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
              <Input value={editState.title} onChange={(e) => setEditState({ ...editState, title: e.target.value })} />
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
                <Input type="date" value={editState.dueDate || ''} onChange={(e) => setEditState({ ...editState, dueDate: e.target.value || undefined })} />
              </div>
            </div>
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
              <Input value={editState.notes || ''} onChange={(e) => setEditState({ ...editState, notes: e.target.value || undefined })} placeholder="Quick context or blocker..." />
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

function AddTaskDialog({ open, onOpenChange, defaultWorkstream }: { open: boolean; onOpenChange: (v: boolean) => void; defaultWorkstream: Workstream }) {
  const { addTask, accounts, opportunities } = useStore();
  const [title, setTitle] = useState('');
  const [workstream, setWorkstream] = useState<Workstream>(defaultWorkstream);
  const [priority, setPriority] = useState<Priority>('P1');
  const [dueDate, setDueDate] = useState('');
  const [accountId, setAccountId] = useState<string>('');
  const [oppId, setOppId] = useState<string>('');
  const [notes, setNotes] = useState('');

  // Sync default workstream when dialog opens
  useEffect(() => {
    if (open) {
      setWorkstream(defaultWorkstream);
      setTitle('');
      setPriority('P1');
      setDueDate('');
      setAccountId('');
      setOppId('');
      setNotes('');
    }
  }, [open, defaultWorkstream]);

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
      motion: workstream === 'renewals' ? 'renewal' : 'new-logo',
      linkedRecordType: oppId ? 'opportunity' : (accountId ? 'account' : 'account'),
      linkedRecordId: oppId || accountId || '',
    } as any);
    toast.success('Task added');
    onOpenChange(false);
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
            <Select value={accountId || '__none__'} onValueChange={(v) => { setAccountId(v === '__none__' ? '' : v); setOppId(''); }}>
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
  const { tasks, recurringTemplates, generateDueRecurringInstances } = useStore();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    done: true,
    dropped: true,
  });
  // Default to PG (New Logo) — never default to 'all'
  const [filterWorkstream, setFilterWorkstream] = useState<'all' | Workstream>('pg');
  const [filterDue, setFilterDue] = useState<'all' | 'today' | 'week'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Generate due recurring instances on mount
  useEffect(() => {
    generateDueRecurringInstances();
  }, [generateDueRecurringInstances]);

  // Build a set of task IDs that are recurring instances
  const recurringInstanceIds = useMemo(() => {
    const ids = new Set<string>();
    recurringTemplates.forEach(t => {
      if (t.activeInstanceId) ids.add(t.activeInstanceId);
    });
    return ids;
  }, [recurringTemplates]);

  const today = new Date().toISOString().split('T')[0];
  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const weekEnd = weekFromNow.toISOString().split('T')[0];

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

  const grouped = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      'next': [], 'in-progress': [], 'blocked': [], 'done': [], 'dropped': [],
    };
    filteredTasks.forEach(task => {
      const status = task.status as TaskStatus;
      const effectiveStatus = status === ('open' as any) ? 'next' : status;
      if (groups[effectiveStatus]) {
        groups[effectiveStatus].push(task);
      } else {
        groups['next'].push(task);
      }
    });
    Object.keys(groups).forEach(k => {
      groups[k as TaskStatus] = sortTasks(groups[k as TaskStatus]);
    });
    return groups;
  }, [filteredTasks]);

  const toggleGroup = (status: string) => {
    setCollapsedGroups(prev => ({ ...prev, [status]: !prev[status] }));
  };

  const activeCount = filteredTasks.filter(t => t.status !== 'done' && t.status !== 'dropped').length;
  const doneCount = filteredTasks.filter(t => t.status === 'done').length;

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        {/* Momentum Header */}
        <MomentumHeader workstreamFilter={filterWorkstream} />

        {/* Title + Add */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-display text-2xl font-bold">Tasks</h1>
            <p className="text-sm text-muted-foreground">
              {activeCount} active • {doneCount} done
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/recurring">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Repeat className="h-3.5 w-3.5" />
                Recurring
                {recurringTemplates.length > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5">{recurringTemplates.length}</Badge>
                )}
              </Button>
            </Link>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Task
            </Button>
          </div>
        </div>

        {/* Renewal due-today banner (only when PG filter active) */}
        {filterWorkstream === 'pg' && (
          <RenewalDueBanner tasks={tasks} onSwitchFilter={() => setFilterWorkstream('renewals')} />
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {/* Workstream toggle: PG | Renewals | All */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {([
              { value: 'pg' as const, label: 'PG' },
              { value: 'renewals' as const, label: 'Renewals' },
              { value: 'all' as const, label: 'All' },
            ]).map(w => (
              <button
                key={w.value}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  filterWorkstream === w.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-card hover:bg-muted text-muted-foreground"
                )}
                onClick={() => setFilterWorkstream(w.value)}
              >
                {w.label}
              </button>
            ))}
          </div>

          {/* Due filter */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {([
              { value: 'all' as const, label: 'All' },
              { value: 'today' as const, label: 'Today' },
              { value: 'week' as const, label: 'This Week' },
            ]).map(f => (
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

      <AddTaskDialog open={showAddDialog} onOpenChange={setShowAddDialog} defaultWorkstream={filterWorkstream === 'all' ? 'pg' : filterWorkstream} />
    </Layout>
  );
}

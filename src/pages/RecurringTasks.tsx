import { useState, useMemo } from 'react';
import {
  Plus,
  Repeat,
  Pause,
  Play,
  Trash2,
  Pencil,
  Calendar,
  ArrowLeft,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import type { Priority, Workstream } from '@/types';
import type { RecurringTaskTemplate, RecurrenceFrequency, RecurrenceEndType, MonthlyMode } from '@/types/recurring';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FREQ_LABELS: Record<RecurrenceFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function describeRecurrence(t: RecurringTaskTemplate): string {
  const { rule, end } = t;
  let desc = '';
  switch (rule.frequency) {
    case 'daily':
      desc = rule.includeWeekends ? 'Every day' : 'Weekdays (Mon–Fri)';
      break;
    case 'weekly':
      desc = 'Weekly on ' + (rule.daysOfWeek ?? [1]).map(d => DAY_LABELS[d]).join(', ');
      break;
    case 'monthly':
      if (rule.monthlyMode === 'first-business-day') desc = 'Monthly (1st business day)';
      else if (rule.monthlyMode === 'last-business-day') desc = 'Monthly (last business day)';
      else desc = `Monthly on day ${rule.dayOfMonth ?? 1}`;
      break;
  }
  if (end.type === 'on-date' && end.endDate) desc += ` until ${end.endDate}`;
  if (end.type === 'after-count' && end.maxOccurrences) desc += ` (${end.completedOccurrences ?? 0}/${end.maxOccurrences} done)`;
  return desc;
}

function RecurringTemplateDialog({
  open,
  onOpenChange,
  editTemplate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editTemplate?: RecurringTaskTemplate;
}) {
  const { addRecurringTemplate, updateRecurringTemplate, accounts, opportunities } = useStore();

  const [title, setTitle] = useState(editTemplate?.title ?? '');
  const [workstream, setWorkstream] = useState<Workstream>(editTemplate?.workstream ?? 'pg');
  const [priority, setPriority] = useState<Priority>(editTemplate?.priority ?? 'P1');
  const [accountId, setAccountId] = useState(editTemplate?.linkedAccountId ?? '');
  const [oppId, setOppId] = useState(editTemplate?.linkedOpportunityId ?? '');
  const [notes, setNotes] = useState(editTemplate?.notes ?? '');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(editTemplate?.rule.frequency ?? 'daily');
  const [includeWeekends, setIncludeWeekends] = useState(editTemplate?.rule.includeWeekends ?? false);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(editTemplate?.rule.daysOfWeek ?? [1]);
  const [dayOfMonth, setDayOfMonth] = useState(editTemplate?.rule.dayOfMonth ?? 1);
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>(editTemplate?.rule.monthlyMode ?? 'day-of-month');
  const [endType, setEndType] = useState<RecurrenceEndType>(editTemplate?.end.type ?? 'never');
  const [endDate, setEndDate] = useState(editTemplate?.end.endDate ?? '');
  const [maxOccurrences, setMaxOccurrences] = useState(editTemplate?.end.maxOccurrences ?? 10);

  const accountOpps = accountId ? opportunities.filter(o => o.accountId === accountId) : [];

  const toggleDay = (day: number) => {
    setDaysOfWeek(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (frequency === 'weekly' && daysOfWeek.length === 0) {
      toast.error('Select at least one day');
      return;
    }

    const data = {
      title: title.trim(),
      workstream,
      priority,
      linkedAccountId: accountId || undefined,
      linkedOpportunityId: oppId || undefined,
      notes: notes.trim() || undefined,
      rule: {
        frequency,
        ...(frequency === 'daily' && { includeWeekends }),
        ...(frequency === 'weekly' && { daysOfWeek }),
        ...(frequency === 'monthly' && { monthlyMode, dayOfMonth: monthlyMode === 'day-of-month' ? dayOfMonth : undefined }),
      },
      end: {
        type: endType,
        ...(endType === 'on-date' && { endDate }),
        ...(endType === 'after-count' && { maxOccurrences, completedOccurrences: editTemplate?.end.completedOccurrences ?? 0 }),
      },
    };

    if (editTemplate) {
      updateRecurringTemplate(editTemplate.id, data);
      toast.success('Recurring task updated');
    } else {
      addRecurringTemplate(data as any);
      toast.success('Recurring task created');
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-5 w-5 text-primary" />
            {editTemplate ? 'Edit Recurring Task' : 'New Recurring Task'}
          </DialogTitle>
          <DialogDescription>
            {editTemplate ? 'Changes affect future instances only.' : 'Create a repeating momentum task.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Call my leads" autoFocus />
          </div>

          {/* Workstream + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Workstream</Label>
              <Select value={workstream} onValueChange={v => setWorkstream(v as Workstream)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pg">PG (New Logo)</SelectItem>
                  <SelectItem value="renewals">Renewals</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={v => setPriority(v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="P0">P0 - Critical</SelectItem>
                  <SelectItem value="P1">P1 - High</SelectItem>
                  <SelectItem value="P2">P2 - Medium</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Frequency */}
          <div className="space-y-2">
            <Label>Repeat Frequency</Label>
            <Select value={frequency} onValueChange={v => setFrequency(v as RecurrenceFrequency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Daily options */}
          {frequency === 'daily' && (
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <Label className="text-sm">Include weekends</Label>
              <Switch checked={includeWeekends} onCheckedChange={setIncludeWeekends} />
            </div>
          )}

          {/* Weekly options */}
          {frequency === 'weekly' && (
            <div className="space-y-2">
              <Label className="text-sm">Days of week</Label>
              <div className="flex gap-1 flex-wrap">
                {DAY_LABELS.map((label, i) => (
                  <button
                    key={i}
                    className={cn(
                      'w-10 h-8 rounded-md text-xs font-medium border transition-colors',
                      daysOfWeek.includes(i)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground border-border hover:bg-muted'
                    )}
                    onClick={() => toggleDay(i)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Monthly options */}
          {frequency === 'monthly' && (
            <div className="space-y-3">
              <Select value={monthlyMode} onValueChange={v => setMonthlyMode(v as MonthlyMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day-of-month">Day of month</SelectItem>
                  <SelectItem value="first-business-day">First business day</SelectItem>
                  <SelectItem value="last-business-day">Last business day</SelectItem>
                </SelectContent>
              </Select>
              {monthlyMode === 'day-of-month' && (
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={e => setDayOfMonth(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
                />
              )}
            </div>
          )}

          {/* End condition */}
          <div className="space-y-2">
            <Label>Ends</Label>
            <Select value={endType} onValueChange={v => setEndType(v as RecurrenceEndType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Never</SelectItem>
                <SelectItem value="on-date">On date</SelectItem>
                <SelectItem value="after-count">After X occurrences</SelectItem>
              </SelectContent>
            </Select>
            {endType === 'on-date' && (
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            )}
            {endType === 'after-count' && (
              <Input
                type="number"
                min={1}
                value={maxOccurrences}
                onChange={e => setMaxOccurrences(Math.max(1, parseInt(e.target.value) || 1))}
                placeholder="Number of occurrences"
              />
            )}
          </div>

          {/* Linked account */}
          <div className="space-y-2">
            <Label>Linked Account</Label>
            <Select value={accountId || '__none__'} onValueChange={v => { setAccountId(v === '__none__' ? '' : v); setOppId(''); }}>
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
              <Select value={oppId || '__none__'} onValueChange={v => setOppId(v === '__none__' ? '' : v)}>
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

          {/* Note */}
          <div className="space-y-2">
            <Label>Note</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Quick context..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>{editTemplate ? 'Save' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RecurringTasks() {
  const { recurringTemplates, updateRecurringTemplate, deleteRecurringTemplate, generateDueRecurringInstances } = useStore();
  const [addOpen, setAddOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<RecurringTaskTemplate | null>(null);

  const sorted = useMemo(() =>
    [...recurringTemplates].sort((a, b) => {
      if (a.paused !== b.paused) return a.paused ? 1 : -1;
      return b.updatedAt.localeCompare(a.updatedAt);
    }),
    [recurringTemplates]
  );

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link to="/tasks" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              <Repeat className="h-6 w-6 text-primary" />
              Recurring Tasks
            </h1>
            <p className="text-sm text-muted-foreground">
              {recurringTemplates.length} template{recurringTemplates.length !== 1 ? 's' : ''} • Generates task instances when due
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Recurring
          </Button>
        </div>

        {/* Templates list */}
        {sorted.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-xl">
            <Repeat className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm mb-4">
              No recurring tasks yet. Create one to build daily/weekly momentum.
            </p>
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Recurring Task
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map(template => (
              <div
                key={template.id}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-lg border transition-all',
                  template.paused
                    ? 'bg-muted/20 border-border/30 opacity-60'
                    : 'bg-card border-border/50 hover:border-border hover:shadow-sm'
                )}
              >
                <Repeat className={cn('h-4 w-4 mt-0.5 shrink-0', template.paused ? 'text-muted-foreground' : 'text-primary')} />
                <div className="flex-1 min-w-0">
                  <p className={cn('font-medium text-sm', template.paused && 'line-through text-muted-foreground')}>
                    {template.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant="outline" className="text-[10px] h-5">
                      {template.workstream === 'pg' ? 'PG' : 'Renewals'}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {describeRecurrence(template)}
                    </span>
                    {template.paused && (
                      <Badge variant="secondary" className="text-[10px] h-5">Paused</Badge>
                    )}
                  </div>
                  {template.notes && (
                    <p className="text-[11px] text-muted-foreground mt-1 italic">{template.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    title={template.paused ? 'Resume' : 'Pause'}
                    onClick={() => {
                      updateRecurringTemplate(template.id, { paused: !template.paused });
                      toast.success(template.paused ? 'Resumed' : 'Paused', { duration: 1500 });
                    }}
                  >
                    {template.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    title="Edit"
                    onClick={() => setEditTemplate(template)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    title="Delete"
                    onClick={() => {
                      deleteRecurringTemplate(template.id);
                      toast.success('Deleted', { duration: 1500 });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <RecurringTemplateDialog open={addOpen} onOpenChange={setAddOpen} />
        {editTemplate && (
          <RecurringTemplateDialog
            open={true}
            onOpenChange={(v) => { if (!v) setEditTemplate(null); }}
            editTemplate={editTemplate}
          />
        )}
      </div>
    </Layout>
  );
}

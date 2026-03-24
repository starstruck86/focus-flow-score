/**
 * WeeklyQueueOverview — shows all 15 weekly research queue accounts
 * grouped by day (Mon–Fri, 3 each) with state badges, progress,
 * inline contact counts, and edit controls (remove / add / swap).
 */
import { memo, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CheckCircle2, Circle, ArrowRight, RefreshCw, Loader2,
  X, Plus, Users, MoreVertical, ArrowUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import {
  useWeeklyResearchQueue,
  type AccountState, type QueueAccount, type WeeklyAssignments,
} from '@/hooks/useWeeklyResearchQueue';

// ── Helpers ──

const DAY_LABELS: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri',
};

// ── Contact count (real data) ──

const ContactCount = memo(function ContactCount({ accountId }: { accountId: string }) {
  const { contacts } = useStore();
  const count = useMemo(
    () => contacts.filter(c => c.accountId === accountId).length,
    [contacts, accountId],
  );
  if (count === 0) return null;
  return (
    <span className="text-[9px] font-mono text-muted-foreground">
      <Users className="inline h-2.5 w-2.5 mr-0.5" />{count}
    </span>
  );
});

// ── State badge ──

function StateBadge({ state }: { state: AccountState }) {
  switch (state) {
    case 'added_to_cadence':
      return (
        <Badge className="gap-1 bg-primary/15 text-primary text-[10px] border-0">
          <CheckCircle2 className="h-3 w-3" /> Cadence
        </Badge>
      );
    case 'researched':
      return (
        <Badge className="gap-1 bg-status-green/15 text-status-green text-[10px] border-0">
          <CheckCircle2 className="h-3 w-3" /> Researched
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground text-[10px]">
          <Circle className="h-3 w-3" /> Todo
        </Badge>
      );
  }
}

// ── Add account picker (inline) ──

function AddAccountPicker({ day, onAdd, onClose, assignments }: {
  day: keyof WeeklyAssignments;
  onAdd: (day: keyof WeeklyAssignments, account: { id: string; name: string; tier?: string; industry?: string }) => void;
  onClose: () => void;
  assignments: WeeklyAssignments;
}) {
  const [q, setQ] = useState('');
  const { accounts } = useStore();

  // IDs already in the queue this week
  const queuedIds = useMemo(() => {
    const set = new Set<string>();
    for (const k of Object.keys(assignments)) {
      for (const a of assignments[k as keyof WeeklyAssignments]) set.add(a.id);
    }
    return set;
  }, [assignments]);

  const filtered = useMemo(() => {
    if (!q.trim()) return [];
    const lower = q.toLowerCase();
    return accounts
      .filter(a => !queuedIds.has(a.id) && a.name.toLowerCase().includes(lower))
      .slice(0, 6);
  }, [q, accounts, queuedIds]);

  return (
    <div className="relative mt-1">
      <Input
        autoFocus
        className="h-6 text-xs"
        placeholder="Search accounts to add…"
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && onClose()}
      />
      {q.length > 0 && (
        <div className="absolute z-20 top-7 left-0 right-0 bg-popover border border-border rounded-md shadow-lg max-h-32 overflow-y-auto">
          {filtered.map(a => (
            <button
              key={a.id}
              className="w-full text-left px-2 py-1 hover:bg-accent transition-colors text-xs"
              onClick={() => { onAdd(day, { id: a.id, name: a.name, tier: a.tier, industry: a.industry }); onClose(); }}
            >
              {a.name} <span className="text-muted-foreground text-[10px]">{a.tier}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground">No eligible accounts</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Day card ──

function DayRow({ dayKey, label, accounts: dayAccounts, isToday, onAdvance, onRemove, assignments, onAdd }: {
  dayKey: string;
  label: string;
  accounts: QueueAccount[];
  isToday: boolean;
  onAdvance: (day: keyof WeeklyAssignments, accountId: string, newState: 'researched' | 'added_to_cadence') => void;
  onRemove: (day: keyof WeeklyAssignments, accountId: string) => void;
  assignments: WeeklyAssignments;
  onAdd: (day: keyof WeeklyAssignments, account: { id: string; name: string; tier?: string; industry?: string }) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const completed = dayAccounts.filter(a => a.state !== 'not_started').length;
  const day = dayKey as keyof WeeklyAssignments;

  return (
    <div className={cn(
      "rounded-lg border p-2.5 space-y-1.5",
      isToday ? "border-primary/40 bg-primary/5" : "border-border bg-card",
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={cn("text-xs font-semibold", isToday && "text-primary")}>{label}</span>
          {isToday && <Badge className="text-[8px] bg-primary/20 text-primary border-0 px-1">Today</Badge>}
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">{completed}/{dayAccounts.length}</span>
      </div>

      {dayAccounts.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">No accounts</p>
      ) : (
        <div className="space-y-1">
          {dayAccounts.map(account => (
            <div key={account.id} className="flex items-center justify-between gap-1 group">
              <div className="flex items-center gap-1 min-w-0 flex-1">
                <span className="text-xs truncate">{account.name}</span>
                {account.tier && (
                  <span className={cn(
                    "text-[9px] font-bold shrink-0",
                    account.tier === 'A' ? 'text-status-green' : account.tier === 'B' ? 'text-status-yellow' : 'text-muted-foreground',
                  )}>{account.tier}</span>
                )}
                <ContactCount accountId={account.id} />
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <StateBadge state={account.state} />
                {/* Advance buttons */}
                {account.state === 'not_started' && (
                  <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100"
                    onClick={() => onAdvance(day, account.id, 'researched')} title="Mark researched">
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                )}
                {account.state === 'researched' && (
                  <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100"
                    onClick={() => onAdvance(day, account.id, 'added_to_cadence')} title="Mark in cadence">
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                )}
                {/* Remove */}
                <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive"
                  onClick={() => onRemove(day, account.id)} title="Remove">
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add account */}
      {dayAccounts.length < 3 && !showAdd && (
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <Plus className="h-3 w-3" /> Add account
        </button>
      )}
      {showAdd && (
        <AddAccountPicker day={day} onAdd={onAdd} onClose={() => setShowAdd(false)} assignments={assignments} />
      )}
    </div>
  );
}

// ── Main component ──

export const WeeklyQueueOverview = memo(function WeeklyQueueOverview() {
  const {
    assignments, todayKey, loading, isEmpty,
    weeklyResearched, weeklyAddedToCadence, weeklyTotal,
    generateQueue, advanceState, removeAccount, addAccount,
    DAY_KEYS, weekStart,
  } = useWeeklyResearchQueue();

  const progress = useMemo(() => {
    return weeklyTotal > 0 ? Math.round((weeklyResearched / weeklyTotal) * 100) : 0;
  }, [weeklyResearched, weeklyTotal]);

  if (loading) {
    return (
      <div className="metric-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading weekly queue…
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="metric-card p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">No weekly research queue generated yet.</p>
        <Button onClick={generateQueue} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Generate Queue (15 Accounts)
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">🎯 Weekly New Logo Queue</span>
          <span className="text-[10px] text-muted-foreground">Week of {weekStart}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">
            <span className="font-mono font-bold text-foreground">{weeklyResearched}</span>/{weeklyTotal} done
          </span>
          <span className="text-xs text-muted-foreground">
            <span className="font-mono font-bold text-primary">{weeklyAddedToCadence}</span> in cadence
          </span>
          <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={generateQueue}>
            <RefreshCw className="h-3 w-3" /> Regen
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all duration-500 rounded-full" style={{ width: `${progress}%` }} />
      </div>

      {/* Day cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        {DAY_KEYS.map((day: string) => (
          <DayRow
            key={day}
            dayKey={day}
            label={DAY_LABELS[day] || day}
            accounts={assignments[day as keyof WeeklyAssignments] || []}
            isToday={todayKey === day}
            onAdvance={advanceState}
            onRemove={removeAccount}
            onAdd={addAccount}
            assignments={assignments}
          />
        ))}
      </div>
    </div>
  );
});

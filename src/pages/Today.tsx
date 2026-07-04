// Today — Guide v3 §1 dispatcher shell.
// Fixed frame · moment-driven content · zero-row honest empties · thumb-zone.
// Old Dashboard remains mounted at /dashboard as fallback this wave (P1b).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Settings as SettingsIcon, RefreshCw, ChevronRight, Newspaper, Calendar, ListTodo, Target, GraduationCap, Dumbbell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePullToRefresh } from '@/lib/gestures/usePullToRefresh';
import { useCalendarEvents, useSyncCalendar, useAutoSyncCalendar } from '@/hooks/useCalendarEvents';
import { useDailyDigest } from '@/hooks/useDailyDigest';
import { StreakChip } from '@/components/StreakChip';
import { BostonClock } from '@/components/BostonClock';
import { bostonNow, formatTimeET, todayET } from '@/lib/timeFormat';
import { cn } from '@/lib/utils';

// Single ROUTES constant — P1c flips these to /work and /train-hub.
const ROUTES = {
  work: '/strategy',
  train: '/study',
  brief: '/brief',
  meeting: '/meeting',
  postCall: '/post-call',
  carMode: '/car-mode',
  settings: '/settings',
} as const;

// Friendly labels for the resume pill.
const SURFACE_LABELS: Record<string, string> = {
  '/strategy': 'Strategy',
  '/study': 'Study',
  '/tasks': 'Tasks',
  '/deals': 'Deals',
  '/accounts': 'Accounts',
  '/renewals': 'Renewals',
  '/grade': 'Game film',
  '/dojo': 'Dojo',
  '/flash': 'Flash',
  '/brief': 'Brief',
  '/meeting': 'Meeting',
  '/post-call': 'Post-Call Log',
  '/car-mode': 'Car Mode',
  '/settings': 'Settings',
};
function friendlySurface(path: string): string {
  if (SURFACE_LABELS[path]) return SURFACE_LABELS[path];
  const seg = path.split('/').filter(Boolean)[0] ?? '';
  return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : 'where you left off';
}

// ── Tokens (Guide v3 §8) ────────────────────────────────────────────────────
const T = {
  ink: 'bg-[#0B0F14]',
  panel: 'bg-[#141B24]',
  line: 'border-[#26313F]',
  text: 'text-[#F2F5F8]',
  muted: 'text-[#8A97A6]',
  amber: 'text-[#FFA226]',
  amberBg: 'bg-[#FFA226]',
  jade: 'text-[#3DDC97]',
  jadeBg: 'bg-[#3DDC97]',
  live: 'text-[#FF5C5C]',
};

// ── Data hooks ──────────────────────────────────────────────────────────────
function useLastSurfaceValue() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['user-settings-last-surface', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('last_surface_path, last_surface_at')
        .eq('user_id', user!.id)
        .maybeSingle();
      return data ?? null;
    },
  });
}

function useLatestCalendarSync() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['integration-runs-calendar', user?.id],
    enabled: !!user?.id,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('integration_runs')
        .select('ran_at, status')
        .eq('source', 'calendar')
        .order('ran_at', { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    },
  });
}

function useTodayTasks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['today-tasks', user?.id, todayET()],
    enabled: !!user?.id,
    queryFn: async () => {
      const today = todayET();
      const { data } = await supabase
        .from('tasks')
        .select('id, title, status, priority, due_date')
        .eq('user_id', user!.id)
        .neq('status', 'done')
        .lte('due_date', today)
        .order('priority', { ascending: true })
        .order('due_date', { ascending: true })
        .limit(5);
      return data ?? [];
    },
  });
}

function useDueDrill() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['due-drill', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('ki_mastery')
        .select('ki_id, spider_dimension, next_review_at')
        .eq('user_id', user!.id)
        .lte('next_review_at', new Date().toISOString())
        .order('next_review_at', { ascending: true })
        .limit(1);
      return data?.[0] ?? null;
    },
  });
}

// ── Moment classification (device time + next calendar event) ───────────────
type Moment =
  | { kind: 'briefing' }
  | { kind: 'pre-meeting'; event: any; minutesUntil: number }
  | { kind: 'in-meeting'; event: any }
  | { kind: 'post-meeting'; event: any; minutesSince: number }
  | { kind: 'deep-work' }
  | { kind: 'evening' };

function classifyMoment(events: any[] | undefined): Moment {
  const now = bostonNow();
  const h = now.getHours();
  const nowMs = now.getTime();

  const withTimes = (events ?? [])
    .filter(e => e.start_time)
    .map(e => ({ ...e, _start: new Date(e.start_time).getTime(), _end: e.end_time ? new Date(e.end_time).getTime() : new Date(e.start_time).getTime() + 30 * 60000 }));

  // In-meeting: any event overlapping now.
  const inMtg = withTimes.find(e => e._start <= nowMs && e._end >= nowMs);
  if (inMtg) return { kind: 'in-meeting', event: inMtg };

  // Post-meeting ≤30min.
  const justEnded = withTimes
    .filter(e => e._end < nowMs && nowMs - e._end <= 30 * 60000)
    .sort((a, b) => b._end - a._end)[0];
  if (justEnded) return { kind: 'post-meeting', event: justEnded, minutesSince: Math.round((nowMs - justEnded._end) / 60000) };

  // Pre-meeting ≤20min (upcoming next).
  const nextUpcoming = withTimes.filter(e => e._start > nowMs).sort((a, b) => a._start - b._start)[0];
  if (nextUpcoming) {
    const mins = Math.round((nextUpcoming._start - nowMs) / 60000);
    if (mins <= 20) return { kind: 'pre-meeting', event: nextUpcoming, minutesUntil: mins };
  }

  if (h >= 19) return { kind: 'evening' };
  // Morning until first meeting of the day; if none upcoming and it's early, briefing.
  if (h < 10 && !nextUpcoming) return { kind: 'briefing' };
  if (h < 10) return { kind: 'briefing' };
  return { kind: 'deep-work' };
}

// ── Small primitives ────────────────────────────────────────────────────────
function Panel({ children, className, accent }: { children: React.ReactNode; className?: string; accent?: 'amber' | 'jade' }) {
  return (
    <div
      className={cn(
        T.panel, 'border rounded-2xl p-5',
        accent === 'amber' ? 'border-[#FFA226]/40' : accent === 'jade' ? 'border-[#3DDC97]/40' : T.line,
        className
      )}
    >
      {children}
    </div>
  );
}

function LineChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('text-sm', T.muted, className)}>{children}</div>;
}

// ── The Today page ──────────────────────────────────────────────────────────
export default function Today() {
  const nav = useNavigate();
  useAutoSyncCalendar();
  const events = useCalendarEvents();
  const digest = useDailyDigest();
  const lastSurface = useLastSurfaceValue();
  const calSync = useLatestCalendarSync();
  const syncCal = useSyncCalendar();
  const tasks = useTodayTasks();
  const drill = useDueDrill();

  const moment = useMemo(() => classifyMoment(events.data), [events.data]);

  // Clock re-tick so pre-meeting T-minus stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const syncFresh = calSync.data && Date.now() - new Date(calSync.data.ran_at).getTime() < 60 * 60 * 1000 && calSync.data.status === 'success';
  const syncStale = !calSync.data || !syncFresh;
  const syncMinsAgo = calSync.data ? Math.max(0, Math.round((Date.now() - new Date(calSync.data.ran_at).getTime()) / 60000)) : null;

  const resumePath = lastSurface.data?.last_surface_path;
  const showResume = !!resumePath && !['/', '/today', '/dashboard', '/auth'].includes(resumePath);

  const qc = useQueryClient();
  const staleOverHour = !calSync.data || (Date.now() - new Date(calSync.data.ran_at).getTime() > 60 * 60 * 1000);
  const { pull, refreshing } = usePullToRefresh({
    onRefresh: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['calendar-events'] }),
        qc.invalidateQueries({ queryKey: ['daily-digest'] }),
        qc.invalidateQueries({ queryKey: ['today-tasks'] }),
        qc.invalidateQueries({ queryKey: ['streak'] }),
        qc.invalidateQueries({ queryKey: ['integration-runs'] }),
        qc.invalidateQueries({ queryKey: ['latest-calendar-sync'] }),
      ]);
      if (staleOverHour) {
        try { await syncCal.mutateAsync(); } catch { /* noop */ }
      }
    },
  });

  return (
    <div className={cn('min-h-screen', T.ink, T.text)}>
      {(pull > 0 || refreshing) && (
        <div
          className="fixed top-0 left-0 right-0 z-40 pointer-events-none flex justify-center"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div
            className="h-0.5 bg-[#FFA226] transition-all"
            style={{ width: `${Math.max(refreshing ? 40 : pull * 40, refreshing ? 40 : 0)}%`, opacity: refreshing ? 1 : pull }}
          />
        </div>
      )}
      <div className="mx-auto max-w-2xl px-4 pb-24 pt-4 sm:pt-6">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="font-semibold tracking-tight text-lg">Dynamic</div>
            <StreakChip variant="compact" />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => syncStale && syncCal.mutate()}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                syncFresh ? 'border-[#3DDC97]/40 text-[#3DDC97]' : 'border-[#FFA226]/40 text-[#FFA226] hover:bg-[#FFA226]/10',
              )}
              title={syncFresh ? `Calendar synced ${syncMinsAgo}m ago` : 'Tap to sync calendar'}
            >
              <RefreshCw className={cn('h-3 w-3', syncCal.isPending && 'animate-spin')} />
              {syncCal.isPending ? 'syncing…' : syncFresh ? `${syncMinsAgo}m` : calSync.data ? `stale ${syncMinsAgo}m` : 'sync'}
            </button>
            <Link to={ROUTES.settings} className={cn('p-2 rounded-full hover:bg-white/5', T.muted)} aria-label="Settings">
              <SettingsIcon className="h-4 w-4" />
            </Link>
          </div>
        </header>

        {/* Monumental clock */}
        <div className="mb-6">
          <div className={cn('text-5xl sm:text-6xl font-semibold tracking-tight tabular-nums', T.text)}>
            <ClockBig />
          </div>
          <div className="mt-1">
            <BostonClock />
          </div>
        </div>

        {/* Resume pill */}
        {showResume && (
          <button
            onClick={() => nav(resumePath!)}
            className={cn(
              'mb-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs',
              'border-[#26313F] hover:border-[#3DDC97]/40', T.muted
            )}
          >
            Resume · <span className={T.text}>{friendlySurface(resumePath!)}</span>
            <ChevronRight className="h-3 w-3" />
          </button>
        )}

        {/* Dispatch stack */}
        <div className="space-y-3">
          <MomentTile
            moment={moment}
            digest={digest}
            eventsLoading={events.isLoading}
            onOpenBrief={() => nav(ROUTES.brief)}
            onOpenMeeting={() => nav(ROUTES.meeting)}
            onOpenPostCall={() => nav(ROUTES.postCall)}
            onOpenCarMode={() => nav(ROUTES.carMode)}
          />

          {/* Next-action tile — only in working hours and no imminent meeting card */}
          {moment.kind !== 'pre-meeting' && moment.kind !== 'in-meeting' && (
            <NextActionTile
              loading={tasks.isLoading}
              task={tasks.data?.[0]}
              onOpen={() => nav('/tasks')}
            />
          )}

          {/* Evening rep tile */}
          {moment.kind === 'evening' && (
            <EveningRepTile
              loading={drill.isLoading}
              drill={drill.data}
              onOpen={() => nav(ROUTES.carMode)}
            />
          )}
        </div>

        {/* Two doors */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <DoorTile
            title="Work"
            icon={Target}
            line={tasks.isLoading ? 'loading…' : tasks.data && tasks.data.length > 0 ? `${tasks.data.length} open` : 'Clear'}
            onClick={() => nav(ROUTES.work)}
            accent="amber"
          />
          <DoorTile
            title="Train"
            icon={GraduationCap}
            line={<StreakDoorLine />}
            onClick={() => nav(ROUTES.train)}
            accent="jade"
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function ClockBig() {
  const [now, setNow] = useState(bostonNow());
  useEffect(() => {
    const id = setInterval(() => setNow(bostonNow()), 15_000);
    return () => clearInterval(id);
  }, []);
  const h12 = now.getHours() % 12 || 12;
  const mm = now.getMinutes().toString().padStart(2, '0');
  return <span>{h12}:{mm}</span>;
}

function StreakDoorLine() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['streak-door', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from('streak_summary').select('current_checkin_streak,current_performance_streak').eq('user_id', user!.id).maybeSingle();
      return data;
    },
  });
  if (!data) return <>Start the streak</>;
  return <>{data.current_checkin_streak}d check-in · {data.current_performance_streak}d goals</>;
}

function MomentTile({
  moment, digest, eventsLoading, onOpenBrief, onOpenMeeting, onOpenPostCall,
}: {
  moment: Moment;
  digest: ReturnType<typeof useDailyDigest>;
  eventsLoading: boolean;
  onOpenBrief: () => void;
  onOpenMeeting: () => void;
  onOpenPostCall: () => void;
  onOpenCarMode: () => void;
}) {
  if (eventsLoading && (moment.kind === 'deep-work' || moment.kind === 'briefing')) {
    return <Panel><div className="h-16 animate-pulse rounded-md bg-white/5" /></Panel>;
  }

  if (moment.kind === 'pre-meeting') {
    const e = moment.event;
    return (
      <Panel accent="amber">
        <div className="flex items-center gap-2 text-xs mb-1">
          <Calendar className="h-3.5 w-3.5 text-[#FFA226]" />
          <span className={T.amber}>Next up · T-{Math.max(1, moment.minutesUntil)}m</span>
        </div>
        <div className="text-xl font-semibold leading-tight">{e.title || 'Untitled meeting'}</div>
        <div className={cn('text-sm mt-0.5', T.muted)}>{formatTimeET(e.start_time)}{e.location ? ` · ${e.location}` : ''}</div>
        <button
          onClick={onOpenBrief}
          className={cn('mt-4 w-full h-12 rounded-xl text-sm font-medium', T.amberBg, 'text-[#0B0F14] hover:opacity-90')}
        >
          Brief ready →
        </button>
      </Panel>
    );
  }

  if (moment.kind === 'in-meeting') {
    const e = moment.event;
    return (
      <Panel>
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className={cn('text-xs mb-0.5 flex items-center gap-1.5', T.live)}>
              <span className="h-1.5 w-1.5 rounded-full bg-[#FF5C5C] animate-pulse" /> Live
            </div>
            <div className="truncate text-base font-medium">{e.title || 'Meeting'}</div>
          </div>
          <button onClick={onOpenMeeting} className={cn('shrink-0 h-10 px-4 rounded-lg text-sm font-medium border', T.line, T.text, 'hover:bg-white/5')}>
            Meeting Mode
          </button>
        </div>
      </Panel>
    );
  }

  if (moment.kind === 'post-meeting') {
    const e = moment.event;
    return (
      <Panel accent="amber">
        <div className={cn('text-xs mb-1', T.amber)}>Just wrapped · {moment.minutesSince}m ago</div>
        <div className="text-xl font-semibold leading-tight">{e.title || 'Meeting'}</div>
        <button
          onClick={onOpenPostCall}
          className={cn('mt-4 w-full h-12 rounded-xl text-sm font-medium', T.amberBg, 'text-[#0B0F14] hover:opacity-90')}
        >
          Log it while it's hot →
        </button>
      </Panel>
    );
  }

  if (moment.kind === 'briefing') {
    if (digest.isLoading) return <Panel><div className="h-24 animate-pulse rounded-md bg-white/5" /></Panel>;
    const items = digest.items ?? [];
    return (
      <Panel>
        <div className="flex items-center gap-2 text-xs mb-2">
          <Newspaper className={cn('h-3.5 w-3.5', T.muted)} />
          <span className={T.muted}>Morning briefing</span>
        </div>
        {items.length === 0 ? (
          <div>
            <div className="text-lg font-medium leading-snug">Your briefing builds overnight.</div>
            <div className={cn('text-sm mt-1', T.muted)}>The first one lands tomorrow at 6:30 ET.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {items.slice(0, 3).map((it) => (
              <div key={it.id}>
                <div className={cn('text-xs', T.muted)}>{it.accountName}</div>
                <div className="text-sm font-medium leading-snug">{it.headline}</div>
                {it.summary && <div className={cn('text-xs mt-0.5 line-clamp-2', T.muted)}>{it.summary}</div>}
              </div>
            ))}
            {items.length > 3 && (
              <div className={cn('text-xs pt-1', T.muted)}>+{items.length - 3} more</div>
            )}
          </div>
        )}
      </Panel>
    );
  }

  // deep-work / evening default line
  return (
    <Panel>
      <div className="flex items-center gap-2">
        <Calendar className={cn('h-4 w-4', T.muted)} />
        <div>
          <div className="text-base font-medium">Deep work day</div>
          <div className={cn('text-sm', T.muted)}>No meetings scheduled — protect the block.</div>
        </div>
      </div>
    </Panel>
  );
}

function NextActionTile({ loading, task, onOpen }: { loading: boolean; task: any; onOpen: () => void }) {
  if (loading) return <Panel><div className="h-14 animate-pulse rounded-md bg-white/5" /></Panel>;
  if (!task) {
    return (
      <Panel>
        <div className="flex items-center gap-2">
          <ListTodo className={cn('h-4 w-4', T.muted)} />
          <div>
            <div className="text-base font-medium">Nothing on the list.</div>
            <div className={cn('text-sm', T.muted)}>Pick the next move — Work is one tap away.</div>
          </div>
        </div>
      </Panel>
    );
  }
  return (
    <button onClick={onOpen} className="w-full text-left">
      <Panel>
        <div className="flex items-center gap-2 text-xs mb-1">
          <ListTodo className={cn('h-3.5 w-3.5', T.muted)} />
          <span className={T.muted}>Next action</span>
        </div>
        <div className="text-base font-medium leading-snug">{task.title}</div>
        {task.priority && <div className={cn('text-xs mt-0.5', T.muted)}>Priority · {task.priority}</div>}
      </Panel>
    </button>
  );
}

function EveningRepTile({ loading, drill, onOpen }: { loading: boolean; drill: any; onOpen: () => void }) {
  if (loading) return <Panel accent="jade"><div className="h-14 animate-pulse rounded-md bg-white/5" /></Panel>;
  if (!drill) {
    return (
      <Panel accent="jade">
        <div className="flex items-center gap-2">
          <Dumbbell className={cn('h-4 w-4', T.jade)} />
          <div>
            <div className="text-base font-medium">Nothing due tonight.</div>
            <div className={cn('text-sm', T.muted)}>Sharpen anything — Train is open.</div>
          </div>
        </div>
      </Panel>
    );
  }
  return (
    <button onClick={onOpen} className="w-full text-left">
      <Panel accent="jade">
        <div className={cn('flex items-center gap-2 text-xs mb-1', T.jade)}>
          <Dumbbell className="h-3.5 w-3.5" /> Evening rep
        </div>
        <div className="text-base font-medium leading-snug">One drill ready · {drill.spider_dimension ?? 'skill'}</div>
        <div className={cn('text-xs mt-0.5', T.muted)}>Tap for Car Mode → one round.</div>
      </Panel>
    </button>
  );
}

function DoorTile({
  title, icon: Icon, line, onClick, accent,
}: {
  title: string;
  icon: React.ElementType;
  line: React.ReactNode;
  onClick: () => void;
  accent: 'amber' | 'jade';
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        T.panel, 'rounded-2xl p-5 text-left border transition-colors',
        accent === 'amber' ? 'border-[#26313F] hover:border-[#FFA226]/50' : 'border-[#26313F] hover:border-[#3DDC97]/50'
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon className={cn('h-4 w-4', accent === 'amber' ? T.amber : T.jade)} />
        <div className="text-xl font-semibold">{title}</div>
      </div>
      <LineChip>{line}</LineChip>
    </button>
  );
}

/**
 * Shared Comparison Engine — single source of truth for all
 * period-aligned metric comparisons across the app.
 *
 * Handles: time alignment, data fetching, aggregation, delta computation.
 * Consumers (Dave, dashboard widgets, hooks) call this and interpret results.
 */

import { supabase } from '@/integrations/supabase/client';

// ── Public types ────────────────────────────────────────────────

export type PeriodType = 'day' | 'week' | 'month' | 'quarter' | 'rolling-7' | 'rolling-30';
export type ComparisonMode = 'to-date' | 'full-period';

export interface PeriodBounds {
  start: string; // yyyy-MM-dd
  end: string;
}

export interface PeriodPairResult {
  current: PeriodBounds;
  previous: PeriodBounds;
  currentLabel: string;
  previousLabel: string;
  comparisonMode: ComparisonMode;
}

export type ConfidenceLevel = 'high' | 'moderate' | 'low';

export interface MetricComparison {
  metric: string;
  label: string;
  currentValue: number;
  previousValue: number;
  delta: number;
  percentChange: number | null; // null when previousValue is 0
  trend: 'up' | 'down' | 'flat';
  confidenceLevel: ConfidenceLevel;
  isRate?: boolean;
  periodType?: PeriodType;
  contextLabel?: string;
}

export interface ComparisonResult {
  currentLabel: string;
  previousLabel: string;
  comparisonMode: ComparisonMode;
  periodType: PeriodType;
  metrics: MetricComparison[];
  topImprovement: MetricComparison | null;
  topDecline: MetricComparison | null;
  overallConfidence: ConfidenceLevel;
}

export interface AggregatedMetrics {
  dials: number;
  conversations: number;
  prospects: number;
  meetingsSet: number;
  meetingsHeld: number;
  oppsCreated: number;
  prospectingMinutes: number;
  pipelineMoved: number;
  avgScore: number | null;
  dialToConvo: number | null;
  convoToMeeting: number | null;
  days: number;
  avgRecovery: number | null;
  avgSleep: number | null;
  avgStrain: number | null;
}

// ── Date helpers ────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function addDays(d: string, n: number): string {
  const dt = new Date(d + 'T12:00:00');
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().split('T')[0];
}

function mondayOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(m.getDate() + diff);
  return m;
}

function fmt(d: Date): string {
  return d.toISOString().split('T')[0];
}

function quarterStart(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}

function quarterEnd(d: Date): Date {
  const qs = quarterStart(d);
  return new Date(qs.getFullYear(), qs.getMonth() + 3, 0);
}

// ── Period alignment ────────────────────────────────────────────

export function getPeriodPair(type: PeriodType, _offset = 0): PeriodPairResult {
  const now = new Date();
  const td = todayStr();

  switch (type) {
    case 'day': {
      const cur = addDays(td, -_offset);
      const prev = addDays(cur, -1);
      return {
        current: { start: cur, end: cur },
        previous: { start: prev, end: prev },
        currentLabel: _offset === 0 ? 'today' : _offset === 1 ? 'yesterday' : `${_offset}d ago`,
        previousLabel: _offset === 0 ? 'yesterday' : _offset === 1 ? 'the day before' : `${_offset + 1}d ago`,
        comparisonMode: 'full-period',
      };
    }
    case 'week': {
      const mon = mondayOfWeek(now);
      const curStart = fmt(mon);
      const curEnd = addDays(curStart, 6);
      const isCurrentWeek = td >= curStart && td <= curEnd;

      if (isCurrentWeek) {
        const daysSoFar = Math.floor((now.getTime() - mon.getTime()) / 86400000);
        const prevStart = addDays(curStart, -7);
        const prevEnd = addDays(prevStart, daysSoFar);
        return {
          current: { start: curStart, end: td },
          previous: { start: prevStart, end: prevEnd },
          currentLabel: 'this week to date',
          previousLabel: 'same point last week',
          comparisonMode: 'to-date',
        };
      }
      const lastMonStart = addDays(curStart, -7);
      const lastMonEnd = addDays(lastMonStart, 6);
      const priorStart = addDays(lastMonStart, -7);
      const priorEnd = addDays(priorStart, 6);
      return {
        current: { start: lastMonStart, end: lastMonEnd },
        previous: { start: priorStart, end: priorEnd },
        currentLabel: 'last full week',
        previousLabel: 'the week before',
        comparisonMode: 'full-period',
      };
    }
    case 'month': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const curMonStart = fmt(monthStart);
      const curMonEnd = fmt(monthEnd);
      const isCurrentMonth = td >= curMonStart && td <= curMonEnd;

      if (isCurrentMonth) {
        const dayOfMonth = now.getDate();
        const prevMonStart = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
        const alignedDay = Math.min(dayOfMonth, prevMonthLastDay);
        const prevMonEnd = fmt(new Date(now.getFullYear(), now.getMonth() - 1, alignedDay));
        return {
          current: { start: curMonStart, end: td },
          previous: { start: prevMonStart, end: prevMonEnd },
          currentLabel: 'this month to date',
          previousLabel: 'same point last month',
          comparisonMode: 'to-date',
        };
      }
      const lastMonS = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const lastMonE = fmt(new Date(now.getFullYear(), now.getMonth(), 0));
      const priorMonS = fmt(new Date(now.getFullYear(), now.getMonth() - 2, 1));
      const priorMonE = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 0));
      return {
        current: { start: lastMonS, end: lastMonE },
        previous: { start: priorMonS, end: priorMonE },
        currentLabel: 'last full month',
        previousLabel: 'the month before',
        comparisonMode: 'full-period',
      };
    }
    case 'quarter': {
      const qs = quarterStart(now);
      const qe = quarterEnd(now);
      const curQStart = fmt(qs);
      const curQEnd = fmt(qe);
      const isCurrentQuarter = td >= curQStart && td <= curQEnd;

      if (isCurrentQuarter) {
        const elapsed = Math.floor((now.getTime() - qs.getTime()) / 86400000);
        const prevQStart = new Date(qs.getFullYear(), qs.getMonth() - 3, 1);
        const prevQStartStr = fmt(prevQStart);
        const prevQEnd = addDays(prevQStartStr, elapsed);
        return {
          current: { start: curQStart, end: td },
          previous: { start: prevQStartStr, end: prevQEnd },
          currentLabel: 'this quarter to date',
          previousLabel: 'same point last quarter',
          comparisonMode: 'to-date',
        };
      }
      const lastQS = new Date(qs.getFullYear(), qs.getMonth() - 3, 1);
      const lastQE = new Date(qs.getFullYear(), qs.getMonth(), 0);
      const priorQS = new Date(qs.getFullYear(), qs.getMonth() - 6, 1);
      const priorQE = new Date(qs.getFullYear(), qs.getMonth() - 3, 0);
      return {
        current: { start: fmt(lastQS), end: fmt(lastQE) },
        previous: { start: fmt(priorQS), end: fmt(priorQE) },
        currentLabel: 'last full quarter',
        previousLabel: 'the quarter before',
        comparisonMode: 'full-period',
      };
    }
    case 'rolling-7': {
      const curEnd = td;
      const curStart = addDays(curEnd, -6);
      const prevEnd = addDays(curStart, -1);
      const prevStart = addDays(prevEnd, -6);
      return {
        current: { start: curStart, end: curEnd },
        previous: { start: prevStart, end: prevEnd },
        currentLabel: 'last 7 days',
        previousLabel: 'prior 7 days',
        comparisonMode: 'full-period',
      };
    }
    case 'rolling-30': {
      const curEnd = td;
      const curStart = addDays(curEnd, -29);
      const prevEnd = addDays(curStart, -1);
      const prevStart = addDays(prevEnd, -29);
      return {
        current: { start: curStart, end: curEnd },
        previous: { start: prevStart, end: prevEnd },
        currentLabel: 'last 30 days',
        previousLabel: 'prior 30 days',
        comparisonMode: 'full-period',
      };
    }
  }
}

// ── Data fetching ───────────────────────────────────────────────

interface JournalRow {
  date: string;
  dials: number;
  conversations: number;
  prospects_added: number;
  meetings_set: number;
  customer_meetings_held: number;
  opportunities_created: number;
  prospecting_block_minutes: number;
  pipeline_moved: number | null;
  daily_score: number | null;
}

interface WhoopRow {
  date: string;
  recovery_score: number | null;
  sleep_score: number | null;
  strain_score: number | null;
}

async function fetchJournal(userId: string, start: string, end: string): Promise<JournalRow[]> {
  const { data } = await supabase
    .from('daily_journal_entries')
    .select('date, dials, conversations, prospects_added, meetings_set, customer_meetings_held, opportunities_created, prospecting_block_minutes, pipeline_moved, daily_score')
    .eq('user_id', userId)
    .eq('checked_in', true)
    .gte('date', start)
    .lte('date', end)
    .order('date');
  return (data as JournalRow[] | null) || [];
}

async function fetchWhoop(userId: string, start: string, end: string): Promise<WhoopRow[]> {
  const { data } = await supabase
    .from('whoop_daily_metrics')
    .select('date, recovery_score, sleep_score, strain_score')
    .eq('user_id', userId)
    .gte('date', start)
    .lte('date', end)
    .order('date');
  return (data as WhoopRow[] | null) || [];
}

// ── Aggregation ─────────────────────────────────────────────────

function sum(arr: number[]): number { return arr.reduce((a, b) => a + b, 0); }
function avg(arr: number[]): number { return arr.length ? sum(arr) / arr.length : 0; }
function nonNull(arr: (number | null)[]): number[] { return arr.filter((v): v is number => v !== null && v !== undefined); }

export function aggregateMetrics(journal: JournalRow[], whoop: WhoopRow[]): AggregatedMetrics {
  const dials = sum(journal.map(j => j.dials || 0));
  const conversations = sum(journal.map(j => j.conversations || 0));
  const prospects = sum(journal.map(j => j.prospects_added || 0));
  const meetingsSet = sum(journal.map(j => j.meetings_set || 0));
  const meetingsHeld = sum(journal.map(j => j.customer_meetings_held || 0));
  const oppsCreated = sum(journal.map(j => j.opportunities_created || 0));
  const prospectingMinutes = sum(journal.map(j => j.prospecting_block_minutes || 0));
  const pipelineMoved = sum(journal.map(j => Number(j.pipeline_moved || 0)));
  const scores = nonNull(journal.map(j => j.daily_score));
  const avgScore = scores.length ? Math.round(avg(scores) * 10) / 10 : null;

  const recoveries = nonNull(whoop.map(w => w.recovery_score ? Number(w.recovery_score) : null));
  const sleeps = nonNull(whoop.map(w => w.sleep_score ? Number(w.sleep_score) : null));
  const strains = nonNull(whoop.map(w => w.strain_score ? Number(w.strain_score) : null));

  return {
    dials, conversations, prospects, meetingsSet, meetingsHeld, oppsCreated,
    prospectingMinutes, pipelineMoved, avgScore,
    dialToConvo: dials > 0 ? Math.round((conversations / dials) * 1000) / 10 : null,
    convoToMeeting: conversations > 0 ? Math.round((meetingsSet / conversations) * 1000) / 10 : null,
    days: journal.length,
    avgRecovery: recoveries.length ? Math.round(avg(recoveries)) : null,
    avgSleep: sleeps.length ? Math.round(avg(sleeps)) : null,
    avgStrain: strains.length ? Math.round(avg(strains) * 10) / 10 : null,
  };
}

// ── Comparison builder ──────────────────────────────────────────

function compareMetric(
  label: string, metric: string,
  a: number | null, b: number | null,
  isRate: boolean, periodType: PeriodType, contextLabel: string,
): MetricComparison | null {
  if (a === null && b === null) return null;
  const va = a ?? 0;
  const vb = b ?? 0;
  const delta = va - vb;
  const percentChange = vb !== 0 ? Math.round((delta / Math.abs(vb)) * 1000) / 10 : (va > 0 ? 100 : null);
  const trend: 'up' | 'down' | 'flat' = Math.abs(delta) < 0.01 ? 'flat' : delta > 0 ? 'up' : 'down';
  return { metric, label, currentValue: va, previousValue: vb, delta, percentChange, trend, isRate, periodType, contextLabel };
}

function buildMetricComparisons(
  current: AggregatedMetrics, previous: AggregatedMetrics,
  periodType: PeriodType, contextLabel: string,
): MetricComparison[] {
  const pairs: [string, string, number | null, number | null, boolean][] = [
    ['Dials', 'dials', current.dials, previous.dials, false],
    ['Conversations', 'conversations', current.conversations, previous.conversations, false],
    ['Dial-to-Conversation Rate', 'dialToConvo', current.dialToConvo, previous.dialToConvo, true],
    ['Meetings Set', 'meetingsSet', current.meetingsSet, previous.meetingsSet, false],
    ['Meetings Held', 'meetingsHeld', current.meetingsHeld, previous.meetingsHeld, false],
    ['Conversation-to-Meeting Rate', 'convoToMeeting', current.convoToMeeting, previous.convoToMeeting, true],
    ['Opportunities Created', 'oppsCreated', current.oppsCreated, previous.oppsCreated, false],
    ['Prospects Added', 'prospects', current.prospects, previous.prospects, false],
    ['Prospecting Minutes', 'prospectingMinutes', current.prospectingMinutes, previous.prospectingMinutes, false],
    ['Pipeline Moved', 'pipelineMoved', current.pipelineMoved, previous.pipelineMoved, false],
    ['Avg Daily Score', 'avgScore', current.avgScore, previous.avgScore, false],
    ['Avg Recovery', 'avgRecovery', current.avgRecovery, previous.avgRecovery, false],
    ['Avg Sleep Score', 'avgSleep', current.avgSleep, previous.avgSleep, false],
    ['Avg Strain', 'avgStrain', current.avgStrain, previous.avgStrain, false],
  ];

  return pairs
    .map(([label, metric, a, b, isRate]) => compareMetric(label, metric, a, b, isRate, periodType, contextLabel))
    .filter((c): c is MetricComparison => c !== null);
}

// ── Main public API ─────────────────────────────────────────────

/**
 * Run a full comparison for a given period type.
 * Returns structured result with all metrics, top movers, and labels.
 */
export async function runComparison(
  userId: string,
  periodType: PeriodType,
): Promise<ComparisonResult | null> {
  const pair = getPeriodPair(periodType);
  const contextLabel = `${pair.currentLabel}_vs_${pair.previousLabel}`.replace(/\s+/g, '_');

  const [curJournal, prevJournal, curWhoop, prevWhoop] = await Promise.all([
    fetchJournal(userId, pair.current.start, pair.current.end),
    fetchJournal(userId, pair.previous.start, pair.previous.end),
    fetchWhoop(userId, pair.current.start, pair.current.end),
    fetchWhoop(userId, pair.previous.start, pair.previous.end),
  ]);

  if (!curJournal.length && !prevJournal.length) return null;

  const curAgg = aggregateMetrics(curJournal, curWhoop);
  const prevAgg = aggregateMetrics(prevJournal, prevWhoop);
  const metrics = buildMetricComparisons(curAgg, prevAgg, periodType, contextLabel);

  const withPct = metrics.filter(c => c.percentChange !== null && c.trend !== 'flat' && (c.currentValue + c.previousValue) > 0);
  const improvements = withPct.filter(c => c.trend === 'up').sort((a, b) => (b.percentChange || 0) - (a.percentChange || 0));
  const declines = withPct.filter(c => c.trend === 'down').sort((a, b) => (a.percentChange || 0) - (b.percentChange || 0));

  return {
    currentLabel: pair.currentLabel,
    previousLabel: pair.previousLabel,
    comparisonMode: pair.comparisonMode,
    periodType,
    metrics,
    topImprovement: improvements[0] || null,
    topDecline: declines[0] || null,
  };
}

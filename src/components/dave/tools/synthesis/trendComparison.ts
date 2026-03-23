/**
 * Trend & Comparison engine for Dave.
 * Compares work metrics and WHOOP biometrics across time periods,
 * returning deltas, interpretations, and recommendations.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';

// ── Types ───────────────────────────────────────────────────────

export interface MetricComparison {
  metric: string;
  label: string;
  periodA: number;
  periodB: number;
  delta: number;
  pctChange: number | null; // null when periodB is 0
  direction: 'up' | 'down' | 'flat';
  isRate?: boolean;
}

export interface ComparisonResult {
  periodALabel: string;
  periodBLabel: string;
  comparisonMode: ComparisonMode;
  metrics: MetricComparison[];
  topImprovement: MetricComparison | null;
  topDecline: MetricComparison | null;
}

type PeriodType = 'day' | 'week' | 'month' | 'quarter' | 'rolling-7' | 'rolling-30';
type ComparisonMode = 'to-date' | 'full-period';

interface PeriodBounds {
  start: string; // yyyy-MM-dd
  end: string;
}

// ── Period math ─────────────────────────────────────────────────

function today(): string {
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

interface PeriodPairResult {
  current: PeriodBounds;
  previous: PeriodBounds;
  currentLabel: string;
  previousLabel: string;
  comparisonMode: ComparisonMode;
}

function getPeriodPair(type: PeriodType, offset = 0): PeriodPairResult {
  const now = new Date();
  const todayStr = today();

  switch (type) {
    case 'day': {
      const cur = addDays(todayStr, -offset);
      const prev = addDays(cur, -1);
      return {
        current: { start: cur, end: cur },
        previous: { start: prev, end: prev },
        currentLabel: offset === 0 ? 'today' : offset === 1 ? 'yesterday' : `${offset}d ago`,
        previousLabel: offset === 0 ? 'yesterday' : offset === 1 ? 'the day before' : `${offset + 1}d ago`,
        comparisonMode: 'full-period',
      };
    }
    case 'week': {
      const mon = mondayOfWeek(now);
      const curStart = fmt(mon);
      const curEnd = addDays(curStart, 6);
      const isCurrentWeek = todayStr >= curStart && todayStr <= curEnd;

      if (isCurrentWeek) {
        // To-date: Mon..today vs same span last week
        const daysSoFar = Math.floor((now.getTime() - mon.getTime()) / 86400000);
        const prevStart = addDays(curStart, -7);
        const prevEnd = addDays(prevStart, daysSoFar);
        return {
          current: { start: curStart, end: todayStr },
          previous: { start: prevStart, end: prevEnd },
          currentLabel: 'this week to date',
          previousLabel: 'same point last week',
          comparisonMode: 'to-date',
        };
      }
      // Full week vs full week (comparing last full week vs prior)
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
      const isCurrentMonth = todayStr >= curMonStart && todayStr <= curMonEnd;

      if (isCurrentMonth) {
        // To-date: 1st..today vs 1st..same day last month
        const dayOfMonth = now.getDate();
        const prevMonStart = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
        const alignedDay = Math.min(dayOfMonth, prevMonthLastDay);
        const prevMonEnd = fmt(new Date(now.getFullYear(), now.getMonth() - 1, alignedDay));
        return {
          current: { start: curMonStart, end: todayStr },
          previous: { start: prevMonStart, end: prevMonEnd },
          currentLabel: 'this month to date',
          previousLabel: 'same point last month',
          comparisonMode: 'to-date',
        };
      }
      // Full month vs full month
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
      const isCurrentQuarter = todayStr >= curQStart && todayStr <= curQEnd;

      if (isCurrentQuarter) {
        // To-date: quarter start..today vs same elapsed days last quarter
        const elapsed = Math.floor((now.getTime() - qs.getTime()) / 86400000);
        const prevQStart = new Date(qs.getFullYear(), qs.getMonth() - 3, 1);
        const prevQStartStr = fmt(prevQStart);
        const prevQEnd = addDays(prevQStartStr, elapsed);
        return {
          current: { start: curQStart, end: todayStr },
          previous: { start: prevQStartStr, end: prevQEnd },
          currentLabel: 'this quarter to date',
          previousLabel: 'same point last quarter',
          comparisonMode: 'to-date',
        };
      }
      // Full quarter vs full quarter
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
      const curEnd = todayStr;
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
      const curEnd = todayStr;
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

// ── Data fetch ──────────────────────────────────────────────────

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

interface AggregatedMetrics {
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
  // WHOOP
  avgRecovery: number | null;
  avgSleep: number | null;
  avgStrain: number | null;
}

function aggregate(journal: JournalRow[], whoop: WhoopRow[]): AggregatedMetrics {
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

function compare(label: string, metric: string, a: number | null, b: number | null, isRate = false): MetricComparison | null {
  if (a === null && b === null) return null;
  const va = a ?? 0;
  const vb = b ?? 0;
  const delta = va - vb;
  const pctChange = vb !== 0 ? Math.round((delta / Math.abs(vb)) * 1000) / 10 : (va > 0 ? 100 : null);
  const direction: 'up' | 'down' | 'flat' = Math.abs(delta) < 0.01 ? 'flat' : delta > 0 ? 'up' : 'down';
  return { metric, label, periodA: va, periodB: vb, delta, pctChange, direction, isRate };
}

function buildComparisons(current: AggregatedMetrics, previous: AggregatedMetrics): MetricComparison[] {
  const pairs: [string, string, number | null, number | null, boolean?][] = [
    ['Dials', 'dials', current.dials, previous.dials],
    ['Conversations', 'conversations', current.conversations, previous.conversations],
    ['Dial-to-Conversation Rate', 'dialToConvo', current.dialToConvo, previous.dialToConvo, true],
    ['Meetings Set', 'meetingsSet', current.meetingsSet, previous.meetingsSet],
    ['Meetings Held', 'meetingsHeld', current.meetingsHeld, previous.meetingsHeld],
    ['Conversation-to-Meeting Rate', 'convoToMeeting', current.convoToMeeting, previous.convoToMeeting, true],
    ['Opportunities Created', 'oppsCreated', current.oppsCreated, previous.oppsCreated],
    ['Prospects Added', 'prospects', current.prospects, previous.prospects],
    ['Prospecting Minutes', 'prospectingMinutes', current.prospectingMinutes, previous.prospectingMinutes],
    ['Pipeline Moved', 'pipelineMoved', current.pipelineMoved, previous.pipelineMoved],
    ['Avg Daily Score', 'avgScore', current.avgScore, previous.avgScore],
    ['Avg Recovery', 'avgRecovery', current.avgRecovery, previous.avgRecovery],
    ['Avg Sleep Score', 'avgSleep', current.avgSleep, previous.avgSleep],
    ['Avg Strain', 'avgStrain', current.avgStrain, previous.avgStrain],
  ];

  return pairs
    .map(([label, metric, a, b, isRate]) => compare(label, metric, a, b, isRate ?? false))
    .filter((c): c is MetricComparison => c !== null);
}

// ── Natural language interpretation ─────────────────────────────

function interpretComparisons(result: ComparisonResult): string {
  const { metrics, periodALabel, periodBLabel } = result;

  const meaningful = metrics.filter(m => m.direction !== 'flat' && m.periodA + m.periodB > 0);
  if (!meaningful.length) return `Metrics look pretty flat between ${periodBLabel} and ${periodALabel}. Not enough change to call out.`;

  const ups = meaningful.filter(m => m.direction === 'up');
  const downs = meaningful.filter(m => m.direction === 'down');

  const sentences: string[] = [];

  // Top improvement
  if (result.topImprovement) {
    const m = result.topImprovement;
    const pct = m.pctChange !== null ? `${m.pctChange > 0 ? '+' : ''}${m.pctChange}%` : '';
    sentences.push(`Your biggest improvement is ${m.label} — ${formatVal(m)} ${pct}.`);
  }

  // Top decline
  if (result.topDecline) {
    const m = result.topDecline;
    const pct = m.pctChange !== null ? `${m.pctChange}%` : '';
    sentences.push(`Biggest drop is ${m.label} — ${formatVal(m)} ${pct}.`);
  }

  // Efficiency insight
  const dialsM = metrics.find(m => m.metric === 'dials');
  const convosM = metrics.find(m => m.metric === 'conversations');
  const rateM = metrics.find(m => m.metric === 'dialToConvo');
  if (dialsM && convosM && rateM) {
    if (dialsM.direction === 'up' && rateM.direction === 'down') {
      sentences.push(`You're dialing more but converting fewer — might be worth checking call quality or targeting.`);
    } else if (dialsM.direction === 'down' && rateM.direction === 'up') {
      sentences.push(`Fewer dials but better conversion — quality over quantity is working.`);
    } else if (dialsM.direction === 'up' && rateM.direction === 'up') {
      sentences.push(`More activity and better conversion — that's the ideal combination.`);
    }
  }

  // WHOOP + performance cross-correlation
  const recoveryM = metrics.find(m => m.metric === 'avgRecovery');
  const scoreM = metrics.find(m => m.metric === 'avgScore');
  if (recoveryM && scoreM && recoveryM.direction !== 'flat' && scoreM.direction !== 'flat') {
    if (recoveryM.direction === 'down' && scoreM.direction === 'down') {
      sentences.push(`Both recovery and daily scores dropped — rest might be the lever here.`);
    } else if (recoveryM.direction === 'up' && scoreM.direction === 'up') {
      sentences.push(`Recovery is up and so are your scores — the body-performance link is real.`);
    } else if (recoveryM.direction === 'down' && scoreM.direction === 'up') {
      sentences.push(`Interesting — scores are up despite lower recovery. You're grinding, but watch for burnout.`);
    } else if (recoveryM.direction === 'up' && scoreM.direction === 'down') {
      sentences.push(`Better recovery but scores are down — might be a focus or strategy issue, not energy.`);
    }
  }

  // Summary counts
  if (ups.length && downs.length) {
    sentences.push(`Overall, ${ups.length} metric${ups.length > 1 ? 's' : ''} improved and ${downs.length} declined compared to ${periodBLabel}.`);
  } else if (ups.length) {
    sentences.push(`All ${ups.length} tracked metrics moved in the right direction.`);
  } else if (downs.length) {
    sentences.push(`${downs.length} metric${downs.length > 1 ? 's' : ''} declined — worth reviewing what changed.`);
  }

  return sentences.join(' ');
}

function formatVal(m: MetricComparison): string {
  if (m.isRate) return `${m.periodA}% vs ${m.periodB}%`;
  return `${m.periodA} vs ${m.periodB}`;
}

// ── NLP period detection ────────────────────────────────────────

function detectPeriod(question: string): PeriodType {
  const q = question.toLowerCase();
  if (q.includes('yesterday') || q.includes('day before') || q.includes('today vs')) return 'day';
  if (q.includes('quarter')) return 'quarter';
  if (q.includes('month over month') || q.includes('this month') || q.includes('last month')) return 'month';
  if (q.includes('rolling 30') || q.includes('30-day') || q.includes('30 day')) return 'rolling-30';
  if (q.includes('rolling 7') || q.includes('7-day') || q.includes('7 day')) return 'rolling-7';
  return 'week'; // default
}

function detectMetricFocus(question: string): string | null {
  const q = question.toLowerCase();
  if (q.includes('dial')) return 'dials';
  if (q.includes('conversation') || q.includes('connect')) return 'conversations';
  if (q.includes('meeting')) return 'meetingsSet';
  if (q.includes('opportunit') || q.includes('opp')) return 'oppsCreated';
  if (q.includes('pipeline')) return 'pipelineMoved';
  if (q.includes('prospect')) return 'prospects';
  if (q.includes('conversion') || q.includes('rate')) return 'dialToConvo';
  if (q.includes('sleep')) return 'avgSleep';
  if (q.includes('recovery') || q.includes('recover')) return 'avgRecovery';
  if (q.includes('strain')) return 'avgStrain';
  if (q.includes('score') || q.includes('performance')) return 'avgScore';
  return null;
}

function wantsDetail(question: string): boolean {
  const q = question.toLowerCase();
  return q.includes('detail') || q.includes('break') || q.includes('drill') || q.includes('deep') || q.includes('every metric') || q.includes('all metric');
}

// ── Public tool function ────────────────────────────────────────

export async function compareTrends(ctx: ToolContext, params: { question?: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const question = params.question || 'How am I doing this week vs last week?';
  const periodType = detectPeriod(question);
  const focus = detectMetricFocus(question);
  const detail = wantsDetail(question);
  const { current, previous, currentLabel, previousLabel, comparisonMode } = getPeriodPair(periodType);

  // Fetch data for both periods in parallel
  const [curJournal, prevJournal, curWhoop, prevWhoop] = await Promise.all([
    fetchJournal(userId, current.start, current.end),
    fetchJournal(userId, previous.start, previous.end),
    fetchWhoop(userId, current.start, current.end),
    fetchWhoop(userId, previous.start, previous.end),
  ]);

  if (!curJournal.length && !prevJournal.length) {
    return `I don't have enough check-in data to compare ${currentLabel} vs ${previousLabel}. Keep logging and I'll be able to spot trends.`;
  }

  const curAgg = aggregate(curJournal, curWhoop);
  const prevAgg = aggregate(prevJournal, prevWhoop);
  const comparisons = buildComparisons(curAgg, prevAgg);

  // Find top improvement and decline (by absolute pct change)
  const withPct = comparisons.filter(c => c.pctChange !== null && c.direction !== 'flat' && (c.periodA + c.periodB) > 0);
  const improvements = withPct.filter(c => c.direction === 'up').sort((a, b) => (b.pctChange || 0) - (a.pctChange || 0));
  const declines = withPct.filter(c => c.direction === 'down').sort((a, b) => (a.pctChange || 0) - (b.pctChange || 0));

  const result: ComparisonResult = {
    periodALabel: currentLabel,
    periodBLabel: previousLabel,
    comparisonMode,
    metrics: comparisons,
    topImprovement: improvements[0] || null,
    topDecline: declines[0] || null,
  };

  // If user asked about a specific metric, lead with that
  if (focus) {
    const focusedMetric = comparisons.find(c => c.metric === focus);
    if (focusedMetric) {
      return buildFocusedResponse(focusedMetric, result, detail);
    }
  }

  if (detail) {
    return buildDetailedTrend(result);
  }

  // Default: summary with interpretation
  return buildSummaryTrend(result);
}

// ── Response builders ───────────────────────────────────────────

function buildSummaryTrend(result: ComparisonResult): string {
  const { periodALabel, periodBLabel } = result;
  const sentences: string[] = [];

  sentences.push(`Here's how ${periodALabel} compares to ${periodBLabel}.`);
  sentences.push(interpretComparisons(result));
  sentences.push(`Want me to break down every metric, or drill into a specific one?`);

  return sentences.join(' ');
}

function buildDetailedTrend(result: ComparisonResult): string {
  const { metrics, periodALabel, periodBLabel } = result;
  const sentences: string[] = [];

  sentences.push(`Full breakdown, ${periodALabel} vs ${periodBLabel}:`);

  // Work metrics
  const workMetrics = metrics.filter(m => !['avgRecovery', 'avgSleep', 'avgStrain'].includes(m.metric));
  const whoopMetrics = metrics.filter(m => ['avgRecovery', 'avgSleep', 'avgStrain'].includes(m.metric));

  if (workMetrics.length) {
    sentences.push('\nWork metrics:');
    for (const m of workMetrics) {
      sentences.push(formatMetricLine(m));
    }
  }

  if (whoopMetrics.length && whoopMetrics.some(m => m.periodA + m.periodB > 0)) {
    sentences.push('\nBiometrics:');
    for (const m of whoopMetrics) {
      if (m.periodA + m.periodB > 0) {
        sentences.push(formatMetricLine(m));
      }
    }
  }

  sentences.push('');
  sentences.push(interpretComparisons(result));

  return sentences.join('\n');
}

function buildFocusedResponse(metric: MetricComparison, result: ComparisonResult, detail: boolean): string {
  const { periodALabel, periodBLabel } = result;
  const sentences: string[] = [];

  const arrow = metric.direction === 'up' ? '↑' : metric.direction === 'down' ? '↓' : '→';
  const pct = metric.pctChange !== null ? ` (${metric.pctChange > 0 ? '+' : ''}${metric.pctChange}%)` : '';

  sentences.push(`${metric.label}: ${formatVal(metric)} ${arrow}${pct}, comparing ${periodALabel} to ${periodBLabel}.`);

  // Context from related metrics
  if (metric.metric === 'dials' || metric.metric === 'conversations') {
    const rate = result.metrics.find(m => m.metric === 'dialToConvo');
    if (rate && rate.periodA + rate.periodB > 0) {
      sentences.push(`Your dial-to-conversation rate is ${rate.periodA}% vs ${rate.periodB}% — ${rate.direction === 'up' ? 'efficiency is improving' : rate.direction === 'down' ? 'efficiency dipped' : 'holding steady'}.`);
    }
  }

  if (['avgRecovery', 'avgSleep', 'avgStrain'].includes(metric.metric)) {
    const score = result.metrics.find(m => m.metric === 'avgScore');
    if (score && score.periodA + score.periodB > 0) {
      sentences.push(`Meanwhile, your daily score went ${score.direction === 'up' ? 'up' : score.direction === 'down' ? 'down' : 'flat'} (${score.periodA} vs ${score.periodB}).`);
    }
  }

  if (detail) {
    sentences.push('');
    sentences.push(interpretComparisons(result));
  }

  return sentences.join(' ');
}

function formatMetricLine(m: MetricComparison): string {
  const arrow = m.direction === 'up' ? '↑' : m.direction === 'down' ? '↓' : '→';
  const pct = m.pctChange !== null && m.direction !== 'flat' ? ` (${m.pctChange > 0 ? '+' : ''}${m.pctChange}%)` : '';
  const val = m.isRate ? `${m.periodA}% → was ${m.periodB}%` : `${m.periodA} → was ${m.periodB}`;
  return `  ${arrow} ${m.label}: ${val}${pct}`;
}

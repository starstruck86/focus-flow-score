/**
 * Pipeline Forecast & Gap Detection Engine
 *
 * Projects forward based on recent activity rates and identifies
 * shortfalls relative to weekly/monthly targets.
 */
import { supabase } from '@/integrations/supabase/client';

// ── Types ───────────────────────────────────────────────────────

export interface PipelineRates {
  meetingsPerWeek: number;
  oppsPerWeek: number;
  pipelineValuePerWeek: number;  // $
  dialsPerDay: number;
  contactsPerDay: number;
  windowDays: number;            // how many days of data used
}

export interface PipelineTargets {
  meetingsPerWeek: number;
  oppsPerWeek: number;
  pipelineValuePerMonth: number; // $
  dialsPerDay: number;
  contactsPerDay: number;
}

export interface GapItem {
  metric: string;
  current: number;
  target: number;
  gap: number;
  unit: string;
  severity: 'on_track' | 'warning' | 'critical';
}

export interface ForecastResult {
  rates: PipelineRates;
  targets: PipelineTargets;
  gaps: GapItem[];
  projections: {
    meetingsNextMonth: number;
    oppsNextMonth: number;
    pipelineValueNextMonth: number;
  };
  corrections: string[];
  summary: string;
}

// ── Default targets (can be overridden per user later) ──────────

const DEFAULT_TARGETS: PipelineTargets = {
  meetingsPerWeek: 4,
  oppsPerWeek: 1,
  pipelineValuePerMonth: 100_000,
  dialsPerDay: 40,
  contactsPerDay: 5,
};

// ── Compute rates from journal entries ──────────────────────────

export async function computeActivityRates(
  userId: string,
  lookbackDays = 14,
): Promise<PipelineRates> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('daily_journal_entries')
    .select('date, dials, conversations, meetings_set, opportunities_created, contacts_prepped, prospects_added')
    .eq('user_id', userId)
    .gte('date', cutoffStr)
    .order('date', { ascending: true });

  if (error) throw error;
  const entries = data || [];
  if (!entries.length) {
    return { meetingsPerWeek: 0, oppsPerWeek: 0, pipelineValuePerWeek: 0, dialsPerDay: 0, contactsPerDay: 0, windowDays: 0 };
  }

  const totalDials = entries.reduce((s, e) => s + (e.dials || 0), 0);
  const totalMeetings = entries.reduce((s, e) => s + (e.meetings_set || 0), 0);
  const totalOpps = entries.reduce((s, e) => s + (e.opportunities_created || 0), 0);
  const totalContacts = entries.reduce((s, e) => s + (e.contacts_prepped || 0) + (e.prospects_added || 0), 0);

  const days = entries.length || 1;
  const weeksInWindow = days / 5; // business days

  // Estimate pipeline value from recent opps
  const pipelineValue = await estimateRecentPipelineValue(userId, lookbackDays);

  return {
    meetingsPerWeek: weeksInWindow > 0 ? totalMeetings / weeksInWindow : 0,
    oppsPerWeek: weeksInWindow > 0 ? totalOpps / weeksInWindow : 0,
    pipelineValuePerWeek: weeksInWindow > 0 ? pipelineValue / weeksInWindow : 0,
    dialsPerDay: totalDials / days,
    contactsPerDay: totalContacts / days,
    windowDays: days,
  };
}

async function estimateRecentPipelineValue(userId: string, lookbackDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);

  const { data } = await supabase
    .from('opportunities')
    .select('arr')
    .eq('user_id', userId)
    .gte('created_at', cutoff.toISOString())
    .eq('status', 'active');

  return (data || []).reduce((s, o) => s + (Number(o.arr) || 0), 0);
}

// ── Gap detection ───────────────────────────────────────────────

function classifySeverity(ratio: number): GapItem['severity'] {
  if (ratio >= 0.9) return 'on_track';
  if (ratio >= 0.6) return 'warning';
  return 'critical';
}

export function detectGaps(rates: PipelineRates, targets: PipelineTargets): GapItem[] {
  const gaps: GapItem[] = [];

  const add = (metric: string, current: number, target: number, unit: string) => {
    const ratio = target > 0 ? current / target : 1;
    const gap = target - current;
    gaps.push({ metric, current: +current.toFixed(1), target, gap: +gap.toFixed(1), unit, severity: classifySeverity(ratio) });
  };

  add('Meetings/week', rates.meetingsPerWeek, targets.meetingsPerWeek, 'meetings');
  add('Opps/week', rates.oppsPerWeek, targets.oppsPerWeek, 'opps');
  add('Pipeline $/month', rates.pipelineValuePerWeek * 4.33, targets.pipelineValuePerMonth, '$');
  add('Dials/day', rates.dialsPerDay, targets.dialsPerDay, 'dials');
  add('Contacts/day', rates.contactsPerDay, targets.contactsPerDay, 'contacts');

  return gaps;
}

// ── Correction recommendations ──────────────────────────────────

export function generateCorrections(gaps: GapItem[], rates: PipelineRates): string[] {
  const corrections: string[] = [];

  for (const g of gaps) {
    if (g.severity === 'on_track') continue;

    switch (g.metric) {
      case 'Meetings/week':
        if (g.gap > 0) {
          const extraDialsNeeded = rates.dialsPerDay > 0
            ? Math.ceil(g.gap * 20) // rough: 20 dials ≈ 1 meeting
            : 20;
          corrections.push(`Increase dials by ~${extraDialsNeeded}/week to close ${g.gap} meeting gap`);
        }
        break;
      case 'Opps/week':
        if (g.gap > 0) corrections.push(`Add ${Math.ceil(g.gap * 3)} more meetings/week to generate ${g.gap} additional opps`);
        break;
      case 'Pipeline $/month':
        if (g.gap > 0) corrections.push(`Pipeline gap of $${Math.round(g.gap / 1000)}k/month — focus on higher-value accounts or increase opp creation`);
        break;
      case 'Dials/day':
        if (g.gap > 0) corrections.push(`Increase daily dials by ${Math.ceil(g.gap)} to hit target of ${g.target}`);
        break;
      case 'Contacts/day':
        if (g.gap > 0) corrections.push(`Add ${Math.ceil(g.gap)} more contacts/day to maintain pipeline flow`);
        break;
    }
  }

  return corrections;
}

// ── Full forecast ───────────────────────────────────────────────

export async function getPipelineForecast(
  userId: string,
  targets?: Partial<PipelineTargets>,
): Promise<ForecastResult> {
  const mergedTargets: PipelineTargets = { ...DEFAULT_TARGETS, ...targets };
  const rates = await computeActivityRates(userId);
  const gaps = detectGaps(rates, mergedTargets);
  const corrections = generateCorrections(gaps, rates);

  const projections = {
    meetingsNextMonth: +(rates.meetingsPerWeek * 4.33).toFixed(1),
    oppsNextMonth: +(rates.oppsPerWeek * 4.33).toFixed(1),
    pipelineValueNextMonth: Math.round(rates.pipelineValuePerWeek * 4.33),
  };

  const criticalGaps = gaps.filter(g => g.severity === 'critical');
  const warningGaps = gaps.filter(g => g.severity === 'warning');

  let summary: string;
  if (criticalGaps.length) {
    summary = `⚠️ ${criticalGaps.length} critical gap${criticalGaps.length > 1 ? 's' : ''} detected. At current pace, you'll miss target.`;
  } else if (warningGaps.length) {
    summary = `🟡 ${warningGaps.length} area${warningGaps.length > 1 ? 's' : ''} trending below target. Course correction recommended.`;
  } else {
    summary = '🟢 On track across all pipeline metrics.';
  }

  return { rates, targets: mergedTargets, gaps, projections, corrections, summary };
}

// ── Format for Dave ─────────────────────────────────────────────

export function formatForecast(f: ForecastResult): string {
  const lines: string[] = ['📈 **Pipeline Forecast & Gap Analysis**\n'];

  lines.push(f.summary);
  lines.push('');

  // Projections
  lines.push('**30-day projections (at current pace):**');
  lines.push(`  Meetings: **${f.projections.meetingsNextMonth}** (target: ${Math.round(f.targets.meetingsPerWeek * 4.33)})`);
  lines.push(`  Opportunities: **${f.projections.oppsNextMonth}** (target: ${Math.round(f.targets.oppsPerWeek * 4.33)})`);
  lines.push(`  Pipeline value: **$${Math.round(f.projections.pipelineValueNextMonth / 1000)}k** (target: $${Math.round(f.targets.pipelineValuePerMonth / 1000)}k)`);

  // Gaps
  const activeGaps = f.gaps.filter(g => g.severity !== 'on_track');
  if (activeGaps.length) {
    lines.push('\n**Gaps:**');
    for (const g of activeGaps) {
      const icon = g.severity === 'critical' ? '🔴' : '🟡';
      lines.push(`  ${icon} ${g.metric}: **${g.current}** vs target **${g.target}** (${g.gap > 0 ? '-' : '+'}${Math.abs(g.gap)} ${g.unit})`);
    }
  }

  // Corrections
  if (f.corrections.length) {
    lines.push('\n**Recommended corrections:**');
    for (const c of f.corrections) {
      lines.push(`  → ${c}`);
    }
  }

  if (f.rates.windowDays < 5) {
    lines.push(`\n_Based on ${f.rates.windowDays} day${f.rates.windowDays > 1 ? 's' : ''} of data — forecast will improve with more activity logging._`);
  }

  return lines.join('\n');
}

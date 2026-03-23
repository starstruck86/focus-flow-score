/**
 * Pipeline Forecast & Gap Detection Engine
 *
 * Conversion-aware forecasting: dials → connects → meetings → opps.
 * Projects forward using actual stage conversion rates instead of
 * linear assumptions.
 */
import { supabase } from '@/integrations/supabase/client';

// ── Types ───────────────────────────────────────────────────────

export interface ConversionRates {
  dialToConnect: number;      // 0-1
  connectToMeeting: number;   // 0-1
  meetingToOpp: number;       // 0-1
  weakestStage: FunnelStage | null;
}

export type FunnelStage = 'dial_to_connect' | 'connect_to_meeting' | 'meeting_to_opp';

export interface PipelineRates {
  meetingsPerWeek: number;
  oppsPerWeek: number;
  pipelineValuePerWeek: number;
  dialsPerDay: number;
  connectsPerDay: number;
  contactsPerDay: number;
  windowDays: number;
  conversions: ConversionRates;
}

export interface PipelineTargets {
  meetingsPerWeek: number;
  oppsPerWeek: number;
  pipelineValuePerMonth: number;
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

export interface FunnelDiagnosis {
  stage: FunnelStage;
  rate: number;
  benchmark: number;
  label: string;
  recommendation: string;
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
  funnelDiagnosis: FunnelDiagnosis | null;
  corrections: string[];
  summary: string;
}

// ── Benchmarks ──────────────────────────────────────────────────

const BENCHMARKS: Record<FunnelStage, number> = {
  dial_to_connect: 0.15,     // 15% of dials become connects
  connect_to_meeting: 0.25,  // 25% of connects become meetings
  meeting_to_opp: 0.30,      // 30% of meetings become opps
};

const STAGE_LABELS: Record<FunnelStage, string> = {
  dial_to_connect: 'Dial → Connect',
  connect_to_meeting: 'Connect → Meeting',
  meeting_to_opp: 'Meeting → Opportunity',
};

const DEFAULT_TARGETS: PipelineTargets = {
  meetingsPerWeek: 4,
  oppsPerWeek: 1,
  pipelineValuePerMonth: 100_000,
  dialsPerDay: 40,
  contactsPerDay: 5,
};

// ── Compute conversion rates ────────────────────────────────────

function computeConversions(
  totalDials: number,
  totalConnects: number,
  totalMeetings: number,
  totalOpps: number,
): ConversionRates {
  const dialToConnect = totalDials > 0 ? totalConnects / totalDials : 0;
  const connectToMeeting = totalConnects > 0 ? totalMeetings / totalConnects : 0;
  const meetingToOpp = totalMeetings > 0 ? totalOpps / totalMeetings : 0;

  // Find weakest stage (biggest gap vs benchmark)
  const stages: { stage: FunnelStage; gap: number }[] = [
    { stage: 'dial_to_connect', gap: BENCHMARKS.dial_to_connect - dialToConnect },
    { stage: 'connect_to_meeting', gap: BENCHMARKS.connect_to_meeting - connectToMeeting },
    { stage: 'meeting_to_opp', gap: BENCHMARKS.meeting_to_opp - meetingToOpp },
  ];

  // Only flag if there's meaningful data and actually below benchmark
  const belowBenchmark = stages.filter(s => s.gap > 0.02);
  const weakestStage = belowBenchmark.length
    ? belowBenchmark.sort((a, b) => b.gap - a.gap)[0].stage
    : null;

  return { dialToConnect, connectToMeeting, meetingToOpp, weakestStage };
}

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
    return {
      meetingsPerWeek: 0, oppsPerWeek: 0, pipelineValuePerWeek: 0,
      dialsPerDay: 0, connectsPerDay: 0, contactsPerDay: 0, windowDays: 0,
      conversions: { dialToConnect: 0, connectToMeeting: 0, meetingToOpp: 0, weakestStage: null },
    };
  }

  const totalDials = entries.reduce((s, e) => s + (e.dials || 0), 0);
  const totalConnects = entries.reduce((s, e) => s + (e.conversations || 0), 0);
  const totalMeetings = entries.reduce((s, e) => s + (e.meetings_set || 0), 0);
  const totalOpps = entries.reduce((s, e) => s + (e.opportunities_created || 0), 0);
  const totalContacts = entries.reduce((s, e) => s + (e.contacts_prepped || 0) + (e.prospects_added || 0), 0);

  const days = entries.length || 1;
  const weeksInWindow = days / 5;

  const pipelineValue = await estimateRecentPipelineValue(userId, lookbackDays);
  const conversions = computeConversions(totalDials, totalConnects, totalMeetings, totalOpps);

  return {
    meetingsPerWeek: weeksInWindow > 0 ? totalMeetings / weeksInWindow : 0,
    oppsPerWeek: weeksInWindow > 0 ? totalOpps / weeksInWindow : 0,
    pipelineValuePerWeek: weeksInWindow > 0 ? pipelineValue / weeksInWindow : 0,
    dialsPerDay: totalDials / days,
    connectsPerDay: totalConnects / days,
    contactsPerDay: totalContacts / days,
    windowDays: days,
    conversions,
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

// ── Funnel diagnosis ────────────────────────────────────────────

const STAGE_RECOMMENDATIONS: Record<FunnelStage, string> = {
  dial_to_connect: 'Improve targeting or list quality — you're dialing but not reaching decision-makers. Try better contact data or timing.',
  connect_to_meeting: 'Improve your opening pitch or value proposition — you're connecting but not converting to meetings. Sharpen your hook.',
  meeting_to_opp: 'Improve discovery or qualification — meetings aren't converting to pipeline. Focus on uncovering pain and building urgency.',
};

export function diagnoseFunnel(conversions: ConversionRates): FunnelDiagnosis | null {
  if (!conversions.weakestStage) return null;

  const stage = conversions.weakestStage;
  const rateMap: Record<FunnelStage, number> = {
    dial_to_connect: conversions.dialToConnect,
    connect_to_meeting: conversions.connectToMeeting,
    meeting_to_opp: conversions.meetingToOpp,
  };

  return {
    stage,
    rate: rateMap[stage],
    benchmark: BENCHMARKS[stage],
    label: STAGE_LABELS[stage],
    recommendation: STAGE_RECOMMENDATIONS[stage],
  };
}

// ── Conversion-aware corrections ────────────────────────────────

export function generateCorrections(
  gaps: GapItem[],
  rates: PipelineRates,
): string[] {
  const corrections: string[] = [];
  const { conversions } = rates;

  // Funnel-aware corrections for meetings gap
  const meetingGap = gaps.find(g => g.metric === 'Meetings/week' && g.severity !== 'on_track');
  if (meetingGap && meetingGap.gap > 0) {
    if (conversions.weakestStage === 'dial_to_connect') {
      // Problem is connect rate, not volume
      corrections.push(
        `Connect rate is ${pct(conversions.dialToConnect)} (benchmark: ${pct(BENCHMARKS.dial_to_connect)}) — improving targeting would yield more meetings without extra dials`,
      );
    } else if (conversions.weakestStage === 'connect_to_meeting') {
      corrections.push(
        `Meeting conversion is ${pct(conversions.connectToMeeting)} (benchmark: ${pct(BENCHMARKS.connect_to_meeting)}) — sharpen your opening pitch to convert more connects`,
      );
    } else {
      // Volume is the issue — use conversion rates to compute dials needed
      const effectiveRate = conversions.dialToConnect * conversions.connectToMeeting;
      const dialsPerMeeting = effectiveRate > 0 ? Math.ceil(1 / effectiveRate) : 25;
      corrections.push(
        `At your conversion rates, ~${dialsPerMeeting} dials = 1 meeting. Increase by ~${dialsPerMeeting * Math.ceil(meetingGap.gap)}/week to close the gap.`,
      );
    }
  }

  // Funnel-aware corrections for opps gap
  const oppGap = gaps.find(g => g.metric === 'Opps/week' && g.severity !== 'on_track');
  if (oppGap && oppGap.gap > 0) {
    if (conversions.meetingToOpp < BENCHMARKS.meeting_to_opp * 0.8) {
      corrections.push(
        `Opp conversion is ${pct(conversions.meetingToOpp)} (benchmark: ${pct(BENCHMARKS.meeting_to_opp)}) — focus on deeper discovery and stronger qualification`,
      );
    } else {
      const meetingsPerOpp = conversions.meetingToOpp > 0 ? Math.ceil(1 / conversions.meetingToOpp) : 4;
      corrections.push(
        `Need ~${meetingsPerOpp} meetings per opp at your rate. Add ${meetingsPerOpp * Math.ceil(oppGap.gap)} meetings/week.`,
      );
    }
  }

  // Pipeline $ gap
  const pipelineGap = gaps.find(g => g.metric === 'Pipeline $/month' && g.severity !== 'on_track');
  if (pipelineGap && pipelineGap.gap > 0) {
    corrections.push(
      `Pipeline gap of $${Math.round(pipelineGap.gap / 1000)}k/month — prioritize higher-value accounts or increase opp creation`,
    );
  }

  // Activity volume gaps (only if conversions are healthy)
  const dialsGap = gaps.find(g => g.metric === 'Dials/day' && g.severity !== 'on_track');
  if (dialsGap && dialsGap.gap > 0 && !conversions.weakestStage) {
    corrections.push(`Increase daily dials by ${Math.ceil(dialsGap.gap)} to hit target of ${dialsGap.target}`);
  }

  const contactsGap = gaps.find(g => g.metric === 'Contacts/day' && g.severity !== 'on_track');
  if (contactsGap && contactsGap.gap > 0) {
    corrections.push(`Add ${Math.ceil(contactsGap.gap)} more contacts/day to maintain pipeline flow`);
  }

  return corrections;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ── Conversion-aware projections ────────────────────────────────

function projectWithConversions(rates: PipelineRates): {
  meetingsNextMonth: number;
  oppsNextMonth: number;
  pipelineValueNextMonth: number;
} {
  const { conversions } = rates;
  const bizDaysPerMonth = 21.7;

  // Project from dials through funnel
  const dialsPerMonth = rates.dialsPerDay * bizDaysPerMonth;
  const connectsPerMonth = dialsPerMonth * (conversions.dialToConnect || BENCHMARKS.dial_to_connect);
  const meetingsFromFunnel = connectsPerMonth * (conversions.connectToMeeting || BENCHMARKS.connect_to_meeting);
  const oppsFromFunnel = meetingsFromFunnel * (conversions.meetingToOpp || BENCHMARKS.meeting_to_opp);

  // Blend: use funnel projection if we have conversion data, else use raw rates
  const hasConversionData = conversions.dialToConnect > 0 && conversions.connectToMeeting > 0;
  const meetingsProjected = hasConversionData
    ? meetingsFromFunnel
    : rates.meetingsPerWeek * 4.33;
  const oppsProjected = hasConversionData
    ? oppsFromFunnel
    : rates.oppsPerWeek * 4.33;

  return {
    meetingsNextMonth: +meetingsProjected.toFixed(1),
    oppsNextMonth: +oppsProjected.toFixed(1),
    pipelineValueNextMonth: Math.round(rates.pipelineValuePerWeek * 4.33),
  };
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
  const projections = projectWithConversions(rates);
  const funnelDiagnosis = diagnoseFunnel(rates.conversions);

  const criticalGaps = gaps.filter(g => g.severity === 'critical');
  const warningGaps = gaps.filter(g => g.severity === 'warning');

  let summary: string;
  if (funnelDiagnosis) {
    summary = `🔍 Funnel bottleneck at **${funnelDiagnosis.label}** (${pct(funnelDiagnosis.rate)} vs ${pct(funnelDiagnosis.benchmark)} benchmark).`;
  } else if (criticalGaps.length) {
    summary = `⚠️ ${criticalGaps.length} critical gap${criticalGaps.length > 1 ? 's' : ''} detected. At current pace, you'll miss target.`;
  } else if (warningGaps.length) {
    summary = `🟡 ${warningGaps.length} area${warningGaps.length > 1 ? 's' : ''} trending below target. Course correction recommended.`;
  } else {
    summary = '🟢 On track across all pipeline metrics.';
  }

  return { rates, targets: mergedTargets, gaps, projections, funnelDiagnosis, corrections, summary };
}

// ── Format for Dave ─────────────────────────────────────────────

export function formatForecast(f: ForecastResult): string {
  const lines: string[] = ['📈 **Pipeline Forecast & Gap Analysis**\n'];

  lines.push(f.summary);
  lines.push('');

  // Conversion rates
  const c = f.rates.conversions;
  if (f.rates.windowDays >= 3) {
    lines.push('**Funnel conversion rates:**');
    lines.push(`  Dial → Connect: **${pct(c.dialToConnect)}** (benchmark: ${pct(BENCHMARKS.dial_to_connect)})`);
    lines.push(`  Connect → Meeting: **${pct(c.connectToMeeting)}** (benchmark: ${pct(BENCHMARKS.connect_to_meeting)})`);
    lines.push(`  Meeting → Opp: **${pct(c.meetingToOpp)}** (benchmark: ${pct(BENCHMARKS.meeting_to_opp)})`);
    lines.push('');
  }

  // Projections
  lines.push('**30-day projections (conversion-adjusted):**');
  lines.push(`  Meetings: **${f.projections.meetingsNextMonth}** (target: ${Math.round(f.targets.meetingsPerWeek * 4.33)})`);
  lines.push(`  Opportunities: **${f.projections.oppsNextMonth}** (target: ${Math.round(f.targets.oppsPerWeek * 4.33)})`);
  lines.push(`  Pipeline value: **$${Math.round(f.projections.pipelineValueNextMonth / 1000)}k** (target: $${Math.round(f.targets.pipelineValuePerMonth / 1000)}k)`);

  // Funnel diagnosis
  if (f.funnelDiagnosis) {
    lines.push(`\n🎯 **Bottleneck: ${f.funnelDiagnosis.label}**`);
    lines.push(`  ${f.funnelDiagnosis.recommendation}`);
  }

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

/**
 * Personal Insights Tool — lets Dave answer:
 * "Where am I weak?", "What should I work on?", "What am I doing well?", "What patterns am I missing?"
 */
import type { ToolContext } from '../../toolTypes';
import { supabase } from '@/integrations/supabase/client';
import { startOfWeek, endOfWeek, subWeeks, parseISO, isWithinInterval } from 'date-fns';

const SCORE_CATEGORIES = ['structure', 'cotm', 'meddicc', 'discovery', 'presence', 'commercial', 'next_step'] as const;

export async function personalInsights(ctx: ToolContext, params?: { question?: string }) {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated.';

  // Fetch recent grades
  const { data: grades } = await supabase
    .from('transcript_grades')
    .select('*, call_transcripts!inner(title, call_date, call_type)')
    .order('created_at', { ascending: false })
    .limit(20);

  const allGrades = (grades || []) as any[];

  // Fetch playbook usage
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const { data: usageEvents } = await supabase
    .from('playbook_usage_events' as any)
    .select('*')
    .gte('created_at', weekStart.toISOString());
  const events = (usageEvents || []) as any[];

  if (allGrades.length < 2) {
    return 'I need at least 2 graded calls to identify patterns. Grade more transcripts in the Coach tab.';
  }

  const lines: string[] = [];

  // === WEAKNESSES ===
  const avgScores = SCORE_CATEGORIES.map(cat => ({
    category: cat,
    avg: allGrades.reduce((s: number, g: any) => s + (g[`${cat}_score`] || 0), 0) / allGrades.length,
  })).sort((a, b) => a.avg - b.avg);

  const weakest = avgScores.slice(0, 2);
  const strongest = avgScores.slice(-2).reverse();

  lines.push('**Where you\'re weak:**');
  weakest.forEach(w => {
    lines.push(`- ${w.category.replace(/_/g, ' ')} — averaging ${w.avg.toFixed(1)}/5`);
  });

  // === STRENGTHS ===
  lines.push('');
  lines.push('**What you\'re doing well:**');
  strongest.forEach(s => {
    lines.push(`- ${s.category.replace(/_/g, ' ')} — averaging ${s.avg.toFixed(1)}/5`);
  });

  // Recurring strengths from call feedback
  const strengthCounts = new Map<string, number>();
  allGrades.forEach((g: any) => {
    (g.strengths || []).forEach((s: string) => {
      strengthCounts.set(s, (strengthCounts.get(s) || 0) + 1);
    });
  });
  const topStrengths = [...strengthCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (topStrengths.length > 0) {
    topStrengths.forEach(([s, c]) => lines.push(`- "${s}" (${c} calls)`));
  }

  // === REPEATED MISSES ===
  const flagCounts: Record<string, number> = {};
  allGrades.forEach((g: any) => {
    (g.behavioral_flags || []).forEach((f: string) => {
      flagCounts[f] = (flagCounts[f] || 0) + 1;
    });
  });
  const repeatedFlags = Object.entries(flagCounts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (repeatedFlags.length > 0) {
    lines.push('');
    lines.push('**Repeated misses:**');
    repeatedFlags.forEach(([flag, count]) => {
      const pct = Math.round((count / allGrades.length) * 100);
      lines.push(`- ${flag.replace(/_/g, ' ')} — ${pct}% of calls`);
    });
  }

  // === TREND ===
  const recent = allGrades.slice(0, 5);
  const older = allGrades.slice(5, 10);
  if (recent.length >= 3 && older.length >= 3) {
    const recentAvg = Math.round(recent.reduce((s: number, g: any) => s + g.overall_score, 0) / recent.length);
    const olderAvg = Math.round(older.reduce((s: number, g: any) => s + g.overall_score, 0) / older.length);
    const delta = recentAvg - olderAvg;
    lines.push('');
    lines.push(`**Trend:** Recent avg ${recentAvg} vs earlier ${olderAvg} (${delta > 0 ? '+' : ''}${delta})`);
    if (delta > 3) lines.push('You\'re improving — keep the momentum.');
    else if (delta < -3) lines.push('Scores are slipping — focus on the weak areas above.');
    else lines.push('Scores are stable — push harder on your weakest dimension to break through.');
  }

  // === PLAYBOOK USAGE ===
  const roleplays = events.filter((e: any) => e.event_type === 'roleplay_completed').length;
  const usedInCalls = events.filter((e: any) => e.event_type === 'used_in_call').length;
  if (events.length > 0) {
    lines.push('');
    lines.push(`**This week:** ${roleplays} roleplay(s), ${usedInCalls} playbook(s) used in real calls`);
    if (roleplays === 0) lines.push('→ Try a 2-minute roleplay to sharpen your weakest area.');
  }

  // === RECOMMENDATION ===
  lines.push('');
  lines.push('**What to work on this week:**');
  lines.push(`1. Focus on **${weakest[0].category.replace(/_/g, ' ')}** — your lowest scoring area`);
  if (repeatedFlags.length > 0) {
    lines.push(`2. Break the **${repeatedFlags[0][0].replace(/_/g, ' ')}** pattern`);
  }

  return lines.join('\n');
}

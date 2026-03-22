import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';

export function behaviorSummary(): string {
  try {
    const raw = localStorage.getItem('jarvis-action-memory');
    if (!raw) return 'No action history yet — keep using the system and I\'ll learn your patterns.';
    const records = JSON.parse(raw) as Array<{ outcome: string; timestamp: number; entityType?: string }>;
    const monthAgo = Date.now() - 30 * 86400000;
    const recent = records.filter(r => r.timestamp > monthAgo);
    if (recent.length < 5) return 'Not enough data yet — need a few more days of usage.';

    const completed = recent.filter(r => r.outcome === 'completed').length;
    const ignored = recent.filter(r => r.outcome === 'ignored').length;
    const deferred = recent.filter(r => r.outcome === 'deferred').length;
    const rate = Math.round((completed / recent.length) * 100);

    const typeStats: Record<string, { c: number; t: number }> = {};
    for (const r of recent) {
      const t = r.entityType || 'unknown';
      if (!typeStats[t]) typeStats[t] = { c: 0, t: 0 };
      typeStats[t].t++;
      if (r.outcome === 'completed') typeStats[t].c++;
    }

    let summary = `📈 Action completion: ${rate}% (${completed} done, ${deferred} deferred, ${ignored} ignored).\n`;
    for (const [type, stats] of Object.entries(typeStats)) {
      if (stats.t >= 3) {
        summary += `${type}: ${Math.round((stats.c / stats.t) * 100)}% completion rate.\n`;
      }
    }
    return summary;
  } catch { return 'Unable to read behavior data.'; }
}

export async function energyMatch(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const today = new Date().toISOString().split('T')[0];
  const { data: whoop } = await supabase.from('whoop_daily_metrics').select('recovery_score, sleep_score, strain_score').eq('user_id', userId).eq('date', today).limit(1);
  const { data: journal } = await supabase.from('daily_journal_entries').select('energy, focus_quality, stress').eq('user_id', userId).eq('date', today).limit(1);

  const recovery = (whoop as Array<{ recovery_score: number | null }> | null)?.[0]?.recovery_score;
  const energy = (journal as Array<{ energy: number | null }> | null)?.[0]?.energy;

  let energyLevel: 'high' | 'medium' | 'low' = 'medium';
  if (recovery !== undefined && recovery !== null) energyLevel = recovery >= 67 ? 'high' : recovery >= 33 ? 'medium' : 'low';
  else if (energy !== undefined && energy !== null) energyLevel = energy >= 4 ? 'high' : energy >= 2 ? 'medium' : 'low';

  const recommendations: Record<string, string> = {
    high: '🟢 High energy — tackle strategy, prep, and complex deals. Best time for discovery calls and negotiations.',
    medium: '🟡 Moderate energy — good for follow-ups, CRM updates, and routine outreach. Save heavy thinking for later.',
    low: '🔴 Low energy — focus on admin, email clean-up, and light tasks. Avoid critical calls or negotiations.',
  };

  let result = recommendations[energyLevel];
  if (recovery !== undefined && recovery !== null) result += `\nWHOOP recovery: ${recovery}%`;
  if (energy !== undefined && energy !== null) result += ` | Self-rated energy: ${energy}/5`;
  return result;
}

// Account Health Pulse — unified score combining ICP fit + timing + stakeholder coverage + signals
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';

export interface AccountHealthPulse {
  accountId: string;
  accountName: string;
  overallScore: number; // 0-100
  icpFit: number;
  timingScore: number;
  stakeholderCoverage: number;
  signalStrength: number;
  engagementRecency: number;
  tier: 'hot' | 'warm' | 'cool' | 'cold';
  topGap: string;
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export function useAccountHealthPulse(motionFilter?: 'new-logo' | 'renewal') {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['account-health-pulse', user?.id, motionFilter],
    queryFn: async (): Promise<AccountHealthPulse[]> => {
      if (!user) return [];
      // Fetch accounts + contacts + recent digest items in parallel (explicit user_id for defense-in-depth)
      let accountsQuery = fromActiveAccounts().select('id, name, icp_fit_score, timing_score, last_touch_date, trigger_events, marketing_platform_detected, last_enriched_at, tier, motion').eq('user_id', user.id);
      if (motionFilter) {
        accountsQuery = accountsQuery.eq('motion', motionFilter);
      }
      const [accountsRes, contactsRes, digestRes] = await Promise.all([
        accountsQuery,
        supabase.from('contacts').select('account_id, buyer_role, influence_level').eq('user_id', user.id),
        supabase.from('daily_digest_items').select('account_id, relevance_score, is_actionable, digest_date').eq('user_id', user.id).gte('digest_date', new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0]),
      ]);

      const accounts = accountsRes.data || [];
      const contacts = contactsRes.data || [];
      const digestItems = digestRes.data || [];

      // Group contacts by account
      const contactsByAccount = new Map<string, any[]>();
      for (const c of contacts) {
        if (!c.account_id) continue;
        const list = contactsByAccount.get(c.account_id) || [];
        list.push(c);
        contactsByAccount.set(c.account_id, list);
      }

      // Group digest items by account
      const signalsByAccount = new Map<string, any[]>();
      for (const d of digestItems) {
        if (!d.account_id) continue;
        const list = signalsByAccount.get(d.account_id) || [];
        list.push(d);
        signalsByAccount.set(d.account_id, list);
      }

      const CRITICAL_ROLES = ['economic_buyer', 'champion', 'coach'];

      return accounts.map((acct): AccountHealthPulse => {
        const acctContacts = contactsByAccount.get(acct.id) || [];
        const acctSignals = signalsByAccount.get(acct.id) || [];

        // 1. ICP Fit (0-100) — direct from enrichment
        const icpFit = acct.icp_fit_score || 0;

        // 2. Timing Score (0-100) — based on trigger events recency
        const triggers = (acct.trigger_events as any[]) || [];
        const recentTriggers = triggers.filter((t: any) => daysSince(t.date) <= 30);
        const timingScore = Math.min(100, (acct.timing_score || 0) + recentTriggers.length * 15);

        // 3. Stakeholder Coverage (0-100)
        const mappedContacts = acctContacts.filter(c => c.buyer_role && c.buyer_role !== 'unknown');
        const coveredRoles = new Set(mappedContacts.map(c => c.buyer_role));
        const criticalCovered = CRITICAL_ROLES.filter(r => coveredRoles.has(r));
        const hasHighInfluence = mappedContacts.some(c => c.influence_level === 'high');
        const stakeholderCoverage = Math.min(100,
          criticalCovered.length * 25 + (hasHighInfluence ? 10 : 0) + (mappedContacts.length >= 3 ? 15 : 0)
        );

        // 4. Signal Strength (0-100) — recent digest signals
        const actionableSignals = acctSignals.filter(s => s.is_actionable);
        const avgRelevance = acctSignals.length > 0 ? acctSignals.reduce((sum, s) => sum + (s.relevance_score || 50), 0) / acctSignals.length : 0;
        const signalStrength = Math.min(100, avgRelevance + actionableSignals.length * 10);

        // 5. Engagement Recency (0-100) — how recently you touched this account
        const daysSinceTouch = daysSince(acct.last_touch_date);
        const engagementRecency = daysSinceTouch <= 3 ? 100 : daysSinceTouch <= 7 ? 80 : daysSinceTouch <= 14 ? 60 : daysSinceTouch <= 30 ? 40 : daysSinceTouch <= 60 ? 20 : 0;

        // Overall Score — weighted blend
        const overallScore = Math.round(
          icpFit * 0.25 + timingScore * 0.2 + stakeholderCoverage * 0.2 + signalStrength * 0.2 + engagementRecency * 0.15
        );

        // Tier classification
        const tier = overallScore >= 75 ? 'hot' : overallScore >= 50 ? 'warm' : overallScore >= 25 ? 'cool' : 'cold';

        // Top gap identification
        const scores = [
          { name: 'Stakeholder mapping', score: stakeholderCoverage },
          { name: 'Recent engagement', score: engagementRecency },
          { name: 'Signal monitoring', score: signalStrength },
          { name: 'Account enrichment', score: icpFit },
        ];
        const topGap = scores.sort((a, b) => a.score - b.score)[0];

        return {
          accountId: acct.id,
          accountName: acct.name,
          overallScore,
          icpFit,
          timingScore,
          stakeholderCoverage,
          signalStrength,
          engagementRecency,
          tier,
          topGap: topGap.score < 50 ? `Improve ${topGap.name.toLowerCase()}` : 'Well covered',
        };
      }).sort((a, b) => b.overallScore - a.overallScore);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

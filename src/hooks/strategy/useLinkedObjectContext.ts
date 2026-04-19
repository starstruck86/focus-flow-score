import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { StrategyThread } from '@/types/strategy';

interface LinkedContext {
  account?: {
    id: string;
    name: string;
    industry: string | null;
    tier: string | null;
    website: string | null;
    notes: string | null;
    outreach_status: string | null;
  } | null;
  opportunity?: {
    id: string;
    name: string;
    stage: string | null;
    amount: number | null;
    close_date: string | null;
    notes: string | null;
  } | null;
  memories: Array<{ memory_type: string; content: string; is_pinned: boolean }>;
}

export function useLinkedObjectContext(thread: StrategyThread | null) {
  const [context, setContext] = useState<LinkedContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const hydrate = useCallback(async () => {
    if (!thread) { setContext(null); return; }
    setIsLoading(true);

    const ctx: LinkedContext = { memories: [] };

    if (thread.linked_account_id) {
      const { data: acct } = await supabase
        .from('accounts')
        .select('id, name, industry, tier, website, notes, outreach_status')
        .eq('id', thread.linked_account_id)
        .maybeSingle();
      ctx.account = acct;

      // Trust gate: never hydrate a thread with memory rows that were flagged
      // as contaminated (is_irrelevant=true). Otherwise a Lima One-derived
      // memory could feed back into an Adore Me thread context.
      const { data: mem } = await supabase
        .from('account_strategy_memory')
        .select('memory_type, content, is_pinned')
        .eq('account_id', thread.linked_account_id)
        .eq('is_irrelevant', false)
        .order('created_at', { ascending: false })
        .limit(20);
      if (mem) ctx.memories = mem;
    }

    if (thread.linked_opportunity_id) {
      const { data: opp } = await supabase
        .from('opportunities')
        .select('id, name, stage, close_date, notes')
        .eq('id', thread.linked_opportunity_id)
        .maybeSingle();
      ctx.opportunity = opp ? { ...opp, amount: null } : null;

      const { data: mem } = await supabase
        .from('opportunity_strategy_memory')
        .select('memory_type, content, is_pinned')
        .eq('opportunity_id', thread.linked_opportunity_id)
        .eq('is_irrelevant', false)
        .order('created_at', { ascending: false })
        .limit(20);
      if (mem) ctx.memories = [...ctx.memories, ...mem];
    }

    setContext(ctx);
    setIsLoading(false);
  }, [thread?.id, thread?.linked_account_id, thread?.linked_opportunity_id]);

  useEffect(() => { hydrate(); }, [hydrate]);

  return { linkedContext: context, isLoading, refetch: hydrate };
}

import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import type { Account } from '@/types';

export interface EnrichmentResult {
  success: boolean;
  error?: string;
  signals?: {
    direct_ecommerce: boolean;
    email_sms_capture: boolean;
    loyalty_membership: boolean;
    category_complexity: boolean;
    mobile_app: boolean;
    marketing_platform_detected: string | null;
    crm_lifecycle_team_size: number;
  };
  confidence?: Record<string, 'high' | 'medium' | 'low'>;
  scores?: {
    icp_fit_score: number;
    timing_score: number;
    priority_score: number;
    lifecycle_tier: string;
    high_probability_buyer: boolean;
    triggered_account: boolean;
    confidence_score: number;
  };
  summary?: string;
}

const STALE_DAYS = 90;

export function isEnrichmentStale(account: Account): boolean {
  if (!account.lastEnrichedAt) return false; // never enriched = not "stale", just unenriched
  const daysSince = Math.floor((Date.now() - new Date(account.lastEnrichedAt).getTime()) / 86400000);
  return daysSince > STALE_DAYS;
}

export function useAccountEnrichment() {
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const updateAccount = useStore((s) => s.updateAccount);
  const accounts = useStore((s) => s.accounts);
  // Track previous website values for auto-enrich
  const prevWebsitesRef = useRef<Map<string, string | undefined>>(new Map());

  const enrichAccount = useCallback(async (account: Account): Promise<EnrichmentResult> => {
    if (!account.website) {
      toast.error('Account needs a website URL to enrich');
      return { success: false, error: 'No website URL' };
    }

    setEnrichingIds((prev) => new Set(prev).add(account.id));

    try {
      const { data, error } = await supabase.functions.invoke('enrich-account', {
        body: { url: account.website, accountName: account.name, accountId: account.id },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Enrichment failed');

      const result = data as EnrichmentResult;

      // Apply to local state (DB is updated by edge function directly)
      const updates: Partial<Account> = {
        directEcommerce: result.signals!.direct_ecommerce,
        emailSmsCapture: result.signals!.email_sms_capture,
        loyaltyMembership: result.signals!.loyalty_membership,
        categoryComplexity: result.signals!.category_complexity,
        mobileApp: result.signals!.mobile_app,
        marketingPlatformDetected: result.signals!.marketing_platform_detected || undefined,
        crmLifecycleTeamSize: result.signals!.crm_lifecycle_team_size,
        icpFitScore: account.icpScoreOverride ?? result.scores!.icp_fit_score,
        timingScore: result.scores!.timing_score,
        priorityScore: result.scores!.priority_score,
        lifecycleTier: account.tierOverride || result.scores!.lifecycle_tier,
        highProbabilityBuyer: result.scores!.high_probability_buyer,
        triggeredAccount: result.scores!.triggered_account,
        confidenceScore: result.scores!.confidence_score,
        lastEnrichedAt: new Date().toISOString(),
        enrichmentSourceSummary: result.summary,
      };

      updateAccount(account.id, updates);
      toast.success(`Enriched ${account.name}`, {
        description: `ICP ${result.scores!.icp_fit_score} • Tier ${result.scores!.lifecycle_tier}`,
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Enrichment failed';
      toast.error(`Failed to enrich ${account.name}`, { description: message });
      return { success: false, error: message };
    } finally {
      setEnrichingIds((prev) => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
    }
  }, [updateAccount]);

  const enrichMultiple = useCallback(async (accts: Account[]) => {
    const withWebsite = accts.filter((a) => a.website);
    if (withWebsite.length === 0) {
      toast.error('No accounts have website URLs');
      return;
    }
    toast.info(`Enriching ${withWebsite.length} accounts...`);
    for (const account of withWebsite) {
      await enrichAccount(account);
      await new Promise((r) => setTimeout(r, 800));
    }
    toast.success(`Finished enriching ${withWebsite.length} accounts`);
  }, [enrichAccount]);

  // Auto-enrich when a website URL is added or changed
  // Only track website changes — ignore other account field updates to prevent loops
  const accountWebsites = accounts.map(a => `${a.id}:${a.website || ''}`).join('|');
  
  useEffect(() => {
    const prev = prevWebsitesRef.current;
    // Skip on first render (just populate ref)
    if (prev.size === 0) {
      const newMap = new Map<string, string | undefined>();
      accounts.forEach(a => newMap.set(a.id, a.website));
      prevWebsitesRef.current = newMap;
      return;
    }

    const toEnrich: Account[] = [];

    for (const account of accounts) {
      const prevUrl = prev.get(account.id);
      const currentUrl = account.website;

      // Only trigger if website specifically changed (not other fields)
      if (currentUrl && currentUrl !== prevUrl && !enrichingIds.has(account.id)) {
        const recentlyEnriched = account.lastEnrichedAt && 
          (Date.now() - new Date(account.lastEnrichedAt).getTime()) < 300000;
        if (!recentlyEnriched) {
          toEnrich.push(account);
        }
      }
    }

    // Update ref
    const newMap = new Map<string, string | undefined>();
    accounts.forEach(a => newMap.set(a.id, a.website));
    prevWebsitesRef.current = newMap;

    if (toEnrich.length > 0) {
      toEnrich.forEach((account, i) => {
        setTimeout(() => enrichAccount(account), i * 1500);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountWebsites]);

  return {
    enrichAccount,
    enrichMultiple,
    isEnriching: (id: string) => enrichingIds.has(id),
    enrichingCount: enrichingIds.size,
    isEnrichmentStale,
  };
}

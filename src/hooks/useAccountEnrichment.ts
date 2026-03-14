import { useState, useCallback } from 'react';
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
  evidence?: Record<string, string>;
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
  

  const enrichAccount = useCallback(async (account: Account): Promise<EnrichmentResult> => {
    setEnrichingIds((prev) => new Set(prev).add(account.id));

    try {
      const { data, error } = await supabase.functions.invoke('enrich-account', {
        body: { url: account.website || '', accountName: account.name, accountId: account.id, industry: account.industry || '' },
      });

      // If website was auto-discovered, update the account
      if (data?.discoveredUrl && !account.website) {
        updateAccount(account.id, { website: data.discoveredUrl });
        toast.success(`Found website: ${data.discoveredUrl}`, { duration: 5000 });
      }

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
        enrichmentSourceSummary: (data as any).summary || result.summary,
        enrichmentEvidence: result.evidence,
        // Populate MarTech and Ecommerce columns from enrichment
        marTech: (data as any).marTech || account.marTech,
        ecommerce: (data as any).ecommerce || account.ecommerce,
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
    if (accts.length === 0) {
      toast.error('No accounts selected');
      return;
    }
    toast.info(`Enriching ${accts.length} accounts...`);
    for (const account of accts) {
      await enrichAccount(account);
      await new Promise((r) => setTimeout(r, 800));
    }
    toast.success(`Finished enriching ${accts.length} accounts`);
  }, [enrichAccount]);

  return {
    enrichAccount,
    enrichMultiple,
    isEnriching: (id: string) => enrichingIds.has(id),
    enrichingCount: enrichingIds.size,
    isEnrichmentStale,
  };
}

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import type { Account } from '@/types';

export interface EnrichmentSignals {
  direct_ecommerce: boolean;
  email_sms_capture: boolean;
  loyalty_membership: boolean;
  category_complexity: boolean;
  mobile_app: boolean;
  marketing_platform_detected: string | null;
  crm_lifecycle_team_size: number;
}

export interface EnrichmentConfidence {
  direct_ecommerce: 'high' | 'medium' | 'low';
  email_sms_capture: 'high' | 'medium' | 'low';
  loyalty_membership: 'high' | 'medium' | 'low';
  category_complexity: 'high' | 'medium' | 'low';
  mobile_app: 'high' | 'medium' | 'low';
  marketing_platform: 'high' | 'medium' | 'low';
  crm_lifecycle_team_size: 'high' | 'medium' | 'low';
}

export interface EnrichmentResult {
  success: boolean;
  error?: string;
  signals?: EnrichmentSignals;
  confidence?: EnrichmentConfidence;
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

export function useAccountEnrichment() {
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const updateAccount = useStore((s) => s.updateAccount);

  const enrichAccount = useCallback(async (account: Account): Promise<EnrichmentResult> => {
    if (!account.website) {
      toast.error('Account needs a website URL to enrich');
      return { success: false, error: 'No website URL' };
    }

    setEnrichingIds((prev) => new Set(prev).add(account.id));

    try {
      const { data, error } = await supabase.functions.invoke('enrich-account', {
        body: { url: account.website, accountName: account.name },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Enrichment failed');
      }

      const result = data as EnrichmentResult;

      // Apply enrichment to account (don't override manual overrides)
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
      toast.success(`Enriched ${account.name}`, { description: `ICP Score: ${result.scores!.icp_fit_score} • Tier ${result.scores!.lifecycle_tier}` });

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

  const enrichMultiple = useCallback(async (accounts: Account[]) => {
    const withWebsite = accounts.filter((a) => a.website);
    if (withWebsite.length === 0) {
      toast.error('No accounts have website URLs');
      return;
    }

    toast.info(`Enriching ${withWebsite.length} accounts...`);

    // Process sequentially to avoid rate limiting
    for (const account of withWebsite) {
      await enrichAccount(account);
      // Small delay between requests
      await new Promise((r) => setTimeout(r, 1000));
    }

    toast.success(`Finished enriching ${withWebsite.length} accounts`);
  }, [enrichAccount]);

  return {
    enrichAccount,
    enrichMultiple,
    isEnriching: (id: string) => enrichingIds.has(id),
    enrichingCount: enrichingIds.size,
  };
}

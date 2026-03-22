import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { autoInferHierarchy } from '@/lib/orgChartInference';
import type { Account } from '@/types';

export interface EnrichmentResult {
  success: boolean;
  error?: string;
  discoveredUrl?: string;
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
  const [wrongAccountId, setWrongAccountId] = useState<string | null>(null);
  const updateAccount = useStore((s) => s.updateAccount);

  const reportWrongAccount = useCallback(async (account: Account, note?: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await supabase.from('ai_feedback').insert({
        user_id: session.user.id,
        feature: 'enrichment-wrong-account',
        feedback_text: note || `Wrong company identified for ${account.name}`,
        ai_suggestion_summary: account.enrichmentSourceSummary || '',
        context_date: new Date().toISOString().split('T')[0],
        rating: 1,
      });

      // Clear enrichment data so user can re-enrich
      updateAccount(account.id, {
        lastEnrichedAt: undefined,
        enrichmentSourceSummary: undefined,
        enrichmentEvidence: undefined,
        icpFitScore: undefined,
        priorityScore: undefined,
        confidenceScore: undefined,
        lifecycleTier: undefined,
        directEcommerce: undefined,
        emailSmsCapture: undefined,
        loyaltyMembership: undefined,
        categoryComplexity: undefined,
        mobileApp: undefined,
        marketingPlatformDetected: undefined,
        crmLifecycleTeamSize: undefined,
        marTech: undefined,
        ecommerce: undefined,
      });

      toast.success('Enrichment data cleared', {
        description: 'Feedback recorded. Update the website URL and re-enrich for better results.',
      });
    } catch {
      toast.error('Failed to report — please try again');
    }
  }, [updateAccount]);

  const enrichAccount = useCallback(async (account: Account): Promise<EnrichmentResult> => {
    setEnrichingIds((prev) => new Set(prev).add(account.id));

    try {
      const { data, error } = await trackedInvoke<EnrichmentResult>('enrich-account', {
        body: { url: account.website || '', accountName: account.name, accountId: account.id, industry: account.industry || '' },
        componentName: 'useAccountEnrichment',
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
        marTech: (data as any).marTech || account.marTech,
        ecommerce: (data as any).ecommerce || account.ecommerce,
      };

      updateAccount(account.id, updates);

      // Auto-infer org chart hierarchy after enrichment
      try {
        const inferredCount = await autoInferHierarchy(account.id);
        if (inferredCount > 0) {
          toast.info(`Auto-organized ${inferredCount} contacts in org chart`, { duration: 4000 });
        }
      } catch (e) {
        console.error('Hierarchy inference failed:', e);
      }

      toast.success(`Enriched ${account.name}`, {
        description: `ICP ${result.scores!.icp_fit_score} • Tier ${result.scores!.lifecycle_tier}`,
        action: {
          label: 'Wrong Company?',
          onClick: () => reportWrongAccount(account),
        },
        duration: 8000,
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
  }, [updateAccount, reportWrongAccount]);

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
    reportWrongAccount,
    isEnriching: (id: string) => enrichingIds.has(id),
    enrichingCount: enrichingIds.size,
    isEnrichmentStale,
    wrongAccountId,
    setWrongAccountId,
  };
}

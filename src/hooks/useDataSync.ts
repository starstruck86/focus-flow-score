// Data Sync Bridge: Hydrates Zustand from DB on load, writes mutations back
import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/store/useStore';
import { supabase } from '@/integrations/supabase/client';
import type { Account, Contact, Renewal, Opportunity, Task, ChurnRisk } from '@/types';

// ── DB → Zustand mappers ─────────────────────────────────

function dbAccountToStore(db: any): Account {
  return {
    id: db.id,
    name: db.name,
    website: db.website ?? undefined,
    industry: db.industry ?? undefined,
    priority: db.priority ?? 'medium',
    tier: db.tier ?? 'C',
    accountStatus: db.account_status ?? 'researching',
    motion: db.motion ?? 'new-logo',
    salesforceLink: db.salesforce_link ?? undefined,
    salesforceId: db.salesforce_id ?? undefined,
    planhatLink: db.planhat_link ?? undefined,
    currentAgreementLink: db.current_agreement_link ?? undefined,
    techStack: db.tech_stack ?? [],
    techStackNotes: db.tech_stack_notes ?? undefined,
    techFitFlag: db.tech_fit_flag ?? 'good',
    outreachStatus: db.outreach_status ?? 'not-started',
    cadenceName: db.cadence_name ?? undefined,
    lastTouchDate: db.last_touch_date ?? undefined,
    lastTouchType: db.last_touch_type ?? undefined,
    touchesThisWeek: db.touches_this_week ?? 0,
    nextStep: db.next_step ?? undefined,
    nextTouchDue: db.next_touch_due ?? undefined,
    notes: db.notes ?? undefined,
    marTech: db.mar_tech ?? undefined,
    ecommerce: db.ecommerce ?? undefined,
    contactStatus: db.contact_status ?? undefined,
    tags: db.tags ?? [],
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    // Lifecycle Intelligence
    directEcommerce: db.direct_ecommerce ?? undefined,
    emailSmsCapture: db.email_sms_capture ?? undefined,
    loyaltyMembership: db.loyalty_membership ?? undefined,
    categoryComplexity: db.category_complexity ?? undefined,
    mobileApp: db.mobile_app ?? undefined,
    marketingPlatformDetected: db.marketing_platform_detected ?? undefined,
    crmLifecycleTeamSize: db.crm_lifecycle_team_size ?? undefined,
    triggerEvents: db.trigger_events ?? [],
    icpFitScore: db.icp_fit_score != null ? Number(db.icp_fit_score) : undefined,
    timingScore: db.timing_score != null ? Number(db.timing_score) : undefined,
    priorityScore: db.priority_score != null ? Number(db.priority_score) : undefined,
    lifecycleTier: db.lifecycle_tier ?? undefined,
    highProbabilityBuyer: db.high_probability_buyer ?? false,
    triggeredAccount: db.triggered_account ?? false,
    confidenceScore: db.confidence_score != null ? Number(db.confidence_score) : undefined,
    lastEnrichedAt: db.last_enriched_at ?? undefined,
    enrichmentSourceSummary: db.enrichment_source_summary ?? undefined,
    enrichmentEvidence: (db as any).enrichment_evidence ?? undefined,
    lifecycleOverride: db.lifecycle_override ?? false,
    lifecycleOverrideReason: db.lifecycle_override_reason ?? undefined,
    icpScoreOverride: db.icp_score_override != null ? Number(db.icp_score_override) : undefined,
    tierOverride: db.tier_override ?? undefined,
  };
}

function storeAccountToDb(a: Account, userId: string): any {
  return {
    id: a.id,
    user_id: userId,
    name: a.name,
    website: a.website || null,
    industry: a.industry || null,
    priority: a.priority,
    tier: a.tier,
    account_status: a.accountStatus,
    motion: a.motion,
    salesforce_link: a.salesforceLink || null,
    salesforce_id: a.salesforceId || null,
    planhat_link: a.planhatLink || null,
    current_agreement_link: a.currentAgreementLink || null,
    tech_stack: a.techStack,
    tech_stack_notes: a.techStackNotes || null,
    tech_fit_flag: a.techFitFlag,
    outreach_status: a.outreachStatus,
    cadence_name: a.cadenceName || null,
    last_touch_date: a.lastTouchDate || null,
    last_touch_type: a.lastTouchType || null,
    touches_this_week: a.touchesThisWeek,
    next_step: a.nextStep || null,
    next_touch_due: a.nextTouchDue || null,
    notes: a.notes || null,
    mar_tech: a.marTech || null,
    ecommerce: a.ecommerce || null,
    contact_status: a.contactStatus || null,
    tags: a.tags,
    // Lifecycle Intelligence
    direct_ecommerce: a.directEcommerce ?? null,
    email_sms_capture: a.emailSmsCapture ?? null,
    loyalty_membership: a.loyaltyMembership ?? null,
    category_complexity: a.categoryComplexity ?? null,
    mobile_app: a.mobileApp ?? null,
    marketing_platform_detected: a.marketingPlatformDetected || null,
    crm_lifecycle_team_size: a.crmLifecycleTeamSize ?? null,
    trigger_events: a.triggerEvents || [],
    icp_fit_score: a.icpFitScore ?? null,
    timing_score: a.timingScore ?? null,
    priority_score: a.priorityScore ?? null,
    lifecycle_tier: a.lifecycleTier || null,
    high_probability_buyer: a.highProbabilityBuyer ?? false,
    triggered_account: a.triggeredAccount ?? false,
    confidence_score: a.confidenceScore ?? null,
    last_enriched_at: a.lastEnrichedAt || null,
    enrichment_source_summary: a.enrichmentSourceSummary || null,
    enrichment_evidence: a.enrichmentEvidence || {},
    lifecycle_override: a.lifecycleOverride ?? false,
    lifecycle_override_reason: a.lifecycleOverrideReason || null,
    icp_score_override: a.icpScoreOverride ?? null,
    tier_override: a.tierOverride || null,
  };
}

function dbOpportunityToStore(db: any): Opportunity {
  return {
    id: db.id,
    name: db.name,
    accountId: db.account_id ?? undefined,
    salesforceLink: db.salesforce_link ?? undefined,
    salesforceId: db.salesforce_id ?? undefined,
    linkedContactIds: [],
    status: db.status ?? 'active',
    stage: db.stage ?? '',
    arr: db.arr ?? undefined,
    churnRisk: db.churn_risk ?? undefined,
    closeDate: db.close_date ?? undefined,
    nextStep: db.next_step ?? undefined,
    nextStepDate: db.next_step_date ?? undefined,
    lastTouchDate: db.last_touch_date ?? undefined,
    notes: db.notes ?? undefined,
    activityLog: db.activity_log ?? [],
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    dealType: db.deal_type ?? undefined,
    paymentTerms: db.payment_terms ?? undefined,
    termMonths: db.term_months ?? undefined,
    priorContractArr: db.prior_contract_arr ?? undefined,
    renewalArr: db.renewal_arr ?? undefined,
    oneTimeAmount: db.one_time_amount ?? undefined,
    isNewLogo: db.is_new_logo ?? undefined,
  };
}

function storeOpportunityToDb(o: Opportunity, userId: string): any {
  return {
    id: o.id,
    user_id: userId,
    name: o.name,
    account_id: o.accountId || null,
    salesforce_link: o.salesforceLink || null,
    salesforce_id: o.salesforceId || null,
    status: o.status,
    stage: o.stage,
    arr: o.arr ?? null,
    churn_risk: o.churnRisk || null,
    close_date: o.closeDate || null,
    next_step: o.nextStep || null,
    next_step_date: o.nextStepDate || null,
    last_touch_date: o.lastTouchDate || null,
    notes: o.notes || null,
    activity_log: o.activityLog || [],
    deal_type: o.dealType || null,
    payment_terms: o.paymentTerms || null,
    term_months: o.termMonths ?? null,
    prior_contract_arr: o.priorContractArr ?? null,
    renewal_arr: o.renewalArr ?? null,
    one_time_amount: o.oneTimeAmount ?? null,
    is_new_logo: o.isNewLogo ?? null,
  };
}

function dbRenewalToStore(db: any): Renewal {
  const dueDate = new Date(db.renewal_due);
  const today = new Date();
  const daysToRenewal = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const quarter = `Q${Math.ceil((dueDate.getMonth() + 1) / 3)} ${dueDate.getFullYear()}`;
  
  return {
    id: db.id,
    accountId: db.account_id ?? undefined,
    accountName: db.account_name,
    csm: db.csm ?? undefined,
    arr: db.arr ?? 0,
    renewalDue: db.renewal_due,
    daysToRenewal,
    renewalQuarter: db.renewal_quarter ?? quarter,
    entitlements: db.entitlements ?? undefined,
    usage: db.usage ?? undefined,
    term: db.term ?? undefined,
    planhatLink: db.planhat_link ?? undefined,
    currentAgreementLink: db.current_agreement_link ?? undefined,
    autoRenew: db.auto_renew ?? false,
    product: db.product ?? undefined,
    csNotes: db.cs_notes ?? undefined,
    nextStep: db.next_step ?? undefined,
    healthStatus: db.health_status ?? 'green',
    churnRisk: (db.churn_risk as ChurnRisk) ?? 'low',
    linkedOpportunityId: db.linked_opportunity_id ?? undefined,
    riskReason: db.risk_reason ?? undefined,
    renewalStage: db.renewal_stage ?? undefined,
    owner: db.owner ?? '',
    notes: db.notes ?? undefined,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

function storeRenewalToDb(r: Renewal, userId: string): any {
  return {
    id: r.id,
    user_id: userId,
    account_id: r.accountId || null,
    account_name: r.accountName,
    csm: r.csm || null,
    arr: r.arr,
    renewal_due: r.renewalDue,
    renewal_quarter: r.renewalQuarter || null,
    entitlements: r.entitlements || null,
    usage: r.usage || null,
    term: r.term || null,
    planhat_link: r.planhatLink || null,
    current_agreement_link: r.currentAgreementLink || null,
    auto_renew: r.autoRenew,
    product: r.product || null,
    cs_notes: r.csNotes || null,
    next_step: r.nextStep || null,
    health_status: r.healthStatus,
    churn_risk: r.churnRisk,
    linked_opportunity_id: r.linkedOpportunityId || null,
    risk_reason: r.riskReason || null,
    renewal_stage: r.renewalStage || null,
    owner: r.owner || null,
    notes: r.notes || null,
  };
}

// ── Sync Hook ─────────────────────────────────────────────

let _isHydrating = false;

export function useDataSync() {
  const { user } = useAuth();
  const userId = user?.id;
  const hasHydrated = useRef(false);
  const writeTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const prevState = useRef<{
    accounts: Account[];
    opportunities: Opportunity[];
    renewals: Renewal[];
  } | null>(null);

  // Initial hydration: DB → Zustand
  useEffect(() => {
    if (!userId || hasHydrated.current) return;
    
    async function hydrate() {
      _isHydrating = true;
      try {
        const [accountsRes, oppsRes, renewalsRes] = await Promise.all([
          supabase.from('accounts').select('*').order('name'),
          supabase.from('opportunities').select('*').order('created_at', { ascending: false }),
          supabase.from('renewals').select('*').order('renewal_due'),
        ]);

        const dbAccounts = (accountsRes.data || []).map(dbAccountToStore);
        const dbOpps = (oppsRes.data || []).map(dbOpportunityToStore);
        const dbRenewals = (renewalsRes.data || []).map(dbRenewalToStore);

        console.log(`[DataSync] Hydrating: ${dbAccounts.length} accounts, ${dbOpps.length} opps, ${dbRenewals.length} renewals from DB`);

        const store = useStore.getState();
        
        const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        
        // Migrate non-UUID local items by assigning new UUIDs so they sync to DB
        const genUUID = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, '');
        
        const migrateId = <T extends { id: string }>(item: T): T => {
          if (isUUID(item.id)) return item;
          return { ...item, id: genUUID() };
        };
        
        // Only migrate local items that have valid content (not empty seed data)
        const localAccounts = store.accounts.filter(a => a.name).map(migrateId);
        const localOpps = store.opportunities.filter(o => o.name).map(migrateId);
        const localRenewals = store.renewals.filter(r => r.accountName).map(migrateId);

        // DB is the source of truth — start with DB data, then add local-only items
        const dbAccountIds = new Set(dbAccounts.map(a => a.id));
        const dbOppIds = new Set(dbOpps.map(o => o.id));
        const dbRenewalIds = new Set(dbRenewals.map(r => r.id));
        
        // Find local items that don't exist in DB (by name match to avoid duplicates from migration)
        const dbAccountNames = new Set(dbAccounts.map(a => a.name.toLowerCase()));
        const dbOppNames = new Set(dbOpps.map(o => o.name.toLowerCase()));
        const dbRenewalNames = new Set(dbRenewals.map(r => r.accountName.toLowerCase()));
        
        const newLocalAccounts = localAccounts.filter(a => 
          !dbAccountIds.has(a.id) && !dbAccountNames.has(a.name.toLowerCase())
        );
        const newLocalOpps = localOpps.filter(o => 
          !dbOppIds.has(o.id) && !dbOppNames.has(o.name.toLowerCase())
        );
        const newLocalRenewals = localRenewals.filter(r => 
          !dbRenewalIds.has(r.id) && !dbRenewalNames.has(r.accountName.toLowerCase())
        );

        const mergedAccounts = [...dbAccounts, ...newLocalAccounts];
        const mergedOpps = [...dbOpps, ...newLocalOpps];
        const mergedRenewals = [...dbRenewals, ...newLocalRenewals];

        console.log(`[DataSync] Merged: ${mergedAccounts.length} accounts, ${mergedOpps.length} opps, ${mergedRenewals.length} renewals`);

        useStore.setState({
          accounts: mergedAccounts,
          opportunities: mergedOpps,
          renewals: mergedRenewals,
        });

        // Push any new local-only items to DB
        if (newLocalAccounts.length > 0) {
          await supabase.from('accounts').upsert(
            newLocalAccounts.map(a => storeAccountToDb(a, userId))
          );
        }
        if (newLocalOpps.length > 0) {
          await supabase.from('opportunities').upsert(
            newLocalOpps.map(o => storeOpportunityToDb(o, userId))
          );
        }
        if (newLocalRenewals.length > 0) {
          await supabase.from('renewals').upsert(
            newLocalRenewals.map(r => storeRenewalToDb(r, userId))
          );
        }

        // Snapshot current state for diffing
        const currentState = useStore.getState();
        prevState.current = {
          accounts: currentState.accounts,
          opportunities: currentState.opportunities,
          renewals: currentState.renewals,
        };
        hasHydrated.current = true;
      } catch (err) {
        console.error('[DataSync] Hydration error:', err);
      } finally {
        _isHydrating = false;
      }
    }

    hydrate();
  }, [userId]);

  // Write-back: Zustand → DB (debounced, only changed records)
  useEffect(() => {
    if (!userId) return;

    const unsub = useStore.subscribe((state) => {
      if (_isHydrating || !prevState.current || !hasHydrated.current) return;

      const prev = prevState.current;

      const scheduleWrite = (key: string, fn: () => Promise<void>) => {
        if (writeTimers.current[key]) clearTimeout(writeTimers.current[key]);
        writeTimers.current[key] = setTimeout(async () => {
          try { await fn(); } catch (err) {
            console.error(`[DataSync] Write-back error for ${key}:`, err);
          }
        }, 1500);
      };

      // Diff accounts - find changed/added/deleted
      if (state.accounts !== prev.accounts) {
        scheduleWrite('accounts', async () => {
          const prevMap = new Map(prev.accounts.map(a => [a.id, a]));
          const currMap = new Map(state.accounts.map(a => [a.id, a]));
          
          // Upsert changed or new
          const toUpsert = state.accounts.filter(a => {
            const old = prevMap.get(a.id);
            return !old || old.updatedAt !== a.updatedAt || old !== a;
          });
          
          // Delete removed
          const deletedIds = prev.accounts
            .filter(a => !currMap.has(a.id))
            .map(a => a.id);
          
          if (toUpsert.length > 0) {
            await supabase.from('accounts').upsert(
              toUpsert.map(a => storeAccountToDb(a, userId))
            );
          }
          if (deletedIds.length > 0) {
            await supabase.from('accounts').delete().in('id', deletedIds);
          }
          
          prevState.current = { ...prevState.current!, accounts: state.accounts };
        });
      }

      if (state.opportunities !== prev.opportunities) {
        scheduleWrite('opportunities', async () => {
          const prevMap = new Map(prev.opportunities.map(o => [o.id, o]));
          const currMap = new Map(state.opportunities.map(o => [o.id, o]));
          
          const toUpsert = state.opportunities.filter(o => {
            const old = prevMap.get(o.id);
            return !old || old.updatedAt !== o.updatedAt || old !== o;
          });
          
          const deletedIds = prev.opportunities
            .filter(o => !currMap.has(o.id))
            .map(o => o.id);
          
          if (toUpsert.length > 0) {
            await supabase.from('opportunities').upsert(
              toUpsert.map(o => storeOpportunityToDb(o, userId))
            );
          }
          if (deletedIds.length > 0) {
            await supabase.from('opportunities').delete().in('id', deletedIds);
          }
          
          prevState.current = { ...prevState.current!, opportunities: state.opportunities };
        });
      }

      if (state.renewals !== prev.renewals) {
        scheduleWrite('renewals', async () => {
          const prevMap = new Map(prev.renewals.map(r => [r.id, r]));
          const currMap = new Map(state.renewals.map(r => [r.id, r]));
          
          const toUpsert = state.renewals.filter(r => {
            const old = prevMap.get(r.id);
            return !old || old.updatedAt !== r.updatedAt || old !== r;
          });
          
          const deletedIds = prev.renewals
            .filter(r => !currMap.has(r.id))
            .map(r => r.id);
          
          if (toUpsert.length > 0) {
            await supabase.from('renewals').upsert(
              toUpsert.map(r => storeRenewalToDb(r, userId))
            );
          }
          if (deletedIds.length > 0) {
            await supabase.from('renewals').delete().in('id', deletedIds);
          }
          
          prevState.current = { ...prevState.current!, renewals: state.renewals };
        });
      }
    });

    return () => {
      unsub();
      Object.values(writeTimers.current).forEach(t => clearTimeout(t));
    };
  }, [userId]);
}

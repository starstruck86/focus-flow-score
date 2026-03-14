// Data Sync Bridge: Hydrates Zustand from DB on load, writes mutations back
import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/store/useStore';
import { supabase } from '@/integrations/supabase/client';
import type { Account, Contact, Renewal, Opportunity, Task, ChurnRisk } from '@/types';

// ── Sync status (exported for save indicator) ─────────────
let _lastSyncTime: number | null = null;
let _syncListeners: Array<() => void> = [];

export function getLastSyncTime() { return _lastSyncTime; }
export function onSyncStatusChange(fn: () => void) {
  _syncListeners.push(fn);
  return () => { _syncListeners = _syncListeners.filter(l => l !== fn); };
}
function notifySyncListeners() { _syncListeners.forEach(fn => fn()); }

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
    id: a.id, user_id: userId, name: a.name,
    website: a.website || null, industry: a.industry || null,
    priority: a.priority, tier: a.tier, account_status: a.accountStatus,
    motion: a.motion, salesforce_link: a.salesforceLink || null,
    salesforce_id: a.salesforceId || null, planhat_link: a.planhatLink || null,
    current_agreement_link: a.currentAgreementLink || null,
    tech_stack: a.techStack, tech_stack_notes: a.techStackNotes || null,
    tech_fit_flag: a.techFitFlag, outreach_status: a.outreachStatus,
    cadence_name: a.cadenceName || null, last_touch_date: a.lastTouchDate || null,
    last_touch_type: a.lastTouchType || null, touches_this_week: a.touchesThisWeek,
    next_step: a.nextStep || null, next_touch_due: a.nextTouchDue || null,
    notes: a.notes || null, mar_tech: a.marTech || null,
    ecommerce: a.ecommerce || null, contact_status: a.contactStatus || null,
    tags: a.tags,
    direct_ecommerce: a.directEcommerce ?? null,
    email_sms_capture: a.emailSmsCapture ?? null,
    loyalty_membership: a.loyaltyMembership ?? null,
    category_complexity: a.categoryComplexity ?? null,
    mobile_app: a.mobileApp ?? null,
    marketing_platform_detected: a.marketingPlatformDetected || null,
    crm_lifecycle_team_size: a.crmLifecycleTeamSize ?? null,
    trigger_events: a.triggerEvents || [],
    icp_fit_score: a.icpFitScore ?? null, timing_score: a.timingScore ?? null,
    priority_score: a.priorityScore ?? null, lifecycle_tier: a.lifecycleTier || null,
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
    id: db.id, name: db.name, accountId: db.account_id ?? undefined,
    salesforceLink: db.salesforce_link ?? undefined,
    salesforceId: db.salesforce_id ?? undefined,
    linkedContactIds: [], status: db.status ?? 'active',
    stage: db.stage ?? '', arr: db.arr ?? undefined,
    churnRisk: db.churn_risk ?? undefined, closeDate: db.close_date ?? undefined,
    nextStep: db.next_step ?? undefined, nextStepDate: db.next_step_date ?? undefined,
    lastTouchDate: db.last_touch_date ?? undefined, notes: db.notes ?? undefined,
    activityLog: db.activity_log ?? [], createdAt: db.created_at,
    updatedAt: db.updated_at, dealType: db.deal_type ?? undefined,
    paymentTerms: db.payment_terms ?? undefined, termMonths: db.term_months ?? undefined,
    priorContractArr: db.prior_contract_arr ?? undefined,
    renewalArr: db.renewal_arr ?? undefined,
    oneTimeAmount: db.one_time_amount ?? undefined,
    isNewLogo: db.is_new_logo ?? undefined,
  };
}

function storeOpportunityToDb(o: Opportunity, userId: string): any {
  return {
    id: o.id, user_id: userId, name: o.name,
    account_id: o.accountId || null, salesforce_link: o.salesforceLink || null,
    salesforce_id: o.salesforceId || null, status: o.status, stage: o.stage,
    arr: o.arr ?? null, churn_risk: o.churnRisk || null,
    close_date: o.closeDate || null, next_step: o.nextStep || null,
    next_step_date: o.nextStepDate || null, last_touch_date: o.lastTouchDate || null,
    notes: o.notes || null, activity_log: o.activityLog || [],
    deal_type: o.dealType || null, payment_terms: o.paymentTerms || null,
    term_months: o.termMonths ?? null, prior_contract_arr: o.priorContractArr ?? null,
    renewal_arr: o.renewalArr ?? null, one_time_amount: o.oneTimeAmount ?? null,
    is_new_logo: o.isNewLogo ?? null,
  };
}

function dbRenewalToStore(db: any): Renewal {
  const dueDate = new Date(db.renewal_due);
  const today = new Date();
  const daysToRenewal = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const quarter = `Q${Math.ceil((dueDate.getMonth() + 1) / 3)} ${dueDate.getFullYear()}`;
  return {
    id: db.id, accountId: db.account_id ?? undefined,
    accountName: db.account_name, csm: db.csm ?? undefined,
    arr: db.arr ?? 0, renewalDue: db.renewal_due, daysToRenewal,
    renewalQuarter: db.renewal_quarter ?? quarter,
    entitlements: db.entitlements ?? undefined, usage: db.usage ?? undefined,
    term: db.term ?? undefined, planhatLink: db.planhat_link ?? undefined,
    currentAgreementLink: db.current_agreement_link ?? undefined,
    autoRenew: db.auto_renew ?? false, product: db.product ?? undefined,
    csNotes: db.cs_notes ?? undefined, nextStep: db.next_step ?? undefined,
    healthStatus: db.health_status ?? 'green',
    churnRisk: (db.churn_risk as ChurnRisk) ?? 'low',
    linkedOpportunityId: db.linked_opportunity_id ?? undefined,
    riskReason: db.risk_reason ?? undefined,
    renewalStage: db.renewal_stage ?? undefined,
    owner: db.owner ?? '', notes: db.notes ?? undefined,
    createdAt: db.created_at, updatedAt: db.updated_at,
  };
}

function storeRenewalToDb(r: Renewal, userId: string): any {
  return {
    id: r.id, user_id: userId, account_id: r.accountId || null,
    account_name: r.accountName, csm: r.csm || null, arr: r.arr,
    renewal_due: r.renewalDue, renewal_quarter: r.renewalQuarter || null,
    entitlements: r.entitlements || null, usage: r.usage || null,
    term: r.term || null, planhat_link: r.planhatLink || null,
    current_agreement_link: r.currentAgreementLink || null,
    auto_renew: r.autoRenew, product: r.product || null,
    cs_notes: r.csNotes || null, next_step: r.nextStep || null,
    health_status: r.healthStatus, churn_risk: r.churnRisk,
    linked_opportunity_id: r.linkedOpportunityId || null,
    risk_reason: r.riskReason || null, renewal_stage: r.renewalStage || null,
    owner: r.owner || null, notes: r.notes || null,
  };
}

// ── Contact mappers ───────────────────────────────────────

function dbContactToStore(db: any): Contact {
  return {
    id: db.id, accountId: db.account_id ?? '',
    name: db.name, title: db.title ?? undefined,
    department: db.department ?? undefined, seniority: db.seniority ?? undefined,
    email: db.email ?? undefined, linkedInUrl: db.linkedin_url ?? undefined,
    salesforceLink: db.salesforce_link ?? undefined,
    salesforceId: db.salesforce_id ?? undefined,
    status: db.status ?? 'target', lastTouchDate: db.last_touch_date ?? undefined,
    preferredChannel: db.preferred_channel ?? undefined,
    notes: db.notes ?? undefined,
    createdAt: db.created_at, updatedAt: db.updated_at,
  };
}

function storeContactToDb(c: Contact, userId: string): any {
  return {
    id: c.id, user_id: userId, account_id: c.accountId || null,
    name: c.name, title: c.title || null,
    department: c.department || null, seniority: c.seniority || null,
    email: c.email || null, linkedin_url: c.linkedInUrl || null,
    salesforce_link: c.salesforceLink || null,
    salesforce_id: c.salesforceId || null,
    status: c.status, last_touch_date: c.lastTouchDate || null,
    preferred_channel: c.preferredChannel || null,
    notes: c.notes || null,
  };
}

// ── Task mappers ──────────────────────────────────────────

function dbTaskToStore(db: any): Task {
  return {
    id: db.id, title: db.title,
    workstream: db.workstream ?? 'pg',
    status: db.status ?? 'next',
    priority: db.priority ?? 'P1',
    dueDate: db.due_date ?? undefined,
    linkedAccountId: db.linked_account_id ?? undefined,
    linkedOpportunityId: db.linked_opportunity_id ?? undefined,
    notes: db.notes ?? undefined,
    completedAt: db.completed_at ?? undefined,
    motion: db.motion ?? undefined,
    linkedRecordType: db.linked_record_type ?? undefined,
    linkedRecordId: db.linked_record_id ?? undefined,
    linkedContactId: db.linked_contact_id ?? undefined,
    category: db.category ?? undefined,
    estimatedMinutes: db.estimated_minutes ?? undefined,
    subtasks: db.subtasks ?? [],
    createdAt: db.created_at, updatedAt: db.updated_at,
  };
}

function storeTaskToDb(t: Task, userId: string): any {
  return {
    id: t.id, user_id: userId, title: t.title,
    workstream: t.workstream, status: t.status, priority: t.priority,
    due_date: t.dueDate || null,
    linked_account_id: t.linkedAccountId || null,
    linked_opportunity_id: t.linkedOpportunityId || null,
    notes: t.notes || null, completed_at: t.completedAt || null,
    motion: t.motion || null, linked_record_type: t.linkedRecordType || null,
    linked_record_id: t.linkedRecordId || null,
    linked_contact_id: t.linkedContactId || null,
    category: t.category || null,
    estimated_minutes: t.estimatedMinutes ?? null,
    subtasks: t.subtasks || [],
  };
}

// ── Sync Hook ─────────────────────────────────────────────

let _isHydrating = false;

// Pending writes for flush-on-unload
let _pendingWrites: Map<string, () => Promise<void>> = new Map();

export function useDataSync(onHydrated?: (v: boolean) => void) {
  const { user } = useAuth();
  const userId = user?.id;
  const hasHydrated = useRef(false);
  const writeTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const prevState = useRef<{
    accounts: Account[];
    opportunities: Opportunity[];
    renewals: Renewal[];
    contacts: Contact[];
    tasks: Task[];
  } | null>(null);

  // Initial hydration: DB → Zustand
  useEffect(() => {
    if (!userId || hasHydrated.current) return;
    
    async function hydrate() {
      _isHydrating = true;
      try {
        const [accountsRes, oppsRes, renewalsRes, contactsRes, tasksRes] = await Promise.all([
          supabase.from('accounts').select('*').order('name'),
          supabase.from('opportunities').select('*').order('created_at', { ascending: false }),
          supabase.from('renewals').select('*').order('renewal_due'),
          supabase.from('contacts').select('*').order('name'),
          supabase.from('tasks').select('*').order('created_at', { ascending: false }),
        ]);

        const dbAccounts = (accountsRes.data || []).map(dbAccountToStore);
        const dbOpps = (oppsRes.data || []).map(dbOpportunityToStore);
        const dbRenewals = (renewalsRes.data || []).map(dbRenewalToStore);
        const dbContacts = (contactsRes.data || []).map(dbContactToStore);
        const dbTasks = (tasksRes.data || []).map(dbTaskToStore);

        console.log(`[DataSync] Hydrating: ${dbAccounts.length} accounts, ${dbOpps.length} opps, ${dbRenewals.length} renewals, ${dbContacts.length} contacts, ${dbTasks.length} tasks`);

        const store = useStore.getState();
        
        const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const genUUID = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, '');
        const migrateId = <T extends { id: string }>(item: T): T => {
          if (isUUID(item.id)) return item;
          return { ...item, id: genUUID() };
        };
        
        const localAccounts = store.accounts.filter(a => a.name).map(migrateId);
        const localOpps = store.opportunities.filter(o => o.name).map(migrateId);
        const localRenewals = store.renewals.filter(r => r.accountName).map(migrateId);
        const localContacts = store.contacts.filter(c => c.name).map(migrateId);
        const localTasks = store.tasks.filter(t => t.title).map(migrateId);

        // DB is source of truth — merge local-only items
        const dbAccountIds = new Set(dbAccounts.map(a => a.id));
        const dbOppIds = new Set(dbOpps.map(o => o.id));
        const dbRenewalIds = new Set(dbRenewals.map(r => r.id));
        const dbContactIds = new Set(dbContacts.map(c => c.id));
        const dbTaskIds = new Set(dbTasks.map(t => t.id));
        
        const dbAccountNames = new Set(dbAccounts.map(a => a.name.toLowerCase()));
        const dbOppNames = new Set(dbOpps.map(o => o.name.toLowerCase()));
        const dbRenewalNames = new Set(dbRenewals.map(r => r.accountName.toLowerCase()));
        
        const newLocalAccounts = localAccounts.filter(a => !dbAccountIds.has(a.id) && !dbAccountNames.has(a.name.toLowerCase()));
        const newLocalOpps = localOpps.filter(o => !dbOppIds.has(o.id) && !dbOppNames.has(o.name.toLowerCase()));
        const newLocalRenewals = localRenewals.filter(r => !dbRenewalIds.has(r.id) && !dbRenewalNames.has(r.accountName.toLowerCase()));
        const newLocalContacts = localContacts.filter(c => !dbContactIds.has(c.id));
        const newLocalTasks = localTasks.filter(t => !dbTaskIds.has(t.id));

        const mergedAccounts = [...dbAccounts, ...newLocalAccounts];
        const mergedOpps = [...dbOpps, ...newLocalOpps];
        const mergedRenewals = [...dbRenewals, ...newLocalRenewals];
        const mergedContacts = [...dbContacts, ...newLocalContacts];
        const mergedTasks = [...dbTasks, ...newLocalTasks];

        useStore.setState({
          accounts: mergedAccounts,
          opportunities: mergedOpps,
          renewals: mergedRenewals,
          contacts: mergedContacts,
          tasks: mergedTasks,
        });

        // Push local-only items to DB
        if (newLocalAccounts.length > 0) {
          await supabase.from('accounts').upsert(newLocalAccounts.map(a => storeAccountToDb(a, userId)));
        }
        if (newLocalOpps.length > 0) {
          await supabase.from('opportunities').upsert(newLocalOpps.map(o => storeOpportunityToDb(o, userId)));
        }
        if (newLocalRenewals.length > 0) {
          await supabase.from('renewals').upsert(newLocalRenewals.map(r => storeRenewalToDb(r, userId)));
        }
        if (newLocalContacts.length > 0) {
          await supabase.from('contacts').upsert(newLocalContacts.map(c => storeContactToDb(c, userId)));
        }
        if (newLocalTasks.length > 0) {
          await supabase.from('tasks').upsert(newLocalTasks.map(t => storeTaskToDb(t, userId)) as any);
        }

        // Snapshot for diffing
        const currentState = useStore.getState();
        prevState.current = {
          accounts: currentState.accounts,
          opportunities: currentState.opportunities,
          renewals: currentState.renewals,
          contacts: currentState.contacts,
          tasks: currentState.tasks,
        };
        hasHydrated.current = true;
        onHydrated?.(true);
        _lastSyncTime = Date.now();
        notifySyncListeners();
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
        _pendingWrites.set(key, fn);
        if (writeTimers.current[key]) clearTimeout(writeTimers.current[key]);
        writeTimers.current[key] = setTimeout(async () => {
          try {
            await fn();
            _pendingWrites.delete(key);
            _lastSyncTime = Date.now();
            notifySyncListeners();
          } catch (err) {
            console.error(`[DataSync] Write-back error for ${key}:`, err);
            const { toast } = await import('@/hooks/use-toast');
            toast({
              title: 'Sync failed',
              description: `Your ${key} changes couldn't save. They're preserved locally and will retry.`,
              variant: 'destructive',
            });
          }
        }, 1500);
      };

      // Generic diff helper
      const diffAndSync = <T extends { id: string; updatedAt?: string }>(
        key: string,
        prevItems: T[],
        currItems: T[],
        toDb: (item: T, uid: string) => any,
        table: string,
      ) => {
        if (currItems === prevItems) return;
        scheduleWrite(key, async () => {
          const prevMap = new Map(prevItems.map(i => [i.id, i]));
          const currMap = new Map(currItems.map(i => [i.id, i]));
          
          const toUpsert = currItems.filter(i => {
            const old = prevMap.get(i.id);
            return !old || old.updatedAt !== i.updatedAt || old !== i;
          });
          
          const deletedIds = prevItems.filter(i => !currMap.has(i.id)).map(i => i.id);
          
          if (toUpsert.length > 0) {
            await supabase.from(table as any).upsert(toUpsert.map(i => toDb(i, userId)));
          }
          if (deletedIds.length > 0) {
            await supabase.from(table as any).delete().in('id', deletedIds);
          }
          
          prevState.current = { ...prevState.current!, [key]: currItems };
        });
      };

      diffAndSync('accounts', prev.accounts, state.accounts, storeAccountToDb, 'accounts');
      diffAndSync('opportunities', prev.opportunities, state.opportunities, storeOpportunityToDb, 'opportunities');
      diffAndSync('renewals', prev.renewals, state.renewals, storeRenewalToDb, 'renewals');
      diffAndSync('contacts', prev.contacts, state.contacts, storeContactToDb, 'contacts');
      diffAndSync('tasks', prev.tasks, state.tasks, storeTaskToDb, 'tasks');
    });

    return () => {
      unsub();
      Object.values(writeTimers.current).forEach(t => clearTimeout(t));
    };
  }, [userId]);

  // Flush pending writes on page unload (prevent data loss on tab close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Use sendBeacon-style sync flush
      _pendingWrites.forEach((fn, key) => {
        try { fn(); } catch (e) { console.error(`[DataSync] Flush error for ${key}:`, e); }
      });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);
}

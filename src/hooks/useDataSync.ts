// Data Sync Bridge: Hydrates Zustand from DB on load, writes mutations back
import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/store/useStore';
import { supabase } from '@/integrations/supabase/client';
import { fromActiveAccounts } from '@/data/accounts';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { Account, Contact, Renewal, Opportunity, Task, ChurnRisk } from '@/types';
import type { Database, Json } from '@/integrations/supabase/types';

// Row types from the generated schema
type AccountRow = Database['public']['Tables']['accounts']['Row'];
type AccountInsert = Database['public']['Tables']['accounts']['Insert'];
type OpportunityRow = Database['public']['Tables']['opportunities']['Row'];
type OpportunityInsert = Database['public']['Tables']['opportunities']['Insert'];
type RenewalRow = Database['public']['Tables']['renewals']['Row'];
type RenewalInsert = Database['public']['Tables']['renewals']['Insert'];
type ContactRow = Database['public']['Tables']['contacts']['Row'];
type ContactInsert = Database['public']['Tables']['contacts']['Insert'];
type TaskRow = Database['public']['Tables']['tasks']['Row'];
type TaskInsert = Database['public']['Tables']['tasks']['Insert'];

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

export function dbAccountToStore(db: AccountRow): Account {
  return {
    id: db.id,
    name: db.name,
    website: db.website ?? undefined,
    industry: db.industry ?? undefined,
    priority: (db.priority ?? 'medium') as Account['priority'],
    tier: (db.tier ?? 'C') as Account['tier'],
    accountStatus: (db.account_status ?? 'researching') as Account['accountStatus'],
    motion: (db.motion ?? 'new-logo') as Account['motion'],
    salesforceLink: db.salesforce_link ?? undefined,
    salesforceId: db.salesforce_id ?? undefined,
    planhatLink: db.planhat_link ?? undefined,
    currentAgreementLink: db.current_agreement_link ?? undefined,
    techStack: db.tech_stack ?? [],
    techStackNotes: db.tech_stack_notes ?? undefined,
    techFitFlag: (db.tech_fit_flag ?? 'good') as Account['techFitFlag'],
    outreachStatus: (db.outreach_status ?? 'not-started') as Account['outreachStatus'],
    cadenceName: db.cadence_name ?? undefined,
    lastTouchDate: db.last_touch_date ?? undefined,
    lastTouchType: (db.last_touch_type ?? undefined) as Account['lastTouchType'],
    touchesThisWeek: db.touches_this_week ?? 0,
    nextStep: db.next_step ?? undefined,
    nextTouchDue: db.next_touch_due ?? undefined,
    notes: db.notes ?? undefined,
    marTech: db.mar_tech ?? undefined,
    ecommerce: db.ecommerce ?? undefined,
    contactStatus: (db.contact_status ?? undefined) as Account['contactStatus'],
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
    triggerEvents: db.trigger_events as Account['triggerEvents'] ?? [],
    icpFitScore: db.icp_fit_score != null ? Number(db.icp_fit_score) : undefined,
    timingScore: db.timing_score != null ? Number(db.timing_score) : undefined,
    priorityScore: db.priority_score != null ? Number(db.priority_score) : undefined,
    lifecycleTier: db.lifecycle_tier ?? undefined,
    highProbabilityBuyer: db.high_probability_buyer ?? false,
    triggeredAccount: db.triggered_account ?? false,
    confidenceScore: db.confidence_score != null ? Number(db.confidence_score) : undefined,
    lastEnrichedAt: db.last_enriched_at ?? undefined,
    enrichmentSourceSummary: db.enrichment_source_summary ?? undefined,
    enrichmentEvidence: db.enrichment_evidence as Account['enrichmentEvidence'] ?? undefined,
    lifecycleOverride: db.lifecycle_override ?? false,
    lifecycleOverrideReason: db.lifecycle_override_reason ?? undefined,
    icpScoreOverride: db.icp_score_override != null ? Number(db.icp_score_override) : undefined,
    tierOverride: db.tier_override ?? undefined,
  };
}

function storeAccountToDb(a: Account, userId: string): AccountInsert {
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
    trigger_events: (a.triggerEvents || []) as unknown as Json,
    icp_fit_score: a.icpFitScore ?? null, timing_score: a.timingScore ?? null,
    priority_score: a.priorityScore ?? null, lifecycle_tier: a.lifecycleTier || null,
    high_probability_buyer: a.highProbabilityBuyer ?? false,
    triggered_account: a.triggeredAccount ?? false,
    confidence_score: a.confidenceScore ?? null,
    last_enriched_at: a.lastEnrichedAt || null,
    enrichment_source_summary: a.enrichmentSourceSummary || null,
    enrichment_evidence: (a.enrichmentEvidence || {}) as Json,
    lifecycle_override: a.lifecycleOverride ?? false,
    lifecycle_override_reason: a.lifecycleOverrideReason || null,
    icp_score_override: a.icpScoreOverride ?? null,
    tier_override: a.tierOverride || null,
  };
}

function dbOpportunityToStore(db: OpportunityRow): Opportunity {
  return {
    id: db.id, name: db.name, accountId: db.account_id ?? undefined,
    salesforceLink: db.salesforce_link ?? undefined,
    salesforceId: db.salesforce_id ?? undefined,
    linkedContactIds: [], status: (db.status ?? 'active') as Opportunity['status'],
    stage: (db.stage ?? '') as Opportunity['stage'], arr: db.arr ?? undefined,
    churnRisk: (db.churn_risk ?? undefined) as Opportunity['churnRisk'], closeDate: db.close_date ?? undefined,
    nextStep: db.next_step ?? undefined, nextStepDate: db.next_step_date ?? undefined,
    lastTouchDate: db.last_touch_date ?? undefined, notes: db.notes ?? undefined,
    activityLog: (db.activity_log ?? []) as unknown as Opportunity['activityLog'], createdAt: db.created_at,
    updatedAt: db.updated_at, dealType: (db.deal_type ?? undefined) as Opportunity['dealType'],
    paymentTerms: (db.payment_terms ?? undefined) as Opportunity['paymentTerms'], termMonths: db.term_months ?? undefined,
    priorContractArr: db.prior_contract_arr ?? undefined,
    renewalArr: db.renewal_arr ?? undefined,
    oneTimeAmount: db.one_time_amount ?? undefined,
    isNewLogo: db.is_new_logo ?? undefined,
  };
}

function storeOpportunityToDb(o: Opportunity, userId: string): OpportunityInsert {
  return {
    id: o.id, user_id: userId, name: o.name,
    account_id: o.accountId || null, salesforce_link: o.salesforceLink || null,
    salesforce_id: o.salesforceId || null, status: o.status, stage: o.stage,
    arr: o.arr ?? null, churn_risk: o.churnRisk || null,
    close_date: o.closeDate || null, next_step: o.nextStep || null,
    next_step_date: o.nextStepDate || null, last_touch_date: o.lastTouchDate || null,
    notes: o.notes || null, activity_log: (o.activityLog || []) as unknown as Json,
    deal_type: o.dealType || null, payment_terms: o.paymentTerms || null,
    term_months: o.termMonths ?? null, prior_contract_arr: o.priorContractArr ?? null,
    renewal_arr: o.renewalArr ?? null, one_time_amount: o.oneTimeAmount ?? null,
    is_new_logo: o.isNewLogo ?? null,
  };
}

function dbRenewalToStore(db: RenewalRow): Renewal {
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
    healthStatus: (db.health_status ?? 'green') as Renewal['healthStatus'],
    churnRisk: (db.churn_risk as ChurnRisk) ?? 'low',
    linkedOpportunityId: db.linked_opportunity_id ?? undefined,
    riskReason: db.risk_reason ?? undefined,
    renewalStage: db.renewal_stage ?? undefined,
    owner: db.owner ?? '', notes: db.notes ?? undefined,
    createdAt: db.created_at, updatedAt: db.updated_at,
  };
}

function storeRenewalToDb(r: Renewal, userId: string): RenewalInsert {
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

function dbContactToStore(db: ContactRow): Contact {
  return {
    id: db.id, accountId: db.account_id ?? '',
    name: db.name, title: db.title ?? undefined,
    department: db.department ?? undefined, seniority: db.seniority ?? undefined,
    email: db.email ?? undefined, linkedInUrl: db.linkedin_url ?? undefined,
    salesforceLink: db.salesforce_link ?? undefined,
    salesforceId: db.salesforce_id ?? undefined,
    status: (db.status ?? 'target') as Contact['status'], lastTouchDate: db.last_touch_date ?? undefined,
    preferredChannel: (db.preferred_channel ?? undefined) as Contact['preferredChannel'],
    notes: db.notes ?? undefined,
    createdAt: db.created_at, updatedAt: db.updated_at,
  };
}

function storeContactToDb(c: Contact, userId: string): ContactInsert {
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

function dbTaskToStore(db: TaskRow): Task {
  return {
    id: db.id, title: db.title,
    workstream: (db.workstream ?? 'pg') as Task['workstream'],
    status: (db.status ?? 'next') as Task['status'],
    priority: (db.priority ?? 'P1') as Task['priority'],
    dueDate: db.due_date ?? undefined,
    linkedAccountId: db.linked_account_id ?? undefined,
    linkedOpportunityId: db.linked_opportunity_id ?? undefined,
    notes: db.notes ?? undefined,
    completedAt: db.completed_at ?? undefined,
    motion: (db.motion ?? undefined) as Task['motion'],
    linkedRecordType: (db.linked_record_type ?? undefined) as Task['linkedRecordType'],
    linkedRecordId: db.linked_record_id ?? undefined,
    linkedContactId: db.linked_contact_id ?? undefined,
    category: (db.category ?? undefined) as Task['category'],
    estimatedMinutes: db.estimated_minutes ?? undefined,
    subtasks: db.subtasks as Task['subtasks'] ?? [],
    createdAt: db.created_at, updatedAt: db.updated_at,
  };
}

function storeTaskToDb(t: Task, userId: string): TaskInsert {
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
    subtasks: (t.subtasks || []) as unknown as Json,
  };
}

// ── Typed table write helpers ─────────────────────────────
// These replace the dynamic `from(table as any)` pattern with
// compile-time checked table access for each entity type.

type SyncTableName = 'accounts' | 'opportunities' | 'renewals' | 'contacts' | 'tasks';

async function typedUpsert(table: SyncTableName, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  switch (table) {
    case 'accounts':
      await supabase.from('accounts').upsert(rows as AccountInsert[]);
      break;
    case 'opportunities':
      await supabase.from('opportunities').upsert(rows as OpportunityInsert[]);
      break;
    case 'renewals':
      await supabase.from('renewals').upsert(rows as RenewalInsert[]);
      break;
    case 'contacts':
      await supabase.from('contacts').upsert(rows as ContactInsert[]);
      break;
    case 'tasks':
      await supabase.from('tasks').upsert(rows as TaskInsert[]);
      break;
  }
}

async function typedDelete(table: SyncTableName, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  switch (table) {
    case 'accounts':
      await supabase.from('accounts').delete().in('id', ids);
      break;
    case 'opportunities':
      await supabase.from('opportunities').delete().in('id', ids);
      break;
    case 'renewals':
      await supabase.from('renewals').delete().in('id', ids);
      break;
    case 'contacts':
      await supabase.from('contacts').delete().in('id', ids);
      break;
    case 'tasks':
      await supabase.from('tasks').delete().in('id', ids);
      break;
  }
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
          fromActiveAccounts().select('*').order('name'),
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
          await typedUpsert('accounts', newLocalAccounts.map(a => storeAccountToDb(a, userId)));
        }
        if (newLocalOpps.length > 0) {
          await typedUpsert('opportunities', newLocalOpps.map(o => storeOpportunityToDb(o, userId)));
        }
        if (newLocalRenewals.length > 0) {
          await typedUpsert('renewals', newLocalRenewals.map(r => storeRenewalToDb(r, userId)));
        }
        if (newLocalContacts.length > 0) {
          await typedUpsert('contacts', newLocalContacts.map(c => storeContactToDb(c, userId)));
        }
        if (newLocalTasks.length > 0) {
          await typedUpsert('tasks', newLocalTasks.map(t => storeTaskToDb(t, userId)));
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

        // Hydrate today's journal metrics into Zustand
        await hydrateJournalToday(userId);
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
            toast.error('Sync failed', {
              description: `Your ${key} changes couldn't save. They're preserved locally and will retry.`,
            });
          }
        }, 1500);
      };

      // Generic diff helper — uses typed table helpers instead of dynamic `from(table)`
      const diffAndSync = <T extends { id: string; updatedAt?: string }>(
        key: string,
        prevItems: T[],
        currItems: T[],
        toDb: (item: T, uid: string) => unknown,
        table: SyncTableName,
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
            await typedUpsert(table, toUpsert.map(i => toDb(i, userId)));
          }
          if (deletedIds.length > 0) {
            await typedDelete(table, deletedIds);
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
      // Flush pending writes immediately before clearing timers
      Object.values(writeTimers.current).forEach(t => clearTimeout(t));
      _pendingWrites.forEach((fn, key) => {
        fn().then(() => {
          _pendingWrites.delete(key);
          _lastSyncTime = Date.now();
          notifySyncListeners();
        }).catch(err => console.error(`[DataSync] Flush error for ${key}:`, err));
      });
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

  // ── Listen for Dave CRM mutations → re-fetch affected table ──
  useEffect(() => {
    if (!userId || !hasHydrated.current) return;

    const handler = async (e: Event) => {
      const table = (e as CustomEvent).detail?.table;
      if (!table) return;
      console.log(`[DataSync] Dave changed ${table}, re-fetching...`);

      _isHydrating = true;
      try {
        if (table === 'accounts') {
          const { data } = await fromActiveAccounts().select('*').order('name');
          if (data) {
            const mapped = data.map(dbAccountToStore);
            useStore.setState({ accounts: mapped });
            if (prevState.current) prevState.current.accounts = mapped;
          }
        } else if (table === 'opportunities') {
          const { data } = await supabase.from('opportunities').select('*').order('created_at', { ascending: false });
          if (data) {
            const mapped = data.map(dbOpportunityToStore);
            useStore.setState({ opportunities: mapped });
            if (prevState.current) prevState.current.opportunities = mapped;
          }
        } else if (table === 'renewals') {
          const { data } = await supabase.from('renewals').select('*').order('renewal_due');
          if (data) {
            const mapped = data.map(dbRenewalToStore);
            useStore.setState({ renewals: mapped });
            if (prevState.current) prevState.current.renewals = mapped;
          }
        } else if (table === 'contacts') {
          const { data } = await supabase.from('contacts').select('*').order('name');
          if (data) {
            const mapped = data.map(dbContactToStore);
            useStore.setState({ contacts: mapped });
            if (prevState.current) prevState.current.contacts = mapped;
          }
        } else if (table === 'tasks') {
          const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
          if (data) {
            const mapped = data.map(dbTaskToStore);
            useStore.setState({ tasks: mapped });
            if (prevState.current) prevState.current.tasks = mapped;
          }
        }
        _lastSyncTime = Date.now();
        notifySyncListeners();
      } finally {
        _isHydrating = false;
      }
    };

    window.addEventListener('dave-data-changed', handler);
    return () => window.removeEventListener('dave-data-changed', handler);
  }, [userId]);

  // ── Listen for Dave metrics updates → re-hydrate journal + invalidate React Query ──
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const handler = () => {
      // Small delay to let DB writes commit before re-fetching
      setTimeout(() => {
        hydrateJournalToday(userId);
        // Invalidate React Query cache so useTodayJournalEntry() and journal UI refresh
        const today = format(new Date(), 'yyyy-MM-dd');
        queryClient.invalidateQueries({ queryKey: ['journal-entry', today] });
        queryClient.invalidateQueries({ queryKey: ['journal-entry'] });
        queryClient.invalidateQueries({ queryKey: ['journal-week'] });
        queryClient.invalidateQueries({ queryKey: ['streak-events'] });
        queryClient.invalidateQueries({ queryKey: ['streak-summary'] });
      }, 300);
    };
    window.addEventListener('dave-metrics-updated', handler);
    return () => window.removeEventListener('dave-metrics-updated', handler);
  }, [userId, queryClient]);
}

// ── Journal hydration helper ──────────────────────────────────
async function hydrateJournalToday(userId: string) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const { data } = await supabase
    .from('daily_journal_entries')
    .select('dials, conversations, manual_emails, meetings_set, prospects_added, customer_meetings_held, opportunities_created, accounts_researched, contacts_prepped, personal_development, daily_score, checked_in, goal_met')
    .eq('user_id', userId)
    .eq('date', today)
    .limit(1);

  if (!data?.length) return;
  const row = data[0];

  const store = useStore.getState();
  store.initializeToday();
  store.updateActivityInputs({
    dials: row.dials || 0,
    emailsTotal: row.manual_emails || 0,
    customerMeetingsHeld: row.customer_meetings_held || 0,
  });
  store.updateRawInputs({
    coldCallsWithConversations: row.conversations || 0,
    initialMeetingsSet: row.meetings_set || 0,
    prospectsAddedToCadence: row.prospects_added || 0,
    opportunitiesCreated: row.opportunities_created || 0,
    personalDevelopment: row.personal_development ? 1 : 0,
  });
  console.log(`[DataSync] Journal hydrated: ${row.dials} dials, ${row.conversations} connects, ${row.manual_emails} emails`);
}

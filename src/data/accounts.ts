/**
 * Data access layer for accounts table.
 * ═══════════════════════════════════════════════════════════════════
 * REGRESSION-LOCKED INVARIANT: Soft-delete enforcement
 * ═══════════════════════════════════════════════════════════════════
 * All user-facing account reads MUST exclude soft-deleted rows.
 *
 * DB-LEVEL ENFORCEMENT: The `active_accounts` Postgres view
 * (SELECT * FROM accounts WHERE deleted_at IS NULL) is the canonical
 * read source. All read helpers below use this view.
 *
 * USE THESE HELPERS instead of raw `supabase.from('accounts').select(...)`:
 *   - activeAccounts()       → base query builder (via active_accounts view)
 *   - getAccounts()          → full list of active accounts
 *   - getAccountById()       → single account by ID (active only)
 *   - findAccountByName()    → lookup by name (active only)
 *   - resolveAccountByName() → Dave/tool pattern: user_id + ilike match
 *
 * WRITES go to `accounts` table directly (insert, update, soft-delete).
 * If you MUST bypass soft-delete for reads (admin/reconciliation),
 * use rawAccounts() and document why.
 * ═══════════════════════════════════════════════════════════════════
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type AccountRow = Database['public']['Tables']['accounts']['Row'];
type AccountInsert = Database['public']['Tables']['accounts']['Insert'];
type AccountUpdate = Database['public']['Tables']['accounts']['Update'];

export type { AccountRow, AccountInsert, AccountUpdate };

// ─── View helper ───────────────────────────────────────────────────
// The active_accounts view has identical columns to accounts but only
// returns rows where deleted_at IS NULL. Since it's not in generated
// Supabase types, we tell TypeScript to treat it as the accounts table.

/* eslint-disable @typescript-eslint/no-explicit-any */
type AccountsFrom = ReturnType<typeof supabase.from<'accounts'>>;

/**
 * Returns a typed Supabase query builder pointing at the `active_accounts` view.
 * Use this for ALL user-facing account reads — soft-delete is enforced at DB level.
 * Exported so other modules can use it directly instead of raw supabase.from('accounts').
 */
export function fromActiveAccounts(): AccountsFrom {
  return supabase.from('active_accounts' as any) as any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Core query builders ───────────────────────────────────────────

/**
 * Returns a Supabase query builder for active (non-deleted) accounts.
 * Backed by the active_accounts DB view — soft-delete is enforced at the DB layer.
 */
export function activeAccounts() {
  return fromView().select();
}

/**
 * Raw accounts query WITHOUT soft-delete filtering.
 * Only use for admin/reconciliation/migration flows.
 * Document why you need it.
 */
export function rawAccounts() {
  return supabase.from('accounts').select();
}

// ─── Convenience read helpers ──────────────────────────────────────

export async function getAccounts(): Promise<AccountRow[]> {
  const { data, error } = await fromView().select('*').order('name');
  if (error) throw error;
  return (data ?? []) as unknown as AccountRow[];
}

export async function getAccountById(id: string): Promise<AccountRow | null> {
  const { data, error } = await fromView()
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as AccountRow | null;
}

export async function findAccountBySalesforceId(sfId: string): Promise<{ id: string } | null> {
  const { data } = await fromView()
    .select('id')
    .eq('salesforce_id', sfId)
    .maybeSingle();
  return (data ?? null) as unknown as { id: string } | null;
}

export async function findAccountByWebsite(domain: string): Promise<{ id: string } | null> {
  const { data } = await fromView()
    .select('id, website')
    .ilike('website', `%${domain}%`)
    .maybeSingle();
  return (data ?? null) as unknown as { id: string } | null;
}

export async function findAccountByName(name: string): Promise<{ id: string } | null> {
  const { data } = await fromView()
    .select('id')
    .ilike('name', name.trim())
    .maybeSingle();
  return (data ?? null) as unknown as { id: string } | null;
}

/**
 * Dave/tool-safe account resolution: finds an active account by fuzzy name
 * match within a user's scope. Returns null if not found or soft-deleted.
 */
export async function resolveAccountByName(
  userId: string,
  accountName: string,
  selectFields = 'id, name'
): Promise<Record<string, any> | null> {
  const { data } = await fromView()
    .select(selectFields)
    .eq('user_id', userId)
    .ilike('name', `%${accountName}%`)
    .limit(1);
  const rows = (data ?? []) as unknown as Record<string, any>[];
  return rows[0] ?? null;
}

// ─── Write helpers (always use accounts table, not view) ──────────

export async function insertAccount(payload: AccountInsert): Promise<AccountRow> {
  const { data, error } = await supabase
    .from('accounts')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAccount(id: string, updates: AccountUpdate): Promise<AccountRow> {
  const { data, error } = await supabase
    .from('accounts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAccount(id: string): Promise<void> {
  console.log('[AccountDelete] Soft-deleting account:', id);
  const { error } = await supabase
    .from('accounts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

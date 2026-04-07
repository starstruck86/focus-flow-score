/**
 * Data access layer for accounts table.
 * ═══════════════════════════════════════════════════════════════════
 * REGRESSION-LOCKED INVARIANT: Soft-delete enforcement
 * ═══════════════════════════════════════════════════════════════════
 * All user-facing account reads MUST exclude soft-deleted rows.
 *
 * USE THESE HELPERS instead of raw `supabase.from('accounts').select(...)`:
 *   - activeAccounts()       → base query builder with deleted_at IS NULL
 *   - getAccounts()          → full list of active accounts
 *   - getAccountById()       → single account by ID (active only)
 *   - findAccountByName()    → lookup by name (active only)
 *   - resolveAccountByName() → Dave/tool pattern: user_id + ilike match
 *
 * If you MUST bypass soft-delete (admin/reconciliation), use rawAccounts()
 * and document why.
 * ═══════════════════════════════════════════════════════════════════
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type AccountRow = Database['public']['Tables']['accounts']['Row'];
type AccountInsert = Database['public']['Tables']['accounts']['Insert'];
type AccountUpdate = Database['public']['Tables']['accounts']['Update'];

export type { AccountRow, AccountInsert, AccountUpdate };

// ─── Core query builders ───────────────────────────────────────────

/**
 * Returns a Supabase query builder for accounts with soft-delete
 * filtering already applied. Use this as the base for ALL user-facing
 * account queries.
 *
 * Usage:
 *   const { data } = await activeAccounts().select('id, name').eq('user_id', uid);
 */
export function activeAccounts() {
  return supabase.from('accounts').select().is('deleted_at', null);
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
  const { data, error } = await activeAccounts().order('name');
  if (error) throw error;
  return data;
}

export async function getAccountById(id: string): Promise<AccountRow | null> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findAccountBySalesforceId(sfId: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('accounts')
    .select('id')
    .eq('salesforce_id', sfId)
    .is('deleted_at', null)
    .maybeSingle();
  return data;
}

export async function findAccountByWebsite(domain: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('accounts')
    .select('id, website')
    .ilike('website', `%${domain}%`)
    .is('deleted_at', null)
    .maybeSingle();
  return data;
}

export async function findAccountByName(name: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('accounts')
    .select('id')
    .ilike('name', name.trim())
    .is('deleted_at', null)
    .maybeSingle();
  return data;
}

/**
 * Dave/tool-safe account resolution: finds an active account by fuzzy name
 * match within a user's scope. Returns null if not found or soft-deleted.
 *
 * This is the canonical pattern for Dave tools that need to resolve
 * an account from a user-provided name string.
 */
export async function resolveAccountByName(
  userId: string,
  accountName: string,
  selectFields = 'id, name'
): Promise<Record<string, any> | null> {
  const { data } = await supabase
    .from('accounts')
    .select(selectFields)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .ilike('name', `%${accountName}%`)
    .limit(1);
  return data?.[0] ?? null;
}

// ─── Write helpers ─────────────────────────────────────────────────

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

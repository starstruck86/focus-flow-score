import { supabase } from '@/integrations/supabase/client';

/**
 * After contacts are added to an account, check if the account
 * should auto-promote from 'inactive' to 'researching'.
 * Triggers when: motion = 'new-logo', status = 'inactive', and 3+ contacts exist.
 */
export async function maybePromoteToResearching(accountId: string) {
  if (!accountId) return;

  // Fetch account status & motion
  const { data: account } = await supabase
    .from('accounts')
    .select('account_status, motion')
    .eq('id', accountId)
    .maybeSingle();

  if (!account) return;
  if (account.account_status !== 'inactive' || account.motion !== 'new-logo') return;

  // Count contacts for this account
  const { count } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);

  if (count != null && count >= 3) {
    await supabase
      .from('accounts')
      .update({ account_status: 'researching' })
      .eq('id', accountId);
  }
}

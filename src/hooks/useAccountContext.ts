/**
 * Fetches and assembles rich account context for Territory Copilot injection.
 * Called from AccountDetail when setting page context.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface AccountContextData {
  footprintSummary: string;
  callSummary: string;
  signalSummary: string;
  contextString: string;
}

export function useAccountContext(accountId: string | undefined, accountName: string | undefined) {
  const [contextData, setContextData] = useState<AccountContextData | null>(null);

  useEffect(() => {
    if (!accountId || !accountName) return;

    let cancelled = false;

    async function fetchContext() {
      const [callsRes, signalsRes, footprintRes] = await Promise.all([
        supabase.from('call_logs').select('call_date, summary, expansion_signal_text, next_step, branch_ki_title')
          .eq('account_id', accountId!)
          .order('call_date', { ascending: false })
          .limit(3),
        supabase.from('account_signals').select('signal_type, raw_text, source_label, created_at')
          .eq('linked_account_id', accountId!)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase.from('branch_footprint').select('*').eq('account_id', accountId!).maybeSingle(),
      ]);

      if (cancelled) return;

      const calls = callsRes.data ?? [];
      const signals = signalsRes.data ?? [];
      const fp = footprintRes.data as any;

      let footprintSummary = '';
      if (fp) {
        const products: [string, string][] = [
          ['deep_linking', 'Deep Linking'], ['universal_ads', 'Universal Ads'],
          ['email_to_app', 'Email-to-App'], ['sms_to_app', 'SMS-to-App'],
          ['web_to_app', 'Web-to-App'], ['qr', 'QR Codes'],
          ['aio', 'AIO'], ['advanced_privacy', 'Advanced Privacy'],
        ];
        const confirmed = products.filter(([k]) => fp[`${k}_status`] === 'confirmed').map(([, l]) => l);
        const inferred = products.filter(([k]) => fp[`${k}_status`] === 'inferred').map(([, l]) => l);
        const parts: string[] = [];
        if (confirmed.length) parts.push(`Confirmed active: ${confirmed.join(', ')}`);
        if (inferred.length) parts.push(`Inferred active: ${inferred.join(', ')}`);
        if (fp.estimated_arr) parts.push(`Est. ARR: $${Number(fp.estimated_arr).toLocaleString()}`);
        if (fp.contract_renewal_date) parts.push(`Contract renewal: ${fp.contract_renewal_date}`);
        if (fp.notes) parts.push(`Notes: ${fp.notes}`);
        footprintSummary = parts.join(' | ');
      }

      let callSummary = '';
      if (calls.length > 0) {
        callSummary = calls.map((c: any) => {
          let s = `${c.call_date}: ${c.summary ?? '(no summary)'}`;
          if (c.expansion_signal_text) s += ` [Signal: ${c.expansion_signal_text}]`;
          if (c.next_step) s += ` [Next: ${c.next_step}]`;
          if (c.branch_ki_title) s += ` [Play used: ${c.branch_ki_title}]`;
          return s;
        }).join(' | ');
      }

      let signalSummary = '';
      if (signals.length > 0) {
        signalSummary = signals.map((s: any) => {
          const text = (s.raw_text ?? '').slice(0, 100);
          return `[${s.signal_type}] ${text}`;
        }).join(' | ');
      }

      const parts: string[] = [`ACCOUNT: ${accountName}`];
      if (footprintSummary) parts.push(`BRANCH FOOTPRINT: ${footprintSummary}`);
      if (callSummary) parts.push(`RECENT CALLS: ${callSummary}`);
      if (signalSummary) parts.push(`RECENT SIGNALS: ${signalSummary}`);

      const contextString = parts.join('\n');

      setContextData({ footprintSummary, callSummary, signalSummary, contextString });
    }

    fetchContext().catch(console.warn);
    return () => { cancelled = true; };
  }, [accountId, accountName]);

  return contextData;
}

// Whitespace Canvas: grid of accounts × Branch products
// Rows: accounts (grouped by family). Columns: 8 Branch products.
// Cell color: confirmed=green, inferred=amber, unknown=grey, blank=slate.
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fromActiveAccounts } from '@/data/accounts';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

const PRODUCTS = [
  { key: 'deep_linking', label: 'Deep\nLinking' },
  { key: 'universal_ads', label: 'Universal\nAds' },
  { key: 'email_to_app', label: 'Email\nto App' },
  { key: 'sms_to_app', label: 'SMS\nto App' },
  { key: 'web_to_app', label: 'Web\nto App' },
  { key: 'qr', label: 'QR' },
  { key: 'aio', label: 'AIO' },
  { key: 'advanced_privacy', label: 'Advanced\nPrivacy' },
];

const STATUS_LABEL: Record<string, string> = {
  confirmed: '✓',
  inferred: '~',
  unknown: '?',
};

type AccountRow = { id: string; name: string; tier: string | null; account_family: string | null };

export function WhitespaceCanvas() {
  const navigate = useNavigate();

  const { data: accounts } = useQuery({
    queryKey: ['canvas-accounts'],
    queryFn: async () => {
      const { data } = await fromActiveAccounts()
        .select('id, name, tier, account_family')
        .order('account_family', { ascending: true, nullsFirst: false })
        .order('name');
      return (data ?? []) as AccountRow[];
    },
    staleTime: 60_000,
  });

  const { data: footprints } = useQuery({
    queryKey: ['canvas-footprints'],
    queryFn: async () => {
      const { data } = await supabase
        .from('branch_footprint')
        .select('account_id, deep_linking_status, universal_ads_status, email_to_app_status, sms_to_app_status, web_to_app_status, qr_status, aio_status, advanced_privacy_status');
      const map: Record<string, any> = {};
      (data ?? []).forEach((fp: any) => { map[fp.account_id] = fp; });
      return map;
    },
    staleTime: 60_000,
  });

  if (!accounts) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading canvas…</div>;
  }

  const summary = PRODUCTS.map(p => {
    const k = `${p.key}_status`;
    const confirmed = Object.values(footprints ?? {}).filter((fp: any) => fp[k] === 'confirmed').length;
    const inferred = Object.values(footprints ?? {}).filter((fp: any) => fp[k] === 'inferred').length;
    return { ...p, confirmed, inferred };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-[11px]">
        <span className="font-semibold text-muted-foreground uppercase tracking-wider">Legend:</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-green-500 inline-block"/> Confirmed</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-amber-400 inline-block"/> Inferred</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-muted inline-block"/> Unknown</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-800 inline-block"/> No Data</span>
        <span className="ml-auto text-muted-foreground">Click account to open detail</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[700px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 w-44">Account</th>
              {PRODUCTS.map(p => (
                <th key={p.key} className="text-center text-[10px] font-semibold text-muted-foreground px-1 py-2 whitespace-pre-line leading-tight min-w-[56px]">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map((account, idx) => {
              const fp = (footprints ?? {})[account.id];
              const isNewFamily = idx === 0 || accounts[idx - 1].account_family !== account.account_family;
              const hasFamily = !!account.account_family;
              return (
                <React.Fragment key={account.id}>
                  {hasFamily && isNewFamily && (
                    <tr className="bg-muted/20">
                      <td colSpan={PRODUCTS.length + 1} className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {account.account_family}
                      </td>
                    </tr>
                  )}
                  <tr
                    className="border-b border-border/40 hover:bg-muted/20 cursor-pointer transition-colors"
                    onClick={() => navigate(`/accounts/${account.id}`)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0',
                          account.tier === 'A' ? 'bg-green-500/15 text-green-600' :
                          account.tier === 'B' ? 'bg-amber-500/15 text-amber-600' :
                          'bg-muted text-muted-foreground'
                        )}>{account.tier ?? '—'}</span>
                        <span className="text-sm font-medium truncate max-w-[110px]">{account.name}</span>
                      </div>
                    </td>
                    {PRODUCTS.map(p => {
                      const status = fp ? (fp[`${p.key}_status`] ?? 'unknown') : null;
                      return (
                        <td key={p.key} className="text-center px-1 py-2">
                          <div className={cn(
                            'mx-auto w-8 h-8 rounded flex items-center justify-center text-xs font-bold transition-all',
                            status === 'confirmed' ? 'bg-green-500 text-white' :
                            status === 'inferred' ? 'bg-amber-400 text-white' :
                            status === 'unknown' ? 'bg-muted text-muted-foreground' :
                            'bg-slate-100 dark:bg-slate-800/40 text-muted-foreground/30'
                          )}>
                            {status ? STATUS_LABEL[status] ?? '' : ''}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/20">
              <td className="px-3 py-2 text-[11px] font-semibold text-muted-foreground">Coverage</td>
              {summary.map(p => (
                <td key={p.key} className="text-center px-1 py-2">
                  <div className="text-[11px] leading-tight">
                    <div className="text-green-600 font-bold">{p.confirmed}</div>
                    <div className="text-amber-500 text-[10px]">{p.inferred > 0 ? `+${p.inferred}` : ''}</div>
                  </div>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {Object.keys(footprints ?? {}).length}/{accounts.length} accounts have footprint data. Open any account → Branch Footprint to update.
      </p>
    </div>
  );
}

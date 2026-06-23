// Whitespace Canvas: grid of accounts × Branch products
// Rows: accounts (grouped by family). Columns: 8 Branch products.
// Tap any cell to inline-edit footprint status via bottom sheet.
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fromActiveAccounts } from '@/data/accounts';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const PRODUCTS = [
  { key: 'deep_linking', label: 'Deep\nLinking', display: 'Deep Linking' },
  { key: 'universal_ads', label: 'Universal\nAds', display: 'Universal Ads' },
  { key: 'email_to_app', label: 'Email\nto App', display: 'Email to App' },
  { key: 'sms_to_app', label: 'SMS\nto App', display: 'SMS to App' },
  { key: 'web_to_app', label: 'Web\nto App', display: 'Web to App' },
  { key: 'qr', label: 'QR', display: 'QR' },
  { key: 'aio', label: 'AIO', display: 'AIO' },
  { key: 'advanced_privacy', label: 'Advanced\nPrivacy', display: 'Advanced Privacy' },
];

const STATUS_LABEL: Record<string, string> = {
  confirmed: '✓',
  inferred: '~',
  unknown: '?',
  not_used: '✕',
};

type AccountRow = { id: string; name: string; tier: string | null; account_family: string | null };

type EditCell = {
  accountId: string;
  accountName: string;
  productKey: string;
  productLabel: string;
  currentStatus: string;
  currentNotes: string;
};

const STATUS_OPTIONS = [
  { value: 'confirmed', label: 'Confirmed', emoji: '✅', desc: 'Confirmed in use', color: 'border-green-500/50 bg-green-500/10' },
  { value: 'inferred', label: 'Inferred', emoji: '🟡', desc: 'We think they use this', color: 'border-amber-500/50 bg-amber-500/10' },
  { value: 'unknown', label: 'Unknown', emoji: '⬜', desc: 'Status unclear', color: 'border-slate-500/30 bg-slate-500/5' },
  { value: 'not_used', label: 'Not Used', emoji: '❌', desc: 'Confirmed not using', color: 'border-red-500/30 bg-red-500/5' },
];

function CellEditSheet({
  cell, status, onStatusChange, notes, onNotesChange, onSave, onClose, saving,
}: {
  cell: EditCell;
  status: string;
  onStatusChange: (s: string) => void;
  notes: string;
  onNotesChange: (n: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="bg-background border-t border-border rounded-t-2xl p-5 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-base font-bold">{cell.accountName}</p>
            <p className="text-sm text-muted-foreground">{cell.productLabel}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground p-1 text-lg leading-none">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onStatusChange(opt.value)}
              className={cn(
                'p-3 rounded-xl border-2 text-left transition-all',
                status === opt.value ? opt.color + ' border-current' : 'border-border hover:bg-muted/40',
              )}
            >
              <p className="text-lg mb-1">{opt.emoji}</p>
              <p className="text-sm font-semibold">{opt.label}</p>
              <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
            </button>
          ))}
        </div>

        <input
          placeholder="Notes / use case (optional)..."
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          className="w-full h-10 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
        />

        <Button onClick={onSave} disabled={saving} className="w-full h-11 text-base">
          {saving ? 'Saving…' : 'Save Footprint'}
        </Button>
      </div>
    </div>
  );
}

export function WhitespaceCanvas() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [editCell, setEditCell] = useState<EditCell | null>(null);
  const [editStatus, setEditStatus] = useState<string>('unknown');
  const [editNotes, setEditNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);

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
    queryKey: ['branch-footprint'],
    queryFn: async () => {
      const { data } = await supabase
        .from('branch_footprint')
        .select('account_id, deep_linking_status, deep_linking_use_case, universal_ads_status, universal_ads_use_case, email_to_app_status, email_to_app_use_case, sms_to_app_status, sms_to_app_use_case, web_to_app_status, web_to_app_use_case, qr_status, qr_use_case, aio_status, aio_use_case, advanced_privacy_status, advanced_privacy_use_case');
      const map: Record<string, any> = {};
      (data ?? []).forEach((fp: any) => { map[fp.account_id] = fp; });
      return map;
    },
    staleTime: 60_000,
  });

  if (!accounts) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading canvas…</div>;
  }

  const summary = PRODUCTS.map((p) => {
    const k = `${p.key}_status`;
    const confirmed = Object.values(footprints ?? {}).filter((fp: any) => fp[k] === 'confirmed').length;
    const inferred = Object.values(footprints ?? {}).filter((fp: any) => fp[k] === 'inferred').length;
    return { ...p, confirmed, inferred };
  });

  const hasAnyFootprint = Object.keys(footprints ?? {}).length > 0;

  // Mapped count: sum of confirmed + inferred across all cells
  let confirmedCount = 0;
  let inferredCount = 0;
  Object.values(footprints ?? {}).forEach((fp: any) => {
    PRODUCTS.forEach((p) => {
      const s = fp[`${p.key}_status`];
      if (s === 'confirmed') confirmedCount++;
      else if (s === 'inferred') inferredCount++;
    });
  });
  const totalCells = accounts.length * PRODUCTS.length;

  const openCell = (account: AccountRow, product: typeof PRODUCTS[number]) => {
    const fp = (footprints ?? {})[account.id];
    const currentStatus = fp ? (fp[`${product.key}_status`] ?? 'unknown') : 'unknown';
    const currentNotes = fp ? (fp[`${product.key}_use_case`] ?? '') : '';
    setEditCell({
      accountId: account.id,
      accountName: account.name,
      productKey: product.key,
      productLabel: product.display,
      currentStatus,
      currentNotes,
    });
    setEditStatus(currentStatus);
    setEditNotes(currentNotes);
  };

  const handleSaveCell = async () => {
    if (!editCell || !user) return;
    setSaving(true);
    try {
      const statusValue =
        editStatus === 'confirmed' || editStatus === 'inferred' ? editStatus : null;
      const payload: Record<string, any> = {
        user_id: user.id,
        account_id: editCell.accountId,
        [`${editCell.productKey}_status`]: statusValue,
        [`${editCell.productKey}_use_case`]: editNotes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from('branch_footprint')
        .upsert(payload, { onConflict: 'account_id,user_id', ignoreDuplicates: false });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['branch-footprint'] });
      toast.success(`${editCell.productLabel} → ${editStatus}`);
      setEditCell(null);
    } catch (err: any) {
      console.error('[WhitespaceCanvas] save error', err);
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };


  return (
    <div className="space-y-4 relative">
      {!hasAnyFootprint && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-10 p-6 text-center gap-3 rounded-xl pointer-events-none">
          <p className="text-2xl">🗺️</p>
          <p className="text-sm font-semibold">Canvas is empty</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Tap any cell to start mapping Branch products.
          </p>
        </div>
      )}


      <div className="flex flex-wrap items-center gap-4 text-[11px]">
        <span className="font-semibold text-muted-foreground uppercase tracking-wider">Legend:</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-green-500 inline-block"/> Confirmed</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-amber-400 inline-block"/> Inferred</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-muted inline-block"/> Unknown</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-red-500/30 inline-block"/> Not Used</span>
        <span className="ml-auto text-muted-foreground">Tap any cell to edit</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[700px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 w-44">Account</th>
              {PRODUCTS.map((p) => (
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
                  <tr className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                    <td
                      className="px-3 py-2 cursor-pointer"
                      onClick={() => navigate(`/accounts/${account.id}`)}
                    >
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
                    {PRODUCTS.map((p) => {
                      const status = fp ? (fp[`${p.key}_status`] ?? 'unknown') : null;
                      return (
                        <td key={p.key} className="text-center px-1 py-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); openCell(account, p); }}
                            className={cn(
                              'mx-auto w-8 h-8 rounded flex items-center justify-center text-xs font-bold transition-all hover:ring-2 hover:ring-primary/40',
                              status === 'confirmed' ? 'bg-green-500 text-white' :
                              status === 'inferred' ? 'bg-amber-400 text-white' :
                              status === 'not_used' ? 'bg-red-500/30 text-red-700 dark:text-red-300' :
                              status === 'unknown' ? 'bg-muted text-muted-foreground' :
                              'bg-slate-100 dark:bg-slate-800/40 text-muted-foreground/30'
                            )}
                            aria-label={`${account.name} – ${p.display} – ${status ?? 'no data'}`}
                          >
                            {status ? STATUS_LABEL[status] ?? '' : ''}
                          </button>
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
              {summary.map((p) => (
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

      <p className="text-xs text-muted-foreground text-center py-2">
        {confirmedCount} confirmed · {inferredCount} inferred · {totalCells - confirmedCount - inferredCount} unknown — tap any cell to update
      </p>


      {editCell && (
        <CellEditSheet
          cell={editCell}
          status={editStatus}
          onStatusChange={setEditStatus}
          notes={editNotes}
          onNotesChange={setEditNotes}
          onSave={handleSaveCell}
          onClose={() => setEditCell(null)}
          saving={saving}
        />
      )}
    </div>
  );
}

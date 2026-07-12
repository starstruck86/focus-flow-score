/**
 * BranchFootprint — structured view of which Branch products are active per account.
 * Click-to-expand product pills + edit mode with auto-save on blur.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Status = 'confirmed' | 'inferred' | 'unknown' | 'not_active';

const PRODUCTS = [
  { key: 'deep_linking', label: 'Deep Linking', short: 'DL' },
  { key: 'universal_ads', label: 'Universal Ads', short: 'UA' },
  { key: 'email_to_app', label: 'Email-to-App', short: 'E2A' },
  { key: 'sms_to_app', label: 'SMS-to-App', short: 'S2A' },
  { key: 'web_to_app', label: 'Web-to-App', short: 'W2A' },
  { key: 'qr', label: 'QR Codes', short: 'QR' },
  { key: 'aio', label: 'AIO', short: 'AIO' },
  { key: 'advanced_privacy', label: 'Advanced Privacy', short: 'AP' },
] as const;

type ProductKey = typeof PRODUCTS[number]['key'];
type ProductStatusField = `${ProductKey}_status`;
type ProductUseCaseField = `${ProductKey}_use_case`;
type BranchFootprintEditableField =
  | ProductStatusField
  | ProductUseCaseField
  | 'estimated_arr'
  | 'contract_renewal_date'
  | 'relationship_owner'
  | 'notes';
type BranchFootprintEditableValue = Exclude<
  TablesUpdate<'branch_footprint'>[BranchFootprintEditableField],
  undefined
>;

function buildFieldUpdate(
  field: BranchFootprintEditableField,
  value: BranchFootprintEditableValue,
): TablesUpdate<'branch_footprint'> {
  const textValue = typeof value === 'string' ? value || null : null;

  switch (field) {
    case 'deep_linking_status': return { deep_linking_status: textValue };
    case 'deep_linking_use_case': return { deep_linking_use_case: textValue };
    case 'universal_ads_status': return { universal_ads_status: textValue };
    case 'universal_ads_use_case': return { universal_ads_use_case: textValue };
    case 'email_to_app_status': return { email_to_app_status: textValue };
    case 'email_to_app_use_case': return { email_to_app_use_case: textValue };
    case 'sms_to_app_status': return { sms_to_app_status: textValue };
    case 'sms_to_app_use_case': return { sms_to_app_use_case: textValue };
    case 'web_to_app_status': return { web_to_app_status: textValue };
    case 'web_to_app_use_case': return { web_to_app_use_case: textValue };
    case 'qr_status': return { qr_status: textValue };
    case 'qr_use_case': return { qr_use_case: textValue };
    case 'aio_status': return { aio_status: textValue };
    case 'aio_use_case': return { aio_use_case: textValue };
    case 'advanced_privacy_status': return { advanced_privacy_status: textValue };
    case 'advanced_privacy_use_case': return { advanced_privacy_use_case: textValue };
    case 'estimated_arr': return { estimated_arr: typeof value === 'number' ? value : null };
    case 'contract_renewal_date': return { contract_renewal_date: textValue };
    case 'relationship_owner': return { relationship_owner: textValue };
    case 'notes': return { notes: textValue };
  }
}

const STATUS_STYLES: Record<Status, { pill: string; dot: string; label: string }> = {
  confirmed:  { pill: 'bg-green-500/15 text-green-600',                dot: 'bg-green-500', label: 'Confirmed' },
  inferred:   { pill: 'bg-amber-500/15 text-amber-600',                dot: 'bg-amber-500', label: 'Inferred' },
  unknown:    { pill: 'bg-muted text-muted-foreground',                dot: 'bg-muted-foreground/40', label: 'Unknown' },
  not_active: { pill: 'bg-muted/50 text-muted-foreground/50',          dot: 'bg-muted-foreground/20', label: 'Not Active' },
};

type FootprintRow = Record<string, any> | null;

interface BranchFootprintProps {
  accountId: string;
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function BranchFootprint({ accountId }: BranchFootprintProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, any>>({});

  const queryKey = ['branch-footprint', accountId];

  const { data: footprint } = useQuery<FootprintRow>({
    queryKey,
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_footprint')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Reset draft when footprint loads or edit mode opens
  useEffect(() => {
    setDraft(footprint ?? {});
  }, [footprint, editing]);

  const fp = useMemo(() => footprint ?? {}, [footprint]);

  async function persistField(
    field: BranchFootprintEditableField,
    value: BranchFootprintEditableValue,
  ) {
    if (!user) return;
    const current = (footprint as any)?.[field];
    if (current === value || (current == null && (value === '' || value == null))) return;

    const payload: TablesInsert<'branch_footprint'> = {
      ...buildFieldUpdate(field, value),
      user_id: user.id,
      account_id: accountId,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('branch_footprint')
      .upsert(payload, { onConflict: 'account_id,user_id' });

    if (error) {
      toast.error('Could not save');
      return;
    }
    qc.invalidateQueries({ queryKey });
  }

  function toggleExpand(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Branch Footprint</h3>
          <p className="text-[11px] text-muted-foreground">
            Which Branch products are live in this account
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing(e => !e)}
          className="h-8 text-xs"
        >
          {editing ? <><Check className="h-3.5 w-3.5" /> Done</> : <><Pencil className="h-3.5 w-3.5" /> Edit</>}
        </Button>
      </div>

      {/* Products */}
      {!editing ? (
        <div className="flex flex-wrap gap-2">
          {PRODUCTS.map(p => {
            const status = ((fp as any)[`${p.key}_status`] as Status) || 'unknown';
            const useCase = (fp as any)[`${p.key}_use_case`] as string | null;
            const styles = STATUS_STYLES[status];
            const isExpanded = expanded.has(p.key);
            const isDim = status === 'unknown' || status === 'not_active';
            return (
              <div key={p.key} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => toggleExpand(p.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-all',
                    styles.pill,
                    isDim && 'opacity-60'
                  )}
                  title={`${p.label} — ${styles.label}`}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', styles.dot)} />
                  <span>{p.short}</span>
                </button>
                {isExpanded && (
                  <div className="mt-1 max-w-[260px] text-[11px] text-muted-foreground px-2">
                    <span className="font-medium text-foreground/80">{p.label}: </span>
                    {useCase || <em>No use case captured</em>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {PRODUCTS.map(p => {
            const statusKey = `${p.key}_status` as const;
            const useCaseKey = `${p.key}_use_case` as const;
            const status = (draft[statusKey] as Status) || 'unknown';
            return (
              <div key={p.key} className="flex flex-col sm:flex-row gap-2 items-start">
                <div className="w-32 shrink-0 text-xs font-medium pt-2">{p.label}</div>
                <Select
                  value={status}
                  onValueChange={(v) => {
                    setDraft(d => ({ ...d, [statusKey]: v }));
                    void persistField(statusKey, v);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unknown">Unknown</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="inferred">Inferred</SelectItem>
                    <SelectItem value="not_active">Not Active</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  className="h-8 text-xs flex-1"
                  placeholder="Use case / notes"
                  value={(draft[useCaseKey] as string) ?? ''}
                  onChange={(e) => setDraft(d => ({ ...d, [useCaseKey]: e.target.value }))}
                  onBlur={(e) => void persistField(useCaseKey, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Overall fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/50">
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Estimated ARR</label>
          {editing ? (
            <Input
              type="number"
              className="h-8 text-xs"
              placeholder="0"
              value={(draft.estimated_arr as number | string) ?? ''}
              onChange={(e) => setDraft(d => ({ ...d, estimated_arr: e.target.value }))}
              onBlur={(e) => void persistField('estimated_arr', e.target.value ? Number(e.target.value) : null)}
            />
          ) : (
            <div className="text-sm font-medium">{fmtCurrency((fp as any).estimated_arr)}</div>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Contract Renewal</label>
          {editing ? (
            <Input
              type="date"
              className="h-8 text-xs"
              value={(draft.contract_renewal_date as string) ?? ''}
              onChange={(e) => setDraft(d => ({ ...d, contract_renewal_date: e.target.value }))}
              onBlur={(e) => void persistField('contract_renewal_date', e.target.value || null)}
            />
          ) : (
            <div className="text-sm font-medium">{(fp as any).contract_renewal_date || '—'}</div>
          )}
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Relationship Owner @ Branch</label>
          {editing ? (
            <Input
              className="h-8 text-xs"
              placeholder="e.g. Jane Smith"
              value={(draft.relationship_owner as string) ?? ''}
              onChange={(e) => setDraft(d => ({ ...d, relationship_owner: e.target.value }))}
              onBlur={(e) => void persistField('relationship_owner', e.target.value)}
            />
          ) : (
            <div className="text-sm">{(fp as any).relationship_owner || '—'}</div>
          )}
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Notes</label>
          {editing ? (
            <Textarea
              className="min-h-[60px] text-xs"
              placeholder="Anything else worth remembering…"
              value={(draft.notes as string) ?? ''}
              onChange={(e) => setDraft(d => ({ ...d, notes: e.target.value }))}
              onBlur={(e) => void persistField('notes', e.target.value)}
            />
          ) : (
            <div className="text-xs text-muted-foreground whitespace-pre-wrap">
              {(fp as any).notes || '—'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BranchFootprint;

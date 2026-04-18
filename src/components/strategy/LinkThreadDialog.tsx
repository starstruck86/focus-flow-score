/**
 * LinkThreadDialog — post-create thread linkage affordance.
 *
 * Lets a user link a freeform thread to an account and/or opportunity later,
 * or change/clear an existing link. Linking is always an explicit action.
 *
 * Honest scope:
 *   - This persists linked_account_id / linked_opportunity_id on strategy_threads.
 *   - It does NOT migrate prior messages, memory, or outputs to the new scope.
 *   - It does NOT promote anything to shared tables. That is the promoter
 *     pipeline (Phase 4), which is not yet built.
 */
import { useEffect, useMemo, useState } from 'react';
import { Building2, Target, Search, AlertTriangle, Unlink2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import type { StrategyThread } from '@/types/strategy';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thread: StrategyThread | null;
  onApply: (updates: Partial<StrategyThread>) => Promise<void> | void;
}

type Tab = 'account' | 'opportunity';

export function LinkThreadDialog({ open, onOpenChange, thread, onApply }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('account');
  const [search, setSearch] = useState('');
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [opportunities, setOpportunities] = useState<{ id: string; name: string }[]>([]);
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [pendingOpportunityId, setPendingOpportunityId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync pending state with current thread when dialog opens
  useEffect(() => {
    if (!open || !thread) return;
    setPendingAccountId(thread.linked_account_id);
    setPendingOpportunityId(thread.linked_opportunity_id);
    setTab(thread.linked_account_id || !thread.linked_opportunity_id ? 'account' : 'opportunity');
    setSearch('');
  }, [open, thread?.id, thread?.linked_account_id, thread?.linked_opportunity_id]);

  // Load options
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    (async () => {
      const [acctRes, oppRes] = await Promise.all([
        supabase.from('accounts').select('id, name').eq('user_id', user.id).is('deleted_at', null).order('name').limit(200),
        supabase.from('opportunities').select('id, name').eq('user_id', user.id).order('name').limit(200),
      ]);
      if (cancelled) return;
      if (acctRes.data) setAccounts(acctRes.data);
      if (oppRes.data) setOpportunities(oppRes.data);
    })();
    return () => { cancelled = true; };
  }, [open, user]);

  const filteredAccounts = useMemo(() =>
    !search ? accounts : accounts.filter(a => a.name.toLowerCase().includes(search.toLowerCase())),
    [accounts, search]
  );
  const filteredOpps = useMemo(() =>
    !search ? opportunities : opportunities.filter(o => o.name.toLowerCase().includes(search.toLowerCase())),
    [opportunities, search]
  );

  const currentAccountName = accounts.find(a => a.id === thread?.linked_account_id)?.name;
  const currentOppName = opportunities.find(o => o.id === thread?.linked_opportunity_id)?.name;

  // Detect a meaningful change requiring confirmation
  const accountChanged = (pendingAccountId ?? null) !== (thread?.linked_account_id ?? null);
  const opportunityChanged = (pendingOpportunityId ?? null) !== (thread?.linked_opportunity_id ?? null);
  const isChange = accountChanged || opportunityChanged;
  const isScopeChange =
    (thread?.linked_account_id && pendingAccountId && pendingAccountId !== thread.linked_account_id) ||
    (thread?.linked_opportunity_id && pendingOpportunityId && pendingOpportunityId !== thread.linked_opportunity_id) ||
    (thread?.linked_account_id && pendingAccountId === null) ||
    (thread?.linked_opportunity_id && pendingOpportunityId === null);

  const handleApply = async () => {
    if (!thread || !isChange) return;
    setSaving(true);
    try {
      const newType: StrategyThread['thread_type'] =
        pendingAccountId ? 'account_linked'
        : pendingOpportunityId ? 'opportunity_linked'
        : 'freeform';
      await onApply({
        linked_account_id: pendingAccountId,
        linked_opportunity_id: pendingOpportunityId,
        thread_type: newType,
      } as Partial<StrategyThread>);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Link this thread</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Confirm the account and/or opportunity this thread is about. Linking enables shared‑context reads;
            shared write‑back still requires explicit confirmation per discovery.
          </DialogDescription>
        </DialogHeader>

        {/* Current linkage state */}
        <div className="rounded-md border border-border/40 bg-muted/20 p-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Current</p>
          <div className="flex items-center gap-2 text-xs">
            <Building2 className="h-3 w-3 text-muted-foreground" />
            <span className={cn('truncate', !currentAccountName && 'text-muted-foreground italic')}>
              {currentAccountName ?? 'No account linked'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Target className="h-3 w-3 text-muted-foreground" />
            <span className={cn('truncate', !currentOppName && 'text-muted-foreground italic')}>
              {currentOppName ?? 'No opportunity linked'}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border/40">
          <button
            onClick={() => { setTab('account'); setSearch(''); }}
            className={cn(
              'px-2 py-1 text-xs font-medium border-b-2 transition-colors',
              tab === 'account' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground/80'
            )}
          >
            <Building2 className="h-3 w-3 inline mr-1" /> Account
          </button>
          <button
            onClick={() => { setTab('opportunity'); setSearch(''); }}
            className={cn(
              'px-2 py-1 text-xs font-medium border-b-2 transition-colors',
              tab === 'opportunity' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground/80'
            )}
          >
            <Target className="h-3 w-3 inline mr-1" /> Opportunity
          </button>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={tab === 'account' ? 'Search accounts…' : 'Search opportunities…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs pl-7"
            />
          </div>

          <div className="max-h-48 overflow-y-auto border border-border/40 rounded-md">
            {tab === 'account' ? (
              filteredAccounts.length === 0 ? (
                <p className="text-[10px] text-muted-foreground p-3 text-center">No accounts found</p>
              ) : (
                filteredAccounts.slice(0, 50).map(a => {
                  const selected = pendingAccountId === a.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => setPendingAccountId(selected ? null : a.id)}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted/40 flex items-center gap-2 transition-colors',
                        selected && 'bg-primary/5 text-primary'
                      )}
                    >
                      <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{a.name}</span>
                      {selected && <Badge variant="secondary" className="text-[8px] px-1 py-0 ml-auto">Selected</Badge>}
                    </button>
                  );
                })
              )
            ) : (
              filteredOpps.length === 0 ? (
                <p className="text-[10px] text-muted-foreground p-3 text-center">No opportunities found</p>
              ) : (
                filteredOpps.slice(0, 50).map(o => {
                  const selected = pendingOpportunityId === o.id;
                  return (
                    <button
                      key={o.id}
                      onClick={() => setPendingOpportunityId(selected ? null : o.id)}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted/40 flex items-center gap-2 transition-colors',
                        selected && 'bg-primary/5 text-primary'
                      )}
                    >
                      <Target className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{o.name}</span>
                      {selected && <Badge variant="secondary" className="text-[8px] px-1 py-0 ml-auto">Selected</Badge>}
                    </button>
                  );
                })
              )
            )}
          </div>

          {/* Clear current selection on this tab */}
          {((tab === 'account' && pendingAccountId) || (tab === 'opportunity' && pendingOpportunityId)) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] text-muted-foreground"
              onClick={() => tab === 'account' ? setPendingAccountId(null) : setPendingOpportunityId(null)}
            >
              <Unlink2 className="h-3 w-3 mr-1" />
              Clear {tab === 'account' ? 'account' : 'opportunity'} link
            </Button>
          )}
        </div>

        {/* Scope-change warning */}
        {isScopeChange && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 flex gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
            <div className="text-[10px] leading-snug text-foreground/80">
              You are changing this thread's scope. Future replies will read context from the new target.
              <span className="block text-muted-foreground mt-1">
                Existing messages, uploads, and outputs stay attached to this thread but are not migrated.
              </span>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!isChange || saving} onClick={handleApply}>
            {saving ? 'Saving…' : isScopeChange ? 'Confirm change' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * SafeRelinkDialog — replaces the unsafe in-place relink behaviour.
 *
 * Mode A safety contract:
 *   - If the thread is currently linked, default action is CLONE — never silent mutation.
 *   - If the thread has meaningful content (messages/uploads/artifacts/proposals), the
 *     in-place mutation path is gated behind an explicit destructive confirmation.
 *   - If the thread's trust_state is 'blocked', mutation in place is disabled entirely.
 *     The rep must clone, unlink, or resolve the conflict first.
 *   - Before any link change, we run the conflict detector against the candidate target
 *     and surface the relink_target_mismatch warning inline.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Target, Search, AlertTriangle, Unlink2, Copy, ShieldAlert, Loader2, CheckCircle2,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { StrategyThread } from '@/types/strategy';
import type { TrustState } from '@/hooks/strategy/useThreadTrustState';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thread: StrategyThread | null;
  trustState: TrustState;
  hasMeaningfulContent: boolean;
  onApplyInPlace: (updates: Partial<StrategyThread>) => Promise<void> | void;
  onClonedSwitchTo: (newThreadId: string) => void;
  onUnlinkToFreeform: () => Promise<void> | void;
}

type Tab = 'account' | 'opportunity';
type Action = 'clone' | 'mutate' | 'unlink' | null;

export function SafeRelinkDialog({
  open, onOpenChange, thread, trustState, hasMeaningfulContent,
  onApplyInPlace, onClonedSwitchTo, onUnlinkToFreeform,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('account');
  const [search, setSearch] = useState('');
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [opportunities, setOpportunities] = useState<{ id: string; name: string; account_id: string | null }[]>([]);
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [pendingOpportunityId, setPendingOpportunityId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [destructiveConfirm, setDestructiveConfirm] = useState(false);
  const [conflictPreview, setConflictPreview] = useState<{ severity: string; reason: string } | null>(null);
  const [checkingConflict, setCheckingConflict] = useState(false);

  useEffect(() => {
    if (!open || !thread) return;
    setPendingAccountId(thread.linked_account_id);
    setPendingOpportunityId(thread.linked_opportunity_id);
    setTab(thread.linked_account_id || !thread.linked_opportunity_id ? 'account' : 'opportunity');
    setSearch('');
    setDestructiveConfirm(false);
    setConflictPreview(null);
  }, [open, thread?.id, thread?.linked_account_id, thread?.linked_opportunity_id]);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    (async () => {
      const [acctRes, oppRes] = await Promise.all([
        supabase.from('accounts').select('id, name').eq('user_id', user.id).is('deleted_at', null).order('name').limit(200),
        supabase.from('opportunities').select('id, name, account_id').eq('user_id', user.id).order('name').limit(200),
      ]);
      if (cancelled) return;
      if (acctRes.data) setAccounts(acctRes.data);
      if (oppRes.data) setOpportunities(oppRes.data as any);
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
  const newAccountName = accounts.find(a => a.id === pendingAccountId)?.name;
  const newOppName = opportunities.find(o => o.id === pendingOpportunityId)?.name;

  const accountChanged = (pendingAccountId ?? null) !== (thread?.linked_account_id ?? null);
  const opportunityChanged = (pendingOpportunityId ?? null) !== (thread?.linked_opportunity_id ?? null);
  const isChange = accountChanged || opportunityChanged;
  const isCrossEntityChange =
    !!(thread?.linked_account_id && pendingAccountId && pendingAccountId !== thread.linked_account_id) ||
    !!(thread?.linked_opportunity_id && pendingOpportunityId && pendingOpportunityId !== thread.linked_opportunity_id);
  const isClearingLink =
    !!(thread?.linked_account_id && !pendingAccountId) ||
    !!(thread?.linked_opportunity_id && !pendingOpportunityId);

  // Server-side dry run: probe for relink_target_mismatch as the user picks
  useEffect(() => {
    if (!thread || !isCrossEntityChange || !pendingAccountId) {
      setConflictPreview(null);
      return;
    }
    let cancelled = false;
    setCheckingConflict(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('strategy-detect-conflicts', {
          body: { thread_id: thread.id, candidate_account_id: pendingAccountId },
        });
        if (cancelled) return;
        if (!error && data) {
          const mismatch = (data.conflicts ?? []).find((c: any) =>
            c.kind === 'relink_target_mismatch' || c.kind === 'content_vs_account'
          );
          setConflictPreview(mismatch ? { severity: mismatch.severity, reason: mismatch.reason } : null);
        }
      } finally {
        if (!cancelled) setCheckingConflict(false);
      }
    })();
    return () => { cancelled = true; };
  }, [thread?.id, pendingAccountId, isCrossEntityChange]);

  const inPlaceDisabled = trustState === 'blocked' || (isCrossEntityChange && hasMeaningfulContent);
  const cloneRecommended = isCrossEntityChange;

  const doClone = async () => {
    if (!thread) return;
    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke('strategy-clone-thread', {
        body: {
          source_thread_id: thread.id,
          target_account_id: pendingAccountId,
          target_opportunity_id: pendingOpportunityId,
        },
      });
      if (error || !data?.thread_id) throw new Error(error?.message ?? 'Clone failed');
      toast({
        title: 'Thread cloned safely',
        description: `Original preserved. Switched to clone${data.new_entity_name ? ` for ${data.new_entity_name}` : ''}.`,
      });
      onClonedSwitchTo(data.thread_id);
      onOpenChange(false);
    } catch (e: unknown) {
      toast({
        title: 'Clone failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setWorking(false);
    }
  };

  const doMutateInPlace = async () => {
    if (!thread || !destructiveConfirm) return;
    setWorking(true);
    try {
      const newType: StrategyThread['thread_type'] =
        pendingAccountId ? 'account_linked'
        : pendingOpportunityId ? 'opportunity_linked'
        : 'freeform';
      await onApplyInPlace({
        linked_account_id: pendingAccountId,
        linked_opportunity_id: pendingOpportunityId,
        thread_type: newType,
      });
      toast({ title: 'Linkage changed in place', description: 'Re-running entity check…' });
      // Re-run the detector so trust_state reflects the new linkage
      await supabase.functions.invoke('strategy-detect-conflicts', { body: { thread_id: thread.id } });
      onOpenChange(false);
    } finally {
      setWorking(false);
    }
  };

  const doUnlink = async () => {
    if (!thread) return;
    setWorking(true);
    try {
      await onUnlinkToFreeform();
      toast({ title: 'Thread unlinked', description: 'This thread is now freeform.' });
      onOpenChange(false);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Change thread linkage
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Cross-entity linkage is a trust-critical action. Cloning preserves the original
            and is the safe default.
          </DialogDescription>
        </DialogHeader>

        {/* Current state */}
        <div className="rounded-md border border-border/40 bg-muted/20 p-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Currently linked to</p>
          <div className="flex items-center gap-2 text-xs">
            <Building2 className="h-3 w-3 text-muted-foreground" />
            <span className={cn('truncate', !currentAccountName && 'text-muted-foreground italic')}>
              {currentAccountName ?? 'No account'}
            </span>
            {trustState === 'blocked' && (
              <Badge variant="destructive" className="text-[9px] px-1 py-0 ml-auto gap-1">
                <ShieldAlert className="h-2.5 w-2.5" /> Blocked
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Target className="h-3 w-3 text-muted-foreground" />
            <span className={cn('truncate', !currentOppName && 'text-muted-foreground italic')}>
              {currentOppName ?? 'No opportunity'}
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

          <div className="max-h-40 overflow-y-auto border border-border/40 rounded-md">
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
        </div>

        {/* Live conflict preview */}
        {checkingConflict && (
          <div className="rounded-md border border-border/40 bg-muted/10 px-2 py-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking entity match against "{newAccountName ?? 'selection'}"…
          </div>
        )}
        {!checkingConflict && conflictPreview && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 flex gap-2">
            <ShieldAlert className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
            <p className="text-[11px] text-destructive leading-snug">{conflictPreview.reason}</p>
          </div>
        )}
        {!checkingConflict && !conflictPreview && isCrossEntityChange && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 flex items-center gap-2 text-[11px] text-primary">
            <CheckCircle2 className="h-3 w-3" />
            No entity mismatch detected against "{newAccountName ?? 'selection'}".
          </div>
        )}

        {/* Action zone */}
        {isChange && (
          <div className="space-y-2 pt-1 border-t border-border/30">
            {isClearingLink && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 text-xs"
                onClick={doUnlink}
                disabled={working}
              >
                <Unlink2 className="h-3.5 w-3.5" />
                Unlink to freeform
              </Button>
            )}
            {cloneRecommended && (
              <Button
                size="sm"
                className="w-full justify-start gap-2 text-xs"
                onClick={doClone}
                disabled={working}
              >
                {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                Clone thread for {newAccountName ?? newOppName ?? 'new entity'} <span className="ml-auto text-[10px] opacity-80">recommended</span>
              </Button>
            )}
            {!cloneRecommended && !isClearingLink && (
              <Button
                size="sm"
                className="w-full justify-start gap-2 text-xs"
                onClick={() => { setDestructiveConfirm(true); doMutateInPlace(); }}
                disabled={working || inPlaceDisabled}
              >
                {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
                Apply linkage
              </Button>
            )}
            {cloneRecommended && (
              <div className="rounded-md border border-border/40 bg-muted/10 p-2 space-y-1.5">
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Mutating in place will reassign this thread's identity across companies.
                  {trustState === 'blocked' && ' Disabled because this thread is in blocking conflict.'}
                  {trustState !== 'blocked' && hasMeaningfulContent && ' This is irreversible — the original thread will no longer exist.'}
                </p>
                <label className={cn('flex items-start gap-2 text-[10px]', inPlaceDisabled && 'opacity-50 pointer-events-none')}>
                  <input
                    type="checkbox"
                    checked={destructiveConfirm}
                    onChange={e => setDestructiveConfirm(e.target.checked)}
                    disabled={inPlaceDisabled}
                    className="mt-0.5"
                  />
                  <span className="text-foreground/70">
                    I understand this rewrites the thread's entity identity.
                  </span>
                </label>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full h-6 text-[10px] gap-1"
                  onClick={doMutateInPlace}
                  disabled={!destructiveConfirm || working || inPlaceDisabled}
                >
                  <AlertTriangle className="h-3 w-3" />
                  Mutate in place anyway
                </Button>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={working}>
            Keep current link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

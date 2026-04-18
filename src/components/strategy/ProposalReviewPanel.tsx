import { useState, useEffect } from 'react';
import { ClipboardCheck, Check, X, Edit2, AlertTriangle, Building2, Target, Loader2, ChevronDown, Rocket, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { StrategyProposal, ProposalScope } from '@/hooks/strategy/useStrategyProposals';
import type { StrategyThread } from '@/types/strategy';

interface Props {
  thread: StrategyThread;
  proposals: StrategyProposal[];
  onConfirm: (id: string, overrides?: { target_account_id?: string | null; target_opportunity_id?: string | null; target_scope?: ProposalScope; payload_json?: Record<string, unknown> }) => Promise<boolean>;
  onReject: (id: string, reason?: string) => Promise<boolean>;
  onEditPayload: (id: string, payload: Record<string, unknown>) => Promise<boolean>;
  onPromote: (id: string, opts?: { mark_reusable?: boolean; resource_type_override?: string }) => Promise<{ success?: boolean; promoted_table?: string; promoted_record_id?: string; already_promoted?: boolean; error?: string }>;
  onScanThread?: () => Promise<{ scanned: number; created: number; errors: number }>;
  isLoading?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  contact: 'Contact',
  account_note: 'Account Note',
  account_intelligence: 'Account Intel',
  opportunity_note: 'Opp Note',
  opportunity_intelligence: 'Opp Intel',
  transcript: 'Transcript',
  resource_promotion: 'Resource',
  artifact_promotion: 'Artifact → Resource',
  stakeholder: 'Stakeholder',
  risk: 'Risk',
  blocker: 'Blocker',
  champion: 'Champion',
};

const TYPE_COLORS: Record<string, string> = {
  contact: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  stakeholder: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  champion: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
  account_note: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/20',
  account_intelligence: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/20',
  opportunity_note: 'bg-purple-500/15 text-purple-300 border-purple-500/20',
  opportunity_intelligence: 'bg-purple-500/15 text-purple-300 border-purple-500/20',
  transcript: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  resource_promotion: 'bg-orange-500/15 text-orange-300 border-orange-500/20',
  artifact_promotion: 'bg-orange-500/15 text-orange-300 border-orange-500/20',
  risk: 'bg-red-500/15 text-red-300 border-red-500/20',
  blocker: 'bg-red-500/15 text-red-300 border-red-500/20',
};

function payloadSummary(p: StrategyProposal): string {
  const j = p.payload_json as any;
  if (!j) return '(no payload)';
  if (j.name && j.title) return `${j.name} — ${j.title}`;
  if (j.name) return String(j.name);
  if (j.email) return String(j.email);
  if (j.title) return String(j.title);
  if (j.content) return String(j.content).slice(0, 140);
  if (j.summary) return String(j.summary).slice(0, 140);
  return JSON.stringify(j).slice(0, 140);
}

interface Account { id: string; name: string }
interface Opp { id: string; name: string; account_id: string | null }

function ProposalCard({ proposal, thread, onConfirm, onReject, onEditPayload, onPromote }: {
  proposal: StrategyProposal;
  thread: StrategyThread;
  onConfirm: Props['onConfirm'];
  onReject: Props['onReject'];
  onEditPayload: Props['onEditPayload'];
  onPromote: Props['onPromote'];
}) {
  const [busy, setBusy] = useState<'confirm' | 'reject' | 'promote' | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draftPayload, setDraftPayload] = useState(() => JSON.stringify(proposal.payload_json, null, 2));
  const [scope, setScope] = useState<ProposalScope>(proposal.target_scope);
  const [accountId, setAccountId] = useState<string | null>(proposal.target_account_id);
  const [opportunityId, setOpportunityId] = useState<string | null>(proposal.target_opportunity_id);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [opps, setOpps] = useState<Opp[]>([]);
  const [needsTarget, setNeedsTarget] = useState(false);
  const [markReusable, setMarkReusable] = useState(false);

  useEffect(() => {
    const requiresAccount = (scope === 'account' || scope === 'both') && !accountId;
    const requiresOpp = (scope === 'opportunity' || scope === 'both') && !opportunityId;
    setNeedsTarget(requiresAccount || requiresOpp);
    if ((requiresAccount || requiresOpp) && accounts.length === 0) {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const [{ data: a }, { data: o }] = await Promise.all([
          supabase.from('accounts').select('id, name').eq('user_id', user.id).is('deleted_at', null).order('name').limit(500),
          supabase.from('opportunities').select('id, name, account_id').eq('user_id', user.id).order('name').limit(500),
        ]);
        if (a) setAccounts(a as Account[]);
        if (o) setOpps((o as Opp[]) ?? []);
      })();
    }
  }, [scope, accountId, opportunityId, accounts.length]);

  const handleConfirm = async () => {
    if (needsTarget) { toast.error('Pick a target account/opportunity first'); return; }
    setBusy('confirm');
    const ok = await onConfirm(proposal.id, {
      target_scope: scope,
      target_account_id: accountId,
      target_opportunity_id: opportunityId,
    });
    setBusy(null);
    if (ok) toast.success('Confirmed — ready to promote');
    else toast.error('Confirm failed');
  };

  const handleReject = async () => {
    setBusy('reject');
    const ok = await onReject(proposal.id);
    setBusy(null);
    if (ok) toast('Rejected');
  };

  const handleSaveEdit = async () => {
    try {
      const parsed = JSON.parse(draftPayload);
      const ok = await onEditPayload(proposal.id, parsed);
      if (ok) { toast.success('Updated'); setEditOpen(false); }
    } catch { toast.error('Invalid JSON'); }
  };

  const handlePromote = async () => {
    setBusy('promote');
    const result = await onPromote(proposal.id, {
      mark_reusable: markReusable && (proposal.proposal_type === 'resource_promotion' || proposal.proposal_type === 'artifact_promotion'),
    });
    setBusy(null);
    if (result?.success || result?.already_promoted) {
      toast.success(`Promoted to ${result.promoted_table}`);
    } else {
      toast.error(result?.error ?? 'Promotion failed');
    }
  };

  const isPending = proposal.status === 'pending';
  const isConfirmed = proposal.status === 'confirmed';
  const isPromoted = proposal.status === 'promoted';
  const isFailed = proposal.status === 'failed';
  const isFreeform = !thread.linked_account_id && !thread.linked_opportunity_id;
  const isResource = proposal.proposal_type === 'resource_promotion' || proposal.proposal_type === 'artifact_promotion';

  return (
    <Card className="bg-muted/10 border-border/30">
      <CardContent className="p-2.5 space-y-2">
        <div className="flex items-start gap-1.5">
          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 font-medium ${TYPE_COLORS[proposal.proposal_type] ?? 'bg-muted/20 text-foreground/70'}`}>
            {TYPE_LABELS[proposal.proposal_type] ?? proposal.proposal_type}
          </Badge>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal">
            {proposal.target_scope}
          </Badge>
          {proposal.detector_confidence !== null && (
            <span className="text-[9px] text-muted-foreground ml-auto">
              {Math.round(proposal.detector_confidence * 100)}%
            </span>
          )}
        </div>

        <p className="text-[11px] text-foreground/90 leading-snug font-medium line-clamp-2">
          {payloadSummary(proposal)}
        </p>

        {proposal.rationale && (
          <p className="text-[10px] text-muted-foreground italic leading-snug">{proposal.rationale}</p>
        )}

        {proposal.scope_rationale && (
          <p className="text-[10px] text-muted-foreground/80 leading-snug">
            <span className="text-foreground/60">Scope:</span> {proposal.scope_rationale}
          </p>
        )}

        {(needsTarget || (isFreeform && isPending)) && (
          <div className="space-y-1.5 pt-1 border-t border-border/30">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />
              <span className="text-[9px] text-amber-300/90">
                {isFreeform ? 'Freeform thread — pick target before confirming' : 'Pick missing target'}
              </span>
            </div>
            <Select value={scope} onValueChange={(v) => setScope(v as ProposalScope)}>
              <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="account">Account scope</SelectItem>
                <SelectItem value="opportunity">Opportunity scope</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
            {(scope === 'account' || scope === 'both') && (
              <Select value={accountId ?? ''} onValueChange={(v) => setAccountId(v || null)}>
                <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Pick account" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {(scope === 'opportunity' || scope === 'both') && (
              <Select value={opportunityId ?? ''} onValueChange={(v) => setOpportunityId(v || null)}>
                <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Pick opportunity" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {opps.filter(o => !accountId || o.account_id === accountId).map(o => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {!needsTarget && (proposal.target_account_id || proposal.target_opportunity_id) && (
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
            {proposal.target_account_id && (
              <span className="inline-flex items-center gap-0.5"><Building2 className="h-2.5 w-2.5" /> account</span>
            )}
            {proposal.target_opportunity_id && (
              <span className="inline-flex items-center gap-0.5"><Target className="h-2.5 w-2.5" /> opportunity</span>
            )}
          </div>
        )}

        {isPromoted ? (
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 pt-1 border-t border-border/30">
            <ExternalLink className="h-3 w-3" />
            Promoted to shared {proposal.target_table || 'table'}
            {proposal.promoted_record_id && (
              <span className="font-mono text-[9px] text-muted-foreground/70 truncate">
                #{proposal.promoted_record_id.slice(0, 8)}
              </span>
            )}
          </div>
        ) : isFailed ? (
          <div className="space-y-1 pt-1 border-t border-border/30">
            <div className="flex items-center gap-1 text-[10px] text-red-400">
              <AlertTriangle className="h-3 w-3" /> Promotion failed
            </div>
            {proposal.promotion_error && (
              <p className="text-[9px] text-red-300/70 leading-snug pl-4">{proposal.promotion_error}</p>
            )}
            <Button size="sm" variant="ghost" onClick={handlePromote} disabled={busy !== null} className="h-6 px-2 text-[10px] text-amber-400 hover:bg-amber-500/10">
              {busy === 'promote' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />} Retry
            </Button>
          </div>
        ) : isConfirmed ? (
          <div className="space-y-1.5 pt-1 border-t border-border/30">
            {isResource && (
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={markReusable} onChange={(e) => setMarkReusable(e.target.checked)} className="h-3 w-3" />
                Promote as reusable template
              </label>
            )}
            <div className="flex items-center gap-1">
              <Button size="sm" onClick={handlePromote} disabled={busy !== null} className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white">
                {busy === 'promote' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Rocket className="h-3 w-3 mr-1" />}
                Promote to shared
              </Button>
              <Button size="sm" variant="ghost" onClick={handleReject} disabled={busy !== null} className="h-6 px-2 text-[10px] text-red-400 hover:bg-red-500/10 ml-auto">
                {busy === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                Discard
              </Button>
            </div>
          </div>
        ) : isPending ? (
          <div className="flex items-center gap-1 pt-1 border-t border-border/30">
            <Button size="sm" variant="ghost" onClick={handleConfirm} disabled={busy !== null} className="h-6 px-2 text-[10px] text-emerald-400 hover:bg-emerald-500/10">
              {busy === 'confirm' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Confirm
            </Button>
            <Popover open={editOpen} onOpenChange={setEditOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]">
                  <Edit2 className="h-3 w-3" /> Edit
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-2 space-y-2">
                <p className="text-[10px] text-muted-foreground">Payload JSON</p>
                <Textarea value={draftPayload} onChange={(e) => setDraftPayload(e.target.value)} className="font-mono text-[10px] h-40" />
                <Button size="sm" onClick={handleSaveEdit} className="w-full h-7 text-xs">Save</Button>
              </PopoverContent>
            </Popover>
            <Button size="sm" variant="ghost" onClick={handleReject} disabled={busy !== null} className="h-6 px-2 text-[10px] text-red-400 hover:bg-red-500/10 ml-auto">
              {busy === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              Reject
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ProposalReviewPanel({ thread, proposals, onConfirm, onReject, onEditPayload, onPromote, isLoading }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const pending = proposals.filter(p => p.status === 'pending');
  const confirmed = proposals.filter(p => p.status === 'confirmed');
  const promoted = proposals.filter(p => p.status === 'promoted');
  const failed = proposals.filter(p => p.status === 'failed');

  if (proposals.length === 0 && !isLoading) return null;

  return (
    <div className="px-3 py-2.5 border-b border-border/30">
      <button onClick={() => setCollapsed(c => !c)} className="w-full flex items-center gap-1.5 mb-2 text-left">
        <ClipboardCheck className="h-3.5 w-3.5 text-amber-400/80" />
        <h3 className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider flex-1">
          Promotion Proposals
        </h3>
        {pending.length > 0 && (
          <Badge variant="secondary" className="text-[8px] px-1 py-0 h-4 font-normal bg-amber-500/15 text-amber-300 border-amber-500/20">
            {pending.length} pending
          </Badge>
        )}
        {confirmed.length > 0 && (
          <Badge variant="secondary" className="text-[8px] px-1 py-0 h-4 font-normal bg-emerald-500/15 text-emerald-300 border-emerald-500/20">
            {confirmed.length} ready
          </Badge>
        )}
        {promoted.length > 0 && (
          <Badge variant="secondary" className="text-[8px] px-1 py-0 h-4 font-normal bg-blue-500/15 text-blue-300 border-blue-500/20">
            {promoted.length} promoted
          </Badge>
        )}
        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>

      {!collapsed && (
        <div className="space-y-2">
          {isLoading && <p className="text-[10px] text-muted-foreground italic pl-5">Loading…</p>}
          {[...pending, ...confirmed, ...failed, ...promoted].map(p => (
            <ProposalCard key={p.id} proposal={p} thread={thread} onConfirm={onConfirm} onReject={onReject} onEditPayload={onEditPayload} onPromote={onPromote} />
          ))}
        </div>
      )}
    </div>
  );
}

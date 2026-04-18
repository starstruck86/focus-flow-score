import { useState, useEffect } from 'react';
import {
  ClipboardCheck, Check, X, Edit2, AlertTriangle, Building2, Target,
  Loader2, ChevronDown, Rocket, ExternalLink, Archive, BookmarkPlus, UserPlus,
} from 'lucide-react';
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
import type { StrategyProposal, ProposalScope, PromotionClass } from '@/hooks/strategy/useStrategyProposals';
import type { StrategyThread } from '@/types/strategy';

interface Props {
  thread: StrategyThread;
  proposals: StrategyProposal[];
  onConfirm: (id: string, promotionClass: PromotionClass, overrides?: { target_account_id?: string | null; target_opportunity_id?: string | null; target_scope?: ProposalScope; payload_json?: Record<string, unknown> }) => Promise<boolean>;
  onReject: (id: string, reason?: string) => Promise<boolean>;
  onEditPayload: (id: string, payload: Record<string, unknown>) => Promise<boolean>;
  onPromote: (id: string, opts?: { mark_reusable?: boolean; resource_type_override?: string }) => Promise<{ success?: boolean; promoted_table?: string; promoted_record_id?: string; already_promoted?: boolean; error?: string }>;
  onScanThread?: () => Promise<{ scanned: number; created: number; errors: number }>;
  isLoading?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  contact: 'Person',
  account_note: 'Account Note',
  account_intelligence: 'Account Intel',
  opportunity_note: 'Opp Note',
  opportunity_intelligence: 'Opp Intel',
  transcript: 'Transcript',
  resource_promotion: 'Resource',
  artifact_promotion: 'Artifact → Resource',
  stakeholder: 'Person (Stakeholder)',
  risk: 'Risk',
  blocker: 'Blocker',
  champion: 'Person (Champion)',
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

const PERSON_TYPES = new Set(['contact', 'stakeholder', 'champion']);
const RESOURCE_TYPES = new Set(['resource_promotion', 'artifact_promotion']);

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
  const [busy, setBusy] = useState<'research' | 'shared' | 'crm' | 'reject' | 'promote' | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draftPayload, setDraftPayload] = useState(() => JSON.stringify(proposal.payload_json, null, 2));
  const [scope, setScope] = useState<ProposalScope>(proposal.target_scope);
  const [accountId, setAccountId] = useState<string | null>(proposal.target_account_id);
  const [opportunityId, setOpportunityId] = useState<string | null>(proposal.target_opportunity_id);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [opps, setOpps] = useState<Opp[]>([]);
  const [markReusable, setMarkReusable] = useState(false);

  const isPerson = PERSON_TYPES.has(proposal.proposal_type);
  const isResource = RESOURCE_TYPES.has(proposal.proposal_type);
  const isPending = proposal.status === 'pending';
  const isConfirmedAny = proposal.status.startsWith('confirmed');
  const isResearchOnly = proposal.status === 'confirmed_research_only' || proposal.confirmed_class === 'research_only';
  const isPromoted = proposal.status === 'promoted';
  const isFailed = proposal.status === 'failed';
  const isFreeform = !thread.linked_account_id && !thread.linked_opportunity_id;

  // Load accounts/opps when needed
  useEffect(() => {
    if (!isPending) return;
    if (accounts.length > 0) return;
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
  }, [isPending, accounts.length]);

  const requiresAccount = (scope === 'account' || scope === 'both');
  const requiresOpp = (scope === 'opportunity' || scope === 'both');
  const canCrm = isPerson && !!accountId;
  const canShared = (requiresAccount ? !!accountId : true) && (requiresOpp ? !!opportunityId : true);

  const handleConfirm = async (promotionClass: PromotionClass) => {
    if (promotionClass === 'crm_contact' && !accountId) {
      toast.error('Pick the account this person actually belongs to first');
      return;
    }
    if (promotionClass === 'shared_intelligence' && !canShared) {
      toast.error('Pick the target account/opportunity first');
      return;
    }
    setBusy(promotionClass === 'research_only' ? 'research'
          : promotionClass === 'shared_intelligence' ? 'shared' : 'crm');
    const ok = await onConfirm(proposal.id, promotionClass, {
      target_scope: scope,
      target_account_id: accountId,
      target_opportunity_id: opportunityId,
    });
    setBusy(null);
    if (!ok) { toast.error('Confirm failed'); return; }
    if (promotionClass === 'research_only') {
      toast.success('Saved as research-only — stays in Strategy');
    } else {
      // Auto-promote shared_intelligence and crm_contact since the rep already
      // made the relationship/scope decision explicitly.
      setBusy('promote');
      const result = await onPromote(proposal.id, {
        mark_reusable: markReusable && isResource,
      });
      setBusy(null);
      if (result?.success || result?.already_promoted) {
        toast.success(`Promoted to shared ${result.promoted_table}`);
      } else {
        toast.error(result?.error ?? 'Promotion failed');
      }
    }
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

  const handleRetryPromote = async () => {
    setBusy('promote');
    const result = await onPromote(proposal.id, { mark_reusable: markReusable && isResource });
    setBusy(null);
    if (result?.success || result?.already_promoted) {
      toast.success(`Promoted to shared ${result.promoted_table}`);
    } else {
      toast.error(result?.error ?? 'Promotion failed');
    }
  };

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

        {/* TARGETING — only shown while pending */}
        {isPending && (
          <div className="space-y-1.5 pt-1 border-t border-border/30">
            {isFreeform && (
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />
                <span className="text-[9px] text-amber-300/90">
                  Freeform thread — pick target before sharing
                </span>
              </div>
            )}
            {!isPerson && (
              <Select value={scope} onValueChange={(v) => setScope(v as ProposalScope)}>
                <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="account">Account scope</SelectItem>
                  <SelectItem value="opportunity">Opportunity scope</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            )}
            {(requiresAccount || isPerson) && (
              <Select value={accountId ?? ''} onValueChange={(v) => setAccountId(v || null)}>
                <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Pick account (required for shared/CRM)" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {requiresOpp && !isPerson && (
              <Select value={opportunityId ?? ''} onValueChange={(v) => setOpportunityId(v || null)}>
                <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Pick opportunity" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {opps.filter(o => !accountId || o.account_id === accountId).map(o => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isResource && (
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={markReusable} onChange={(e) => setMarkReusable(e.target.checked)} className="h-3 w-3" />
                Promote as reusable template
              </label>
            )}
          </div>
        )}

        {/* CONFIRMED-CLASS BADGE for non-pending */}
        {!isPending && (proposal.target_account_id || proposal.target_opportunity_id) && (
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
            {proposal.target_account_id && (
              <span className="inline-flex items-center gap-0.5"><Building2 className="h-2.5 w-2.5" /> account</span>
            )}
            {proposal.target_opportunity_id && (
              <span className="inline-flex items-center gap-0.5"><Target className="h-2.5 w-2.5" /> opportunity</span>
            )}
            {proposal.confirmed_class && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 font-normal ml-auto">
                {proposal.confirmed_class.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
        )}

        {/* OUTCOME STATES */}
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
        ) : isResearchOnly ? (
          <div className="flex items-center justify-between gap-1.5 text-[10px] text-amber-300/90 pt-1 border-t border-border/30">
            <span className="inline-flex items-center gap-1">
              <Archive className="h-3 w-3" /> Research only — not in shared CRM
            </span>
            <Button size="sm" variant="ghost" onClick={handleReject} disabled={busy !== null} className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-red-400">
              <X className="h-3 w-3" /> Discard
            </Button>
          </div>
        ) : isFailed ? (
          <div className="space-y-1 pt-1 border-t border-border/30">
            <div className="flex items-center gap-1 text-[10px] text-red-400">
              <AlertTriangle className="h-3 w-3" /> Promotion failed
            </div>
            {proposal.promotion_error && (
              <p className="text-[9px] text-red-300/70 leading-snug pl-4">{proposal.promotion_error}</p>
            )}
            <Button size="sm" variant="ghost" onClick={handleRetryPromote} disabled={busy !== null} className="h-6 px-2 text-[10px] text-amber-400 hover:bg-amber-500/10">
              {busy === 'promote' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />} Retry
            </Button>
          </div>
        ) : isConfirmedAny ? (
          // Legacy 'confirmed' status (no class) — show retry promote
          <div className="space-y-1 pt-1 border-t border-border/30">
            <p className="text-[10px] text-muted-foreground italic">Awaiting promotion…</p>
            <Button size="sm" onClick={handleRetryPromote} disabled={busy !== null} className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white">
              {busy === 'promote' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Rocket className="h-3 w-3 mr-1" />}
              Promote now
            </Button>
          </div>
        ) : isPending ? (
          // PRIMARY DECISION GATE — three explicit class buttons
          <div className="space-y-1.5 pt-1 border-t border-border/30">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">What is this?</p>
            <div className="grid grid-cols-1 gap-1">
              {/* Research-only — always available */}
              <Button
                size="sm" variant="outline"
                onClick={() => handleConfirm('research_only')}
                disabled={busy !== null}
                className="h-7 px-2 text-[10px] justify-start gap-1.5 border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
              >
                {busy === 'research' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
                <span className="font-medium">Research only</span>
                <span className="text-muted-foreground text-[9px] ml-auto">stays in Strategy</span>
              </Button>

              {/* Shared intelligence — for any type */}
              <Button
                size="sm" variant="outline"
                onClick={() => handleConfirm('shared_intelligence')}
                disabled={busy !== null || !canShared}
                className="h-7 px-2 text-[10px] justify-start gap-1.5 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-40"
              >
                {busy === 'shared' ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookmarkPlus className="h-3 w-3" />}
                <span className="font-medium">
                  {isPerson ? 'Save as account intel' : isResource ? 'Promote to shared resource' : 'Save as shared intel'}
                </span>
                <span className="text-muted-foreground text-[9px] ml-auto">
                  {isPerson ? 'no CRM contact' : 'shared'}
                </span>
              </Button>

              {/* CRM contact — person types only, account required */}
              {isPerson && (
                <Button
                  size="sm" variant="outline"
                  onClick={() => handleConfirm('crm_contact')}
                  disabled={busy !== null || !canCrm}
                  className="h-7 px-2 text-[10px] justify-start gap-1.5 border-blue-500/30 text-blue-300 hover:bg-blue-500/10 disabled:opacity-40"
                >
                  {busy === 'crm' ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                  <span className="font-medium">Create CRM contact</span>
                  <span className="text-muted-foreground text-[9px] ml-auto">
                    {canCrm ? 'on selected account' : 'pick account first'}
                  </span>
                </Button>
              )}
            </div>

            <div className="flex items-center gap-1 pt-1">
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
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ProposalReviewPanel({ thread, proposals, onConfirm, onReject, onEditPayload, onPromote, onScanThread, isLoading }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const pending = proposals.filter(p => p.status === 'pending');
  const confirmed = proposals.filter(p => p.status.startsWith('confirmed'));
  const promoted = proposals.filter(p => p.status === 'promoted');
  const failed = proposals.filter(p => p.status === 'failed');

  const handleScan = async () => {
    if (!onScanThread) return;
    setScanning(true);
    try {
      const r = await onScanThread();
      if (r.created > 0) toast.success(`Found ${r.created} new proposal${r.created === 1 ? '' : 's'} (scanned ${r.scanned})`);
      else if (r.scanned === 0) toast('Nothing in this thread to scan yet');
      else toast(`Scanned ${r.scanned} item${r.scanned === 1 ? '' : 's'} — no new promotable discoveries`);
    } catch (e: any) {
      toast.error(`Scan failed: ${e?.message ?? e}`);
    } finally {
      setScanning(false);
    }
  };

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
          {onScanThread && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleScan}
              disabled={scanning}
              className="w-full h-7 text-[10px] gap-1.5 border-dashed border-border/50"
            >
              {scanning
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <ClipboardCheck className="h-3 w-3" />}
              {scanning ? 'Scanning thread…' : proposals.length === 0 ? 'Scan thread for promotable discoveries' : 'Re-scan thread'}
            </Button>
          )}
          {isLoading && <p className="text-[10px] text-muted-foreground italic pl-5">Loading…</p>}
          {proposals.length === 0 && !isLoading && !scanning && (
            <p className="text-[10px] text-muted-foreground italic px-1">
              No proposals yet. Run a scan to extract people, risks, intel, or artifacts from this thread.
            </p>
          )}
          {[...pending, ...confirmed, ...failed, ...promoted].map(p => (
            <ProposalCard key={p.id} proposal={p} thread={thread} onConfirm={onConfirm} onReject={onReject} onEditPayload={onEditPayload} onPromote={onPromote} />
          ))}
        </div>
      )}
    </div>
  );
}

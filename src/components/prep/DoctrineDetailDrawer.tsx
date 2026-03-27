/**
 * Doctrine Detail Drawer — full operator control center for a single doctrine entry.
 *
 * Shows governance, lineage, downstream usage, version history, and operator actions.
 */

import { memo, useState, useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from '@/components/ui/drawer';
import {
  Check, X, Archive, ArrowUp, ArrowDown, Eye, EyeOff, GitMerge,
  MessageSquare, ExternalLink, AlertTriangle, Copy, Clock, Zap,
  ChevronDown, ChevronRight, Shield,
} from 'lucide-react';
import {
  type DoctrineEntry,
  type PropagationTargets,
  approveDoctrine,
  rejectDoctrine,
  archiveDoctrine,
  mergeDoctrine,
  supersedeDoctrine,
  adjustDoctrineConfidence,
  togglePropagation,
  togglePropagationTarget,
  addReviewNote,
  getChapterLabel,
  getFreshnessColor,
  getGovernanceColor,
  getGovernanceLabel,
  getPropagationBlockReason,
  getActiveDoctrine,
  loadChangelog,
  PROPAGATION_CONFIDENCE_FLOORS,
} from '@/lib/salesBrain';
import { getDoctrineTrace } from '@/lib/salesBrain/traceability';
import { getDoctrineUsageSummary } from '@/lib/salesBrain/doctrineUsage';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface DoctrineDetailDrawerProps {
  doctrineId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh?: () => void;
}

export const DoctrineDetailDrawer = memo(function DoctrineDetailDrawer({
  doctrineId, open, onOpenChange, onRefresh,
}: DoctrineDetailDrawerProps) {
  const trace = useMemo(() => doctrineId ? getDoctrineTrace(doctrineId) : null, [doctrineId, open]);
  const usage = useMemo(() => doctrineId ? getDoctrineUsageSummary(doctrineId) : null, [doctrineId, open]);

  if (!trace || !trace.doctrine) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>Doctrine not found</DrawerTitle>
          </DrawerHeader>
        </DrawerContent>
      </Drawer>
    );
  }

  const entry = trace.doctrine;
  const g = entry.governance;

  const isInactive = ['rejected', 'archived', 'superseded'].includes(g.status);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <ScrollArea className="max-h-[80vh]">
          <div className={cn('px-4 pb-6 space-y-4', isInactive && 'opacity-70')}>
            {/* HEADER */}
            <DrawerHeader className="px-0 pb-0">
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <Badge variant="outline" className="text-[9px]">{getChapterLabel(entry.chapter)}</Badge>
                <Badge className={cn('text-[8px]', getGovernanceColor(g.status))}>
                  {getGovernanceLabel(g.status)}
                </Badge>
                <Badge className={cn('text-[8px]', getFreshnessColor(entry.freshnessState))}>
                  {entry.freshnessState}
                </Badge>
                {g.propagationEnabled && g.status === 'approved' && (
                  <Badge variant="outline" className="text-[8px] text-primary border-primary/30">propagating</Badge>
                )}
                {g.isLegacyHydrated && (
                  <Badge variant="outline" className="text-[8px] border-status-yellow text-status-yellow">legacy</Badge>
                )}
                {g.duplicateFlag !== 'none' && (
                  <Badge variant="outline" className="text-[8px] border-status-yellow text-status-yellow">
                    <Copy className="h-2.5 w-2.5 mr-0.5" />dup
                  </Badge>
                )}
                {g.conflictFlag !== 'none' && (
                  <Badge variant="outline" className="text-[8px] border-destructive text-destructive">
                    <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />conflict
                  </Badge>
                )}
              </div>
              <DrawerTitle className="text-sm leading-snug">{entry.statement}</DrawerTitle>
              <DrawerDescription className="text-[10px]">
                Confidence: {(entry.confidence * 100).toFixed(0)}% · v{entry.version}
              </DrawerDescription>
            </DrawerHeader>

            {/* ACTIONS */}
            <ActionBar entry={entry} onRefresh={() => { onRefresh?.(); onOpenChange(false); }} />

            <Separator />

            {/* GOVERNANCE */}
            <CollapsibleSection title="Governance" icon={<Shield className="h-3 w-3" />} defaultOpen>
              <GovernancePanel entry={entry} />
            </CollapsibleSection>

            {/* PROPAGATION ELIGIBILITY */}
            <CollapsibleSection title="Propagation by Target" icon={<Zap className="h-3 w-3" />} defaultOpen>
              <PropagationTargetPanel entry={entry} onRefresh={onRefresh} />
            </CollapsibleSection>

            {/* SOURCE LINEAGE */}
            <CollapsibleSection title={`Source Lineage (${trace.linkedResourceIds.length}R / ${trace.linkedInsights.length}I)`} icon={<ExternalLink className="h-3 w-3" />}>
              <div className="space-y-1">
                {trace.linkedResourceIds.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Resources</p>
                    {trace.linkedResourceIds.map(rid => (
                      <p key={rid} className="text-[10px] text-foreground font-mono truncate">{rid}</p>
                    ))}
                  </div>
                )}
                {trace.linkedInsights.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5 mt-1">Insights</p>
                    {trace.linkedInsights.map(ins => (
                      <p key={ins.id} className="text-[10px] text-foreground truncate">
                        <span className="text-muted-foreground">[{ins.category}]</span> {ins.topic}
                      </p>
                    ))}
                  </div>
                )}
                {trace.linkedResourceIds.length === 0 && trace.linkedInsights.length === 0 && (
                  <p className="text-[10px] text-muted-foreground">No linked sources</p>
                )}
              </div>
            </CollapsibleSection>

            {/* DOWNSTREAM USAGE */}
            <CollapsibleSection title={`Downstream Usage (${usage?.totalUsages ?? 0} events)`} icon={<Zap className="h-3 w-3" />}>
              {usage && usage.totalUsages > 0 ? (
                <div className="space-y-1">
                  {(['dave', 'roleplay', 'prep', 'playbooks'] as const).map(t => {
                    const count = usage.byTarget[t];
                    const blockReason = getPropagationBlockReason(entry, t);
                    return (
                      <div key={t} className="flex items-center justify-between text-[10px]">
                        <span className="font-mono text-foreground capitalize">{t}</span>
                        <span className="text-muted-foreground">
                          {count > 0 ? `${count} uses` : 'unused'}
                          {blockReason ? ` · blocked: ${blockReason}` : ' · eligible'}
                        </span>
                      </div>
                    );
                  })}
                  {usage.lastUsedAt && (
                    <p className="text-[9px] text-muted-foreground mt-1">
                      Last used: {new Date(usage.lastUsedAt).toLocaleString()} ({usage.lastUsedTarget})
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {(['dave', 'roleplay', 'prep', 'playbooks'] as const).map(t => {
                    const blockReason = getPropagationBlockReason(entry, t);
                    return (
                      <div key={t} className="flex items-center justify-between text-[10px]">
                        <span className="font-mono text-foreground capitalize">{t}</span>
                        <span className="text-muted-foreground">
                          {blockReason ? `blocked: ${blockReason}` : 'eligible, unused'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CollapsibleSection>

            {/* CONTENT */}
            {(entry.tacticalImplication || entry.talkTracks.length > 0 || entry.antiPatterns.length > 0 || entry.examples.length > 0) && (
              <CollapsibleSection title="Content" icon={<MessageSquare className="h-3 w-3" />}>
                {entry.tacticalImplication && (
                  <div className="mb-1">
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Tactical Implication</p>
                    <p className="text-xs text-foreground">{entry.tacticalImplication}</p>
                  </div>
                )}
                {entry.talkTracks.length > 0 && (
                  <div className="mb-1">
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Talk Tracks</p>
                    {entry.talkTracks.map((t, i) => <p key={i} className="text-xs text-foreground">• {t}</p>)}
                  </div>
                )}
                {entry.antiPatterns.length > 0 && (
                  <div className="mb-1">
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Anti-Patterns</p>
                    {entry.antiPatterns.map((a, i) => <p key={i} className="text-xs text-destructive">⚠ {a}</p>)}
                  </div>
                )}
                {entry.examples.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Examples</p>
                    {entry.examples.map((e, i) => <p key={i} className="text-xs text-foreground">• {e}</p>)}
                  </div>
                )}
              </CollapsibleSection>
            )}

            {/* VERSION / HISTORY */}
            <CollapsibleSection title="History" icon={<Clock className="h-3 w-3" />}>
              <div className="space-y-1 text-[10px]">
                <Row label="Created" value={new Date(entry.createdAt).toLocaleString()} />
                <Row label="Updated" value={new Date(entry.updatedAt).toLocaleString()} />
                {g.lastReinforcedAt && <Row label="Last reinforced" value={new Date(g.lastReinforcedAt).toLocaleString()} />}
                {g.lastConflictedAt && <Row label="Last conflict" value={new Date(g.lastConflictedAt).toLocaleString()} />}
                {entry.supersedesId && <Row label="Supersedes" value={entry.supersedesId} />}
                {g.supersededById && <Row label="Superseded by" value={g.supersededById} />}
                {g.mergedIntoId && <Row label="Merged into" value={g.mergedIntoId} />}
              </div>
              {trace.changelogSnippets.length > 0 && (
                <div className="mt-2">
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Recent Changes</p>
                  {trace.changelogSnippets.slice(0, 5).map(e => (
                    <p key={e.id} className="text-[10px] text-muted-foreground truncate">
                      {new Date(e.timestamp).toLocaleDateString()} — {e.description}
                    </p>
                  ))}
                </div>
              )}
            </CollapsibleSection>
          </div>
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
});

// ── Action Bar ─────────────────────────────────────────────
function ActionBar({ entry, onRefresh }: { entry: DoctrineEntry; onRefresh: () => void }) {
  const [showReject, setShowReject] = useState(false);
  const [rejectInput, setRejectInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [showMerge, setShowMerge] = useState(false);
  const [showSupersede, setShowSupersede] = useState(false);

  const handleApprove = useCallback(() => {
    approveDoctrine(entry.id);
    toast.success('Approved');
    onRefresh();
  }, [entry.id, onRefresh]);

  const handleReject = useCallback(() => {
    if (!rejectInput.trim()) { toast.error('Reason required'); return; }
    rejectDoctrine(entry.id, rejectInput.trim());
    toast.success('Rejected');
    onRefresh();
  }, [entry.id, rejectInput, onRefresh]);

  const handleArchive = useCallback(() => {
    archiveDoctrine(entry.id);
    toast.success('Archived');
    onRefresh();
  }, [entry.id, onRefresh]);

  const handleAddNote = useCallback(() => {
    if (!noteInput.trim()) return;
    addReviewNote(entry.id, noteInput.trim());
    setNoteInput('');
    toast.success('Note added');
  }, [entry.id, noteInput]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap">
        <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={handleApprove}>
          <Check className="h-3 w-3" /> Approve
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setShowReject(v => !v)}>
          <X className="h-3 w-3" /> Reject
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
          onClick={() => { adjustDoctrineConfidence(entry.id, 0.1); onRefresh(); }}>
          <ArrowUp className="h-3 w-3" /> Conf
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
          onClick={() => { adjustDoctrineConfidence(entry.id, -0.1); onRefresh(); }}>
          <ArrowDown className="h-3 w-3" /> Conf
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
          onClick={() => { togglePropagation(entry.id, !entry.governance.propagationEnabled); onRefresh(); }}>
          {entry.governance.propagationEnabled ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {entry.governance.propagationEnabled ? 'Disable' : 'Enable'}
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" onClick={handleArchive}>
          <Archive className="h-3 w-3" /> Archive
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" onClick={() => setShowMerge(v => !v)}>
          <GitMerge className="h-3 w-3" /> Merge
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" onClick={() => setShowSupersede(v => !v)}>
          <ArrowUp className="h-3 w-3" /> Supersede
        </Button>
      </div>

      {showReject && (
        <div className="flex gap-1.5">
          <Input value={rejectInput} onChange={e => setRejectInput(e.target.value)}
            placeholder="Rejection reason (required)" className="h-7 text-xs flex-1"
            onKeyDown={e => e.key === 'Enter' && handleReject()} />
          <Button size="sm" className="h-7 text-xs" onClick={handleReject}>Reject</Button>
        </div>
      )}

      {showMerge && <MergePicker sourceId={entry.id} chapter={entry.chapter} mode="merge" onDone={onRefresh} />}
      {showSupersede && <MergePicker sourceId={entry.id} chapter={entry.chapter} mode="supersede" onDone={onRefresh} />}

      <div className="flex gap-1.5">
        <Input value={noteInput} onChange={e => setNoteInput(e.target.value)}
          placeholder="Add review note…" className="h-6 text-[10px] flex-1"
          onKeyDown={e => e.key === 'Enter' && handleAddNote()} />
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={handleAddNote}>
          <MessageSquare className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Merge / Supersede picker ───────────────────────────────
function MergePicker({ sourceId, chapter, mode, onDone }: {
  sourceId: string; chapter: string; mode: 'merge' | 'supersede'; onDone: () => void;
}) {
  const [search, setSearch] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const candidates = useMemo(() => {
    const all = getActiveDoctrine().filter(d => d.id !== sourceId);
    // Prioritize same chapter
    const sorted = all.sort((a, b) => {
      if (a.chapter === chapter && b.chapter !== chapter) return -1;
      if (b.chapter === chapter && a.chapter !== chapter) return 1;
      return b.confidence - a.confidence;
    });
    if (!search) return sorted.slice(0, 10);
    const q = search.toLowerCase();
    return sorted.filter(d => d.statement.toLowerCase().includes(q)).slice(0, 10);
  }, [sourceId, chapter, search]);

  const handleSelect = useCallback((targetId: string) => {
    if (mode === 'merge') {
      mergeDoctrine(sourceId, targetId);
      toast.success('Merged');
    } else {
      supersedeDoctrine(sourceId, targetId, reasonInput || 'Operator supersede');
      toast.success('Superseded');
    }
    onDone();
  }, [sourceId, mode, reasonInput, onDone]);

  return (
    <div className="space-y-1.5 p-2 bg-muted/30 rounded border border-border/30">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase">
        {mode === 'merge' ? 'Merge into…' : 'Superseded by…'}
      </p>
      <Input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search doctrine…" className="h-6 text-[10px]" />
      {mode === 'supersede' && (
        <Input value={reasonInput} onChange={e => setReasonInput(e.target.value)}
          placeholder="Reason (optional)" className="h-6 text-[10px]" />
      )}
      <div className="max-h-32 overflow-y-auto space-y-0.5">
        {candidates.map(c => (
          <button key={c.id}
            onClick={() => handleSelect(c.id)}
            className="w-full text-left text-[10px] p-1 rounded hover:bg-muted/50 transition-colors flex items-center gap-1">
            <Badge variant="outline" className="text-[8px] shrink-0">{getChapterLabel(c.chapter as any)}</Badge>
            <span className="truncate flex-1">{c.statement}</span>
            <span className="text-muted-foreground shrink-0">{(c.confidence * 100).toFixed(0)}%</span>
          </button>
        ))}
        {candidates.length === 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-2">No candidates</p>
        )}
      </div>
    </div>
  );
}

// ── Propagation Target Panel ───────────────────────────────
function PropagationTargetPanel({ entry, onRefresh }: { entry: DoctrineEntry; onRefresh?: () => void }) {
  const targets: (keyof PropagationTargets)[] = ['dave', 'roleplay', 'prep', 'playbooks'];
  return (
    <div className="space-y-1">
      {targets.map(t => {
        const enabled = entry.governance.propagateTargets[t];
        const blockReason = getPropagationBlockReason(entry, t);
        const floor = PROPAGATION_CONFIDENCE_FLOORS[t] || 0;
        return (
          <div key={t} className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { togglePropagationTarget(entry.id, t, !enabled); onRefresh?.(); }}
                className={cn(
                  'w-3 h-3 rounded-sm border',
                  enabled ? 'bg-primary border-primary' : 'border-muted-foreground',
                )}
              />
              <span className="font-mono capitalize">{t}</span>
              <span className="text-muted-foreground">(floor {(floor * 100).toFixed(0)}%)</span>
            </div>
            <span className={cn(
              blockReason ? 'text-status-yellow' : 'text-status-green',
            )}>
              {blockReason || 'eligible'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Governance Panel ───────────────────────────────────────
function GovernancePanel({ entry }: { entry: DoctrineEntry }) {
  const g = entry.governance;
  return (
    <div className="space-y-1 text-[10px]">
      <Row label="Status" value={getGovernanceLabel(g.status)} />
      <Row label="Reason" value={g.reason || '—'} />
      {g.approvedAt && <Row label="Approved" value={new Date(g.approvedAt).toLocaleString()} />}
      {g.rejectedAt && <Row label="Rejected" value={new Date(g.rejectedAt).toLocaleString()} />}
      {g.rejectedReason && <Row label="Reject reason" value={g.rejectedReason} />}
      <Row label="Review priority" value={String(g.reviewPriority)} />
      <Row label="Propagation" value={g.propagationEnabled ? 'Enabled' : 'Disabled'} />
      <Row label="Legacy" value={g.isLegacyHydrated ? 'Yes' : 'No'} />
      {g.reviewNotes && (
        <div>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mt-1">Notes</p>
          <p className="text-[10px] text-muted-foreground whitespace-pre-wrap">{g.reviewNotes}</p>
        </div>
      )}
    </div>
  );
}

// ── Collapsible section ────────────────────────────────────
function CollapsibleSection({ title, icon, children, defaultOpen = false }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground w-full">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {icon}
        {title}
      </button>
      {open && <div className="mt-1 pl-4">{children}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-mono text-foreground text-right truncate">{value}</span>
    </div>
  );
}

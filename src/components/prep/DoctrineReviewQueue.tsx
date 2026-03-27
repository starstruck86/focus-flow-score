/**
 * Doctrine Review Queue — fast triage UI for governing doctrine entries.
 *
 * Shows items needing review, sorted by priority.
 * Operator can approve, reject, merge, archive, adjust confidence,
 * toggle propagation, and add notes.
 */

import { memo, useMemo, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Check, X, Archive, ChevronDown, ChevronUp,
  ArrowDown, ArrowUp, Eye, EyeOff, GitMerge,
  MessageSquare, AlertTriangle, Copy,
} from 'lucide-react';
import {
  getDoctrineReviewQueue,
  approveDoctrine,
  rejectDoctrine,
  archiveDoctrine,
  adjustDoctrineConfidence,
  togglePropagation,
  addReviewNote,
  getChapterLabel,
  getFreshnessColor,
  getGovernanceColor,
  getGovernanceLabel,
  type ReviewQueueItem,
  type DoctrineEntry,
} from '@/lib/salesBrain';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export const DoctrineReviewQueue = memo(function DoctrineReviewQueue() {
  const [refreshKey, setRefreshKey] = useState(0);
  const queue = useMemo(() => getDoctrineReviewQueue(), [refreshKey]);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  if (queue.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center">
          <Check className="h-6 w-6 mx-auto mb-2 text-primary" />
          <p className="text-sm font-medium text-foreground">All clear</p>
          <p className="text-xs text-muted-foreground mt-1">No doctrine items need review</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{queue.length} items need review</p>
        <Button variant="ghost" size="sm" className="text-xs h-6" onClick={refresh}>Refresh</Button>
      </div>
      <ScrollArea className="max-h-[500px]">
        <div className="space-y-2">
          {queue.map(item => (
            <ReviewQueueCard key={item.entry.id} item={item} onAction={refresh} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
});

function ReviewQueueCard({ item, onAction }: { item: ReviewQueueItem; onAction: () => void }) {
  const { entry, queueReason, priority } = item;
  const [expanded, setExpanded] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [rejectInput, setRejectInput] = useState('');
  const [showReject, setShowReject] = useState(false);

  const handleApprove = useCallback(() => {
    approveDoctrine(entry.id);
    toast.success('Doctrine approved');
    onAction();
  }, [entry.id, onAction]);

  const handleReject = useCallback(() => {
    if (!rejectInput.trim()) { toast.error('Rejection reason required'); return; }
    rejectDoctrine(entry.id, rejectInput.trim());
    toast.success('Doctrine rejected');
    setShowReject(false);
    onAction();
  }, [entry.id, rejectInput, onAction]);

  const handleArchive = useCallback(() => {
    archiveDoctrine(entry.id);
    toast.success('Doctrine archived');
    onAction();
  }, [entry.id, onAction]);

  const handleAddNote = useCallback(() => {
    if (!noteInput.trim()) return;
    addReviewNote(entry.id, noteInput.trim());
    setNoteInput('');
    toast.success('Note added');
  }, [entry.id, noteInput]);

  return (
    <Card className="border-border/50">
      <CardContent className="p-3 space-y-2">
        {/* Header row */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[9px]">{getChapterLabel(entry.chapter)}</Badge>
              <Badge className={cn('text-[8px]', getGovernanceColor(entry.governance.status))}>
                {getGovernanceLabel(entry.governance.status)}
              </Badge>
              <Badge className={cn('text-[8px]', getFreshnessColor(entry.freshnessState))}>
                {entry.freshnessState}
              </Badge>
              <span className="text-[10px] text-muted-foreground font-mono">
                {(entry.confidence * 100).toFixed(0)}%
              </span>
              {entry.governance.duplicateFlag !== 'none' && (
                <Badge variant="outline" className="text-[8px] border-status-yellow text-status-yellow">
                  <Copy className="h-2.5 w-2.5 mr-0.5" />dup
                </Badge>
              )}
              {entry.governance.conflictFlag !== 'none' && (
                <Badge variant="outline" className="text-[8px] border-destructive text-destructive">
                  <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />conflict
                </Badge>
              )}
            </div>
            <p className="text-xs text-foreground mt-1 leading-snug">{entry.statement}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{queueReason}</p>
          </div>
          <button onClick={() => setExpanded(v => !v)} className="shrink-0 text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Action row — always visible for fast triage */}
        <div className="flex items-center gap-1 flex-wrap">
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={handleApprove}>
            <Check className="h-3 w-3" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setShowReject(v => !v)}>
            <X className="h-3 w-3" /> Reject
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
            onClick={() => { adjustDoctrineConfidence(entry.id, 0.1); onAction(); }}>
            <ArrowUp className="h-3 w-3" /> Conf
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
            onClick={() => { adjustDoctrineConfidence(entry.id, -0.1); onAction(); }}>
            <ArrowDown className="h-3 w-3" /> Conf
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
            onClick={() => { togglePropagation(entry.id, !entry.governance.propagationEnabled); onAction(); }}>
            {entry.governance.propagationEnabled ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {entry.governance.propagationEnabled ? 'Disable' : 'Enable'}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" onClick={handleArchive}>
            <Archive className="h-3 w-3" /> Archive
          </Button>
        </div>

        {/* Rejection input */}
        {showReject && (
          <div className="flex gap-1.5">
            <Input
              value={rejectInput}
              onChange={e => setRejectInput(e.target.value)}
              placeholder="Reason for rejection"
              className="h-7 text-xs flex-1"
              onKeyDown={e => e.key === 'Enter' && handleReject()}
            />
            <Button size="sm" className="h-7 text-xs" onClick={handleReject}>Reject</Button>
          </div>
        )}

        {/* Expanded detail */}
        {expanded && (
          <div className="space-y-2 pt-1 border-t border-border/30">
            {entry.tacticalImplication && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tactical Implication</p>
                <p className="text-xs text-foreground">{entry.tacticalImplication}</p>
              </div>
            )}
            {entry.talkTracks.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Talk Tracks</p>
                {entry.talkTracks.map((t, i) => <p key={i} className="text-xs text-foreground">• {t}</p>)}
              </div>
            )}
            {entry.antiPatterns.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Anti-Patterns</p>
                {entry.antiPatterns.map((a, i) => <p key={i} className="text-xs text-destructive">⚠ {a}</p>)}
              </div>
            )}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sources</p>
              <p className="text-[10px] text-muted-foreground">
                {entry.sourceResourceIds.length} resource(s), {entry.sourceInsightIds.length} insight(s)
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Propagation</p>
              <div className="flex gap-2 text-[10px]">
                {(['dave', 'roleplay', 'prep', 'playbooks'] as const).map(t => (
                  <span key={t} className={cn(
                    'font-mono',
                    entry.governance.propagateTargets[t] ? 'text-primary' : 'text-muted-foreground line-through'
                  )}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            {entry.governance.reviewNotes && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</p>
                <p className="text-[10px] text-muted-foreground whitespace-pre-wrap">{entry.governance.reviewNotes}</p>
              </div>
            )}
            {/* Add note */}
            <div className="flex gap-1.5">
              <Input
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                placeholder="Add review note…"
                className="h-6 text-[10px] flex-1"
                onKeyDown={e => e.key === 'Enter' && handleAddNote()}
              />
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={handleAddNote}>
                <MessageSquare className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Resource Readiness — lightweight admin view for auditing resource health.
 */

import { useState, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, RefreshCw, Wrench, Sparkles, Zap, Trash2, Tag, CheckCircle2,
  AlertTriangle, XCircle, FileText, Brain, HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  auditResourceReadiness,
  bulkFixContentBacked,
  bulkAutoTag,
  bulkActivateHighConfidence,
  type AuditSummary,
  type ReadinessBucket,
  type AuditedResource,
} from '@/lib/resourceAudit';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { groupTagsByDimension, getDimensionLabel, getDimensionColor } from '@/lib/resourceTags';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BUCKET_CONFIG: Record<ReadinessBucket, { label: string; icon: React.ReactNode; color: string }> = {
  operationalized: { label: 'Operationalized', icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-emerald-600' },
  ready: { label: 'Ready', icon: <FileText className="h-3.5 w-3.5" />, color: 'text-primary' },
  extractable_not_operationalized: { label: 'Extractable / Not Activated', icon: <Sparkles className="h-3.5 w-3.5" />, color: 'text-blue-500' },
  needs_tagging: { label: 'Needs Tagging', icon: <Tag className="h-3.5 w-3.5" />, color: 'text-amber-500' },
  content_backed_needs_fix: { label: 'Content-Backed Needs Fix', icon: <Wrench className="h-3.5 w-3.5" />, color: 'text-orange-500' },
  blocked_incorrectly: { label: 'Blocked Incorrectly', icon: <XCircle className="h-3.5 w-3.5" />, color: 'text-destructive' },
  missing_content: { label: 'Missing Content', icon: <HelpCircle className="h-3.5 w-3.5" />, color: 'text-muted-foreground' },
  junk_or_low_signal: { label: 'Junk / Low Signal', icon: <Trash2 className="h-3.5 w-3.5" />, color: 'text-muted-foreground' },
  orphaned_or_inconsistent: { label: 'Orphaned / Inconsistent', icon: <AlertTriangle className="h-3.5 w-3.5" />, color: 'text-amber-600' },
};

const BUCKET_ORDER: ReadinessBucket[] = [
  'operationalized', 'ready', 'extractable_not_operationalized', 'needs_tagging',
  'content_backed_needs_fix', 'blocked_incorrectly', 'missing_content',
  'junk_or_low_signal', 'orphaned_or_inconsistent',
];

export function ResourceReadinessSheet({ open, onOpenChange }: Props) {
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedBucket, setExpandedBucket] = useState<ReadinessBucket | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    try {
      const result = await auditResourceReadiness();
      setAudit(result);
    } catch (e) {
      toast.error('Audit failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFixContentBacked = async () => {
    if (!audit) return;
    const ids = audit.buckets.content_backed_needs_fix.map(r => r.id);
    if (ids.length === 0) return;
    setActionLoading('fix');
    const fixed = await bulkFixContentBacked(ids);
    toast.success(`Fixed ${fixed} content-backed resources`);
    setActionLoading(null);
    await runAudit();
  };

  const handleAutoTag = async () => {
    if (!audit) return;
    const ids = audit.buckets.needs_tagging.map(r => r.id);
    if (ids.length === 0) return;
    setActionLoading('tag');
    const tagged = await bulkAutoTag(ids);
    toast.success(`Auto-tagged ${tagged} resources`);
    setActionLoading(null);
    await runAudit();
  };

  const handleActivateHighConfidence = async () => {
    setActionLoading('activate');
    const count = await bulkActivateHighConfidence();
    toast.success(`Activated ${count} high-confidence knowledge items`);
    setActionLoading(null);
    await runAudit();
  };

  const handleDeleteJunk = async () => {
    if (!deleteConfirm) return;
    setActionLoading('delete');
    let deleted = 0;
    for (const id of deleteConfirm) {
      const { error } = await supabase.from('resources').delete().eq('id', id);
      if (!error) deleted++;
    }
    toast.success(`Deleted ${deleted} junk resources`);
    setDeleteConfirm(null);
    setActionLoading(null);
    await runAudit();
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0">
          <SheetHeader className="p-4 pb-2 border-b border-border">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                Resource Readiness
              </SheetTitle>
              <Button size="sm" onClick={runAudit} disabled={loading} className="gap-1.5 h-8">
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {audit ? 'Re-scan' : 'Run Audit'}
              </Button>
            </div>
            {audit && (
              <p className="text-xs text-muted-foreground">
                {audit.totalScanned} resources scanned
              </p>
            )}
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-90px)]">
            {!audit && !loading && (
              <div className="p-8 text-center space-y-3">
                <Brain className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click "Run Audit" to scan all resources</p>
              </div>
            )}

            {loading && !audit && (
              <div className="p-8 text-center space-y-3">
                <Loader2 className="h-6 w-6 mx-auto animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Scanning resources...</p>
              </div>
            )}

            {audit && (
              <div className="p-4 space-y-3">
                {/* Summary grid */}
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="Operationalized" value={audit.counts.operationalized} color="text-emerald-600" />
                  <MiniStat label="Ready" value={audit.counts.ready} color="text-primary" />
                  <MiniStat label="Needs Fix" value={audit.counts.content_backed_needs_fix + audit.counts.blocked_incorrectly} color="text-orange-500" />
                </div>

                <Separator />

                {/* Bulk actions */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-foreground">Bulk Actions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {audit.counts.content_backed_needs_fix > 0 && (
                      <Button
                        variant="outline" size="sm"
                        className="h-7 text-[10px] gap-1"
                        disabled={!!actionLoading}
                        onClick={handleFixContentBacked}
                      >
                        {actionLoading === 'fix' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                        Fix {audit.counts.content_backed_needs_fix} Content-Backed
                      </Button>
                    )}
                    {audit.counts.needs_tagging > 0 && (
                      <Button
                        variant="outline" size="sm"
                        className="h-7 text-[10px] gap-1"
                        disabled={!!actionLoading}
                        onClick={handleAutoTag}
                      >
                        {actionLoading === 'tag' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Tag className="h-3 w-3" />}
                        Auto-tag {audit.counts.needs_tagging}
                      </Button>
                    )}
                    <Button
                      variant="outline" size="sm"
                      className="h-7 text-[10px] gap-1"
                      disabled={!!actionLoading}
                      onClick={handleActivateHighConfidence}
                    >
                      {actionLoading === 'activate' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      Activate High-Confidence
                    </Button>
                    {audit.counts.junk_or_low_signal > 0 && (
                      <Button
                        variant="outline" size="sm"
                        className="h-7 text-[10px] gap-1 text-destructive"
                        disabled={!!actionLoading}
                        onClick={() => setDeleteConfirm(audit.buckets.junk_or_low_signal.map(r => r.id))}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete {audit.counts.junk_or_low_signal} Junk
                      </Button>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Bucket list */}
                <div className="space-y-1">
                  {BUCKET_ORDER.map(key => {
                    const cfg = BUCKET_CONFIG[key];
                    const count = audit.counts[key];
                    if (count === 0) return null;
                    const isExpanded = expandedBucket === key;

                    return (
                      <div key={key}>
                        <button
                          onClick={() => setExpandedBucket(isExpanded ? null : key)}
                          className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent/50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className={cfg.color}>{cfg.icon}</span>
                            <span className="text-xs font-medium text-foreground">{cfg.label}</span>
                          </div>
                          <Badge variant="secondary" className="text-[10px] h-5">{count}</Badge>
                        </button>

                        {isExpanded && (
                          <div className="ml-6 space-y-1 mb-2">
                            {audit.buckets[key].slice(0, 20).map(r => (
                              <ResourceRow key={r.id} resource={r} />
                            ))}
                            {count > 20 && (
                              <p className="text-[10px] text-muted-foreground pl-2">+ {count - 20} more</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteConfirm?.length} junk resources?</AlertDialogTitle>
            <AlertDialogDescription>
              These resources have very low content (&lt;50 chars) and no URL. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteJunk}
              className="bg-destructive text-destructive-foreground"
              disabled={actionLoading === 'delete'}
            >
              {actionLoading === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ResourceRow({ resource: r }: { resource: AuditedResource }) {
  const tagGroups = groupTagsByDimension(r.tags);

  return (
    <div className="p-2 rounded border border-border bg-card text-xs space-y-1">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-foreground truncate flex-1">{r.title}</p>
        {r.isNotionDerived && (
          <Badge variant="outline" className="text-[8px] h-3.5 px-1 shrink-0">Notion</Badge>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
        <span>{r.contentLength} chars</span>
        <span>·</span>
        <span>{r.enrichmentStatus}</span>
        {r.qualityScore !== null && (
          <>
            <span>·</span>
            <span>Score: {Math.round(r.qualityScore)}</span>
          </>
        )}
        {r.knowledgeItemCount > 0 && (
          <>
            <span>·</span>
            <span>{r.activeKnowledgeCount}/{r.knowledgeItemCount} KI active</span>
          </>
        )}
      </div>
      {/* Tags */}
      {tagGroups.size > 0 && (
        <div className="flex flex-wrap gap-0.5">
          {[...tagGroups.entries()].slice(0, 3).map(([dim, vals]) => (
            <Badge key={dim} variant="outline" className={cn('text-[8px] h-3.5 px-1', getDimensionColor(dim))}>
              {getDimensionLabel(dim)}: {vals.slice(0, 2).join(', ')}
            </Badge>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground italic">{r.recommendedAction}</p>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border p-2 text-center">
      <p className={cn('text-lg font-bold', color)}>{value}</p>
      <p className="text-[9px] text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * Run control buttons, bucket scope selector, and progress indicator.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Zap, Square, Play, Eye, Inbox, Loader2, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RunResult, RunScopeBucket } from './types';
import { RUN_SCOPE_META, DEFAULT_RUN_SCOPE } from './types';

interface Props {
  isRunning: boolean;
  isLoading: boolean;
  phase: RunResult['phase'];
  manualInboxCount: number;
  onRunFull: (selectedBuckets: RunScopeBucket[]) => void;
  onAutoFix: () => void;
  onVerifyOnly: () => void;
  onStop: () => void;
  onToggleInbox: () => void;
  showInbox: boolean;
  onBulkBucket?: (bucket: RunScopeBucket) => void;
  bucketCounts?: Record<string, number>;
}

export function RunControls({
  isRunning, isLoading, phase, manualInboxCount,
  onRunFull, onAutoFix, onVerifyOnly, onStop, onToggleInbox, showInbox,
  onBulkBucket, bucketCounts,
}: Props) {
  const [selectedBuckets, setSelectedBuckets] = useState<RunScopeBucket[]>([...DEFAULT_RUN_SCOPE]);
  const [showScope, setShowScope] = useState(false);

  const toggleBucket = (b: RunScopeBucket) => {
    setSelectedBuckets(prev =>
      prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]
    );
  };

  const allBuckets = Object.keys(RUN_SCOPE_META) as RunScopeBucket[];

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Enrichment Engine</p>
            <p className="text-[10px] text-muted-foreground">Scan → Verify → Auto-fix → Re-verify → Report</p>
          </div>
          {!isRunning ? (
            <Button onClick={() => onRunFull(selectedBuckets)} disabled={isLoading || selectedBuckets.length === 0} className="bg-primary text-primary-foreground font-semibold gap-1.5 h-8 text-xs">
              <Zap className="h-3.5 w-3.5" /> Run Full System
            </Button>
          ) : (
            <Button variant="destructive" onClick={onStop} className="gap-1.5 h-8 text-xs">
              <Square className="h-3.5 w-3.5" /> Stop ({phase})
            </Button>
          )}
        </div>

        {/* Scope selector toggle */}
        {!isRunning && (
          <button
            onClick={() => setShowScope(!showScope)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showScope ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Run Scope: {selectedBuckets.length} bucket{selectedBuckets.length !== 1 ? 's' : ''} selected
          </button>
        )}

        {/* Bucket selection chips */}
        {!isRunning && showScope && (
          <div className="flex flex-wrap gap-1.5">
            {allBuckets.map(b => {
              const meta = RUN_SCOPE_META[b];
              const active = selectedBuckets.includes(b);
              const count = bucketCounts?.[b] ?? 0;
              return (
                <div key={b} className="flex items-center gap-0.5">
                  <button
                    onClick={() => toggleBucket(b)}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border transition-all',
                      active
                        ? 'bg-primary/10 border-primary/40 text-primary font-medium'
                        : 'bg-muted/50 border-border text-muted-foreground hover:border-foreground/20',
                      !meta.defaultOn && !active && 'border-dashed'
                    )}
                    title={meta.description}
                  >
                    {meta.label}
                    {count > 0 && <Badge variant="secondary" className="text-[8px] h-3.5 px-1 ml-0.5">{count}</Badge>}
                  </button>
                  {onBulkBucket && count > 0 && (
                    <button
                      onClick={() => onBulkBucket(b)}
                      disabled={isLoading}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                      title={`Re-enrich all ${count} in ${meta.label}`}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isRunning && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={onAutoFix} disabled={isLoading}>
              <Play className="h-3 w-3" /> Auto-Fix Only
            </Button>
            <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={onVerifyOnly} disabled={isLoading}>
              <Eye className="h-3 w-3" /> Verify Only
            </Button>
            <Button variant={showInbox ? 'secondary' : 'outline'} size="sm" className="h-6 text-[10px] gap-1" onClick={onToggleInbox}>
              <Inbox className="h-3 w-3" /> Manual Inbox
              {manualInboxCount > 0 && (
                <Badge variant="secondary" className="text-[9px] ml-1 h-4 px-1">{manualInboxCount}</Badge>
              )}
            </Button>
          </div>
        )}
        {isRunning && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {phase === 'scanning' && 'Scanning all resources…'}
            {phase === 'verifying' && 'Verifying quality & state…'}
            {phase === 'remediating' && 'Running autonomous remediation…'}
            {phase === 'analyzing' && 'Analyzing results…'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

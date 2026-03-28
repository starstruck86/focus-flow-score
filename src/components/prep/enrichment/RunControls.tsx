/**
 * Run control buttons and progress indicator.
 * Part 8 — Run Full System, Auto-Fix Only, Verify Only.
 */
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Zap, Square, Play, Eye, Inbox, Loader2 } from 'lucide-react';
import type { RunResult } from './types';

interface Props {
  isRunning: boolean;
  isLoading: boolean;
  phase: RunResult['phase'];
  manualInboxCount: number;
  onRunFull: () => void;
  onAutoFix: () => void;
  onVerifyOnly: () => void;
  onStop: () => void;
  onToggleInbox: () => void;
  showInbox: boolean;
}

export function RunControls({
  isRunning, isLoading, phase, manualInboxCount,
  onRunFull, onAutoFix, onVerifyOnly, onStop, onToggleInbox, showInbox,
}: Props) {
  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Enrichment Engine</p>
            <p className="text-[10px] text-muted-foreground">Scan → Verify → Auto-fix → Re-verify → Report</p>
          </div>
          {!isRunning ? (
            <Button onClick={onRunFull} disabled={isLoading} className="bg-primary text-primary-foreground font-semibold gap-1.5 h-8 text-xs">
              <Zap className="h-3.5 w-3.5" /> Run Full System
            </Button>
          ) : (
            <Button variant="destructive" onClick={onStop} className="gap-1.5 h-8 text-xs">
              <Square className="h-3.5 w-3.5" /> Stop ({phase})
            </Button>
          )}
        </div>
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

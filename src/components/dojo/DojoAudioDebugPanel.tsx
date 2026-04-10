/**
 * DojoAudioDebugPanel — compact debug/recovery surface for Dojo audio delivery.
 * Toggle: Ctrl+Shift+A (or Cmd+Shift+A on Mac).
 * Scoped to Sales Dojo. Not a generic debug tool.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bug, X, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { AudioControllerState, RestoreReason, ChunkAudibleState } from '@/lib/dojo/dojoAudioController';
import type { ControllerDirective } from '@/lib/dojo/dojoAudioController';
import type { DojoAudioMetrics } from '@/lib/dojo/dojoAudioAnalytics';
import { loadSnapshot, clearSnapshot } from '@/lib/dojo/dojoSessionSnapshot';
import { getOwnerInfo, TAB_ID } from '@/lib/dojo/dojoSessionOwnership';
import { getCurrentVisibility } from '@/lib/dojo/dojoVisibilityGuard';

interface Props {
  controllerState: AudioControllerState | null;
  lastDirective: ControllerDirective | null;
  metrics: DojoAudioMetrics;
  wasRecovered: boolean;
  restoreReason?: RestoreReason;
  ownershipConflict?: boolean;
  onSimulateInterrupt?: () => void;
  onSimulateTimeout?: () => void;
  onForceTextFallback?: () => void;
  onRestoreVoice?: () => void;
  onReplayLast?: () => void;
  onClearSnapshot?: () => void;
  onSimulateHiddenTab?: () => void;
  onSimulateOwnerConflict?: () => void;
  onSimulateAutoplayBlock?: () => void;
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2 text-[10px]', warn && 'text-destructive')}>
      <span className="text-muted-foreground/60 shrink-0">{label}</span>
      <span className="truncate text-right font-mono">{value}</span>
    </div>
  );
}

export default function DojoAudioDebugPanel({
  controllerState: ctrl,
  lastDirective,
  metrics,
  wasRecovered,
  restoreReason,
  ownershipConflict,
  onSimulateInterrupt,
  onSimulateTimeout,
  onForceTextFallback,
  onRestoreVoice,
  onReplayLast,
  onClearSnapshot,
  onSimulateHiddenTab,
  onSimulateOwnerConflict,
  onSimulateAutoplayBlock,
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const exportState = useCallback(() => {
    const ownerInfo = ctrl?.dojo.sessionId ? getOwnerInfo(ctrl.dojo.sessionId) : null;
    const payload = {
      timestamp: new Date().toISOString(),
      tabId: TAB_ID,
      tabVisibility: getCurrentVisibility(),
      controllerState: ctrl
        ? {
            deliveryMode: ctrl.deliveryMode,
            degradation: ctrl.degradation,
            phase: ctrl.dojo.phase,
            currentChunkIndex: ctrl.dojo.currentChunkIndex,
            totalChunks: ctrl.dojo.chunks.length,
            completedChunkIds: Array.from(ctrl.completedChunkIds),
            skippedChunkIds: Array.from(ctrl.skippedChunkIds),
            replayedChunkIds: Array.from(ctrl.replayedChunkIds),
            chunkAttempts: Object.fromEntries(ctrl.chunkAttempts),
            currentPlayingChunkId: ctrl.dojo.playback.currentPlayingChunkId,
            consecutiveFailures: ctrl.dojo.playback.consecutiveFailures,
            chunkStartedAt: ctrl.chunkStartedAt,
            chunkAudibleState: ctrl.chunkAudibleState,
            lastAudibleChunkId: ctrl.lastAudibleChunkId,
            restoreReason: ctrl.restoreReason,
            tabVisible: ctrl.tabVisible,
          }
        : null,
      lastDirective,
      metrics,
      wasRecovered,
      restoreReason,
      ownershipConflict,
      ownerInfo,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dojo-audio-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [ctrl, lastDirective, metrics, wasRecovered, restoreReason, ownershipConflict]);

  if (!visible) return null;

  const sessionId = ctrl?.dojo.sessionId ?? '';
  const snapResult = sessionId ? loadSnapshot(sessionId) : null;
  const ownerInfo = sessionId ? getOwnerInfo(sessionId) : null;
  const currentChunk = ctrl?.dojo.chunks[ctrl.dojo.currentChunkIndex];
  const playingId = ctrl?.dojo.playback.currentPlayingChunkId;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        className="fixed bottom-4 right-4 z-[100] w-80 max-h-[80vh] overflow-y-auto bg-background/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl text-xs font-mono flex flex-col"
      >
        <div className="flex items-center justify-between p-3 pb-2 sticky top-0 bg-background/95 backdrop-blur-xl z-10">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <Bug className="w-3.5 h-3.5" />
            Dojo Audio Debug
          </div>
          <button onClick={() => setVisible(false)} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {!ctrl ? (
          <div className="px-3 pb-3 text-muted-foreground/60 text-[10px]">No active session</div>
        ) : (
          <div className="px-3 pb-3 space-y-2">
            {/* Session state */}
            <div className="space-y-0.5">
              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Session</p>
              <Row label="Session ID" value={sessionId.slice(0, 12) + '…'} />
              <Row label="Phase" value={ctrl.dojo.phase} />
              <Row label="Mode" value={ctrl.deliveryMode} warn={ctrl.deliveryMode === 'text_fallback'} />
              <Row label="Degradation" value={ctrl.degradation} warn={ctrl.degradation !== 'none'} />
              <Row label="Recovered" value={wasRecovered ? 'yes' : 'no'} />
              <Row label="Restore Reason" value={restoreReason ?? ctrl.restoreReason ?? '—'} warn={!!restoreReason} />
              <Row label="Tab Visible" value={ctrl.tabVisible ? 'yes' : 'no'} warn={!ctrl.tabVisible} />
            </div>

            {/* Chunk state */}
            <div className="space-y-0.5 pt-1 border-t border-border/30">
              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Chunk</p>
              <Row label="Index" value={`${ctrl.dojo.currentChunkIndex}/${ctrl.dojo.chunks.length}`} />
              <Row label="Current ID" value={currentChunk?.id.slice(0, 8) ?? '—'} />
              <Row label="Current Label" value={currentChunk?.label ?? '—'} />
              <Row label="Playing ID" value={playingId?.slice(0, 8) ?? '—'} />
              <Row label="Audible State" value={ctrl.chunkAudibleState} warn={ctrl.chunkAudibleState.startsWith('failed')} />
              <Row label="Last Audible" value={ctrl.lastAudibleChunkId?.slice(0, 8) ?? '—'} />
              <Row
                label="Attempts"
                value={currentChunk ? String(ctrl.chunkAttempts.get(currentChunk.id) ?? 0) : '—'}
                warn={(currentChunk && (ctrl.chunkAttempts.get(currentChunk.id) ?? 0) > 1) || false}
              />
              <Row label="Consecutive Fails" value={String(ctrl.dojo.playback.consecutiveFailures)} warn={ctrl.dojo.playback.consecutiveFailures > 2} />
              <Row label="Started At" value={ctrl.chunkStartedAt ? `${Math.round((Date.now() - ctrl.chunkStartedAt) / 1000)}s ago` : '—'} />
            </div>

            {/* Delivery stats */}
            <div className="space-y-0.5 pt-1 border-t border-border/30">
              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Delivery</p>
              <Row label="Completed" value={String(ctrl.completedChunkIds.size)} />
              <Row label="Skipped" value={String(ctrl.skippedChunkIds.size)} />
              <Row label="Replayed" value={String(ctrl.replayedChunkIds.size)} />
            </div>

            {/* Metrics */}
            <div className="space-y-0.5 pt-1 border-t border-border/30">
              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Metrics</p>
              <Row label="Requested" value={String(metrics.chunksRequested)} />
              <Row label="Completed" value={String(metrics.chunksCompleted)} />
              <Row label="Audible" value={String(metrics.chunksAudible)} />
              <Row label="Failed" value={String(metrics.chunksFailed)} warn={metrics.chunksFailed > 0} />
              <Row label="Failed Pre-Audible" value={String(metrics.chunksFailedBeforeAudible)} warn={metrics.chunksFailedBeforeAudible > 0} />
              <Row label="Failed Post-Audible" value={String(metrics.chunksFailedAfterAudible)} warn={metrics.chunksFailedAfterAudible > 0} />
              <Row label="Timed Out" value={String(metrics.chunksTimedOut)} warn={metrics.chunksTimedOut > 0} />
              <Row label="Retries" value={String(metrics.retryAttempts)} />
              <Row label="Crash Recoveries" value={String(metrics.crashRecoveryCount)} />
              <Row label="Dup Suppressed" value={String(metrics.duplicateCallbackSuppressions)} />
              <Row label="Stale Suppressed" value={String(metrics.staleCallbackSuppressions)} />
              <Row label="Tab Hidden" value={String(metrics.tabHiddenCount)} />
              <Row label="Tab Resume" value={String(metrics.tabResumeCount)} />
              <Row label="Ownership Conflicts" value={String(metrics.ownershipConflictCount)} warn={metrics.ownershipConflictCount > 0} />
            </div>

            {/* Ownership */}
            {ownerInfo && (
              <div className="space-y-0.5 pt-1 border-t border-border/30">
                <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Ownership</p>
                <Row label="This Tab" value={TAB_ID.slice(0, 12)} />
                <Row label="Owner" value={ownerInfo.isThisTab ? 'this tab' : ownerInfo.ownerTabId?.slice(0, 12) ?? '—'} warn={!ownerInfo.isThisTab && ownerInfo.hasOwner} />
                <Row label="Conflict" value={ownershipConflict ? 'yes' : 'no'} warn={ownershipConflict} />
                <Row label="Stale" value={ownerInfo.isStale ? 'yes' : 'no'} warn={ownerInfo.isStale} />
                {ownerInfo.lastHeartbeatAge !== null && (
                  <Row label="Heartbeat Age" value={`${Math.round(ownerInfo.lastHeartbeatAge / 1000)}s`} />
                )}
              </div>
            )}

            {/* Snapshot */}
            {snapResult && (
              <div className="space-y-0.5 pt-1 border-t border-border/30">
                <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Snapshot</p>
                <Row label="Has Snapshot" value={snapResult.ok ? 'yes' : 'no'} />
                {snapResult.ok && (
                  <>
                    <Row label="Version" value={String(snapResult.snapshot.version)} />
                    <Row
                      label="Age"
                      value={`${Math.round((Date.now() - new Date(snapResult.snapshot.savedAt).getTime()) / 1000)}s`}
                    />
                  </>
                )}
                {!snapResult.ok && 'reason' in snapResult && (
                  <Row label="Reason" value={snapResult.reason} warn />
                )}
              </div>
            )}

            {/* Last directive */}
            <div className="space-y-0.5 pt-1 border-t border-border/30">
              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Last Directive</p>
              <Row label="Kind" value={lastDirective?.kind ?? '—'} />
              {lastDirective?.kind === 'no_op' && <Row label="Reason" value={(lastDirective as any).reason} />}
            </div>

            {/* Actions */}
            <div className="pt-2 border-t border-border/30 flex flex-wrap gap-1">
              {onSimulateInterrupt && (
                <Button variant="outline" size="sm" className="h-6 text-[9px] px-2" onClick={onSimulateInterrupt}>
                  Interrupt
                </Button>
              )}
              {onSimulateTimeout && (
                <Button variant="outline" size="sm" className="h-6 text-[9px] px-2" onClick={onSimulateTimeout}>
                  Timeout
                </Button>
              )}
              {onForceTextFallback && (
                <Button variant="outline" size="sm" className="h-6 text-[9px] px-2" onClick={onForceTextFallback}>
                  Text Fallback
                </Button>
              )}
              {onRestoreVoice && (
                <Button variant="outline" size="sm" className="h-6 text-[9px] px-2" onClick={onRestoreVoice}>
                  Restore Voice
                </Button>
              )}
              {onReplayLast && (
                <Button variant="outline" size="sm" className="h-6 text-[9px] px-2" onClick={onReplayLast}>
                  Replay
                </Button>
              )}
              {onSimulateHiddenTab && (
                <Button variant="outline" size="sm" className="h-6 text-[9px] px-2" onClick={onSimulateHiddenTab}>
                  Sim Hidden
                </Button>
              )}
              {onSimulateOwnerConflict && (
                <Button variant="outline" size="sm" className="h-6 text-[9px] px-2" onClick={onSimulateOwnerConflict}>
                  Sim Conflict
                </Button>
              )}
              {onSimulateAutoplayBlock && (
                <Button variant="outline" size="sm" className="h-6 text-[9px] px-2" onClick={onSimulateAutoplayBlock}>
                  Sim Autoplay
                </Button>
              )}
              {onClearSnapshot && (
                <Button variant="destructive" size="sm" className="h-6 text-[9px] px-2" onClick={() => { if (sessionId) clearSnapshot(sessionId); onClearSnapshot?.(); }}>
                  Clear Snap
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2 ml-auto" onClick={exportState}>
                <Download className="h-3 w-3 mr-1" /> Export
              </Button>
            </div>
          </div>
        )}

        <div className="px-3 py-1.5 border-t border-border/30 text-[9px] text-muted-foreground/40">
          Ctrl+Shift+A to toggle
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * DaveCoachingDelivery — Dave's coaching audio/text delivery UI for Sales Dojo V2.
 *
 * V2 UX upgrades:
 * - Audible-state-aware status (Connecting audio… vs Dave is speaking)
 * - Autoplay gate with "Tap to hear Dave" recovery
 * - Conversational pacing (handled by hook)
 * - Smart recovery messaging ("Picking up where you left off")
 * - Ownership conflict UX with takeover + text-only options
 * - Interrupt acknowledgment in status
 * - Adaptive failure behavior
 */

import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Volume2, VolumeX, SkipForward, RotateCcw,
  Pause, Play, RefreshCw, CheckCircle, AlertTriangle,
  Mic, Loader2,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { summarizeSession } from '@/lib/dojo/dojoAudioAnalytics';
import type { DojoScoreResult } from '@/lib/dojo/types';
import type { SpeechChunk } from '@/lib/dojo/conversationEngine';
import { createSession, loadResult } from '@/lib/dojo/conversationEngine';
import { withPlayback } from '@/lib/dojo/playbackAdapter';
import { useDojoPlayback } from '@/lib/dojo/useDojoPlayback';
import type { TransportConfig } from '@/lib/dojo/elevenlabsTransport';
import type { ControllerDirective, ChunkAudibleState } from '@/lib/dojo/dojoAudioController';

const DojoAudioDebugPanel = lazy(() => import('./DojoAudioDebugPanel'));

// ── Props ──────────────────────────────────────────────────────────

interface DaveCoachingDeliveryProps {
  scoreResult: DojoScoreResult;
  sessionId: string;
  enableVoice?: boolean;
  onDeliveryComplete?: () => void;
}

// ── Status display ─────────────────────────────────────────────────

type DeliveryStatus =
  | 'idle'
  | 'connecting_audio'
  | 'speaking'
  | 'thinking'
  | 'interrupted'
  | 'voice_degraded'
  | 'voice_restored'
  | 'replaying'
  | 'skipped'
  | 'recovered'
  | 'autoplay_blocked'
  | 'ownership_conflict'
  | 'complete';

function deriveStatus(
  directive: ControllerDirective | null,
  isPlaying: boolean,
  deliveryMode: 'voice' | 'text_fallback',
  wasRecovered: boolean,
  ownershipConflict: boolean,
  autoplayBlocked: boolean,
  audibleState: ChunkAudibleState,
  prevStatus: DeliveryStatus
): DeliveryStatus {
  if (ownershipConflict) return 'ownership_conflict';
  if (autoplayBlocked) return 'autoplay_blocked';
  if (!directive) return wasRecovered ? 'recovered' : 'idle';
  if (directive.kind === 'delivery_complete') return 'complete';

  if (directive.kind === 'mode_changed') {
    return directive.mode === 'text_fallback' ? 'voice_degraded' : 'voice_restored';
  }
  if (directive.kind === 'no_op' && directive.reason === 'interrupted') return 'interrupted';
  if (directive.kind === 'chunk_skipped_max_retries') return 'skipped';

  if (deliveryMode === 'text_fallback') return 'voice_degraded';

  // Audible-state-aware: distinguish connecting from actually speaking
  if (isPlaying) {
    if (audibleState === 'audible') return 'speaking';
    if (audibleState === 'requested' || audibleState === 'blob_received' || audibleState === 'play_attempted') {
      return 'connecting_audio';
    }
    return 'speaking';
  }

  // Between chunks with voice mode — show thinking
  if (deliveryMode === 'voice' && directive.kind === 'speak') return 'thinking';

  return prevStatus === 'complete' ? 'complete' : 'idle';
}

const STATUS_CONFIG: Record<DeliveryStatus, { label: string; Icon: LucideIcon; className: string; animate?: boolean } | null> = {
  idle: null,
  connecting_audio: { label: 'Connecting audio…', Icon: Loader2, className: 'text-muted-foreground', animate: true },
  speaking: { label: 'Dave is speaking', Icon: Volume2, className: 'text-primary' },
  thinking: { label: 'Dave is thinking…', Icon: Loader2, className: 'text-muted-foreground', animate: true },
  interrupted: { label: 'Paused — tap Resume to continue', Icon: Pause, className: 'text-amber-500' },
  voice_degraded: { label: 'Voice issue — continuing in text', Icon: VolumeX, className: 'text-amber-500' },
  voice_restored: { label: 'Voice restored', Icon: Volume2, className: 'text-green-500' },
  replaying: { label: 'Replaying last chunk', Icon: RotateCcw, className: 'text-blue-500' },
  skipped: { label: 'Skipped — moving on', Icon: SkipForward, className: 'text-muted-foreground' },
  recovered: { label: 'Picking up where you left off', Icon: RefreshCw, className: 'text-green-500' },
  autoplay_blocked: { label: 'Tap to hear Dave coach you', Icon: Mic, className: 'text-primary' },
  ownership_conflict: { label: 'Dave is active in another tab', Icon: AlertTriangle, className: 'text-amber-500' },
  complete: { label: 'Coaching complete', Icon: CheckCircle, className: 'text-green-500' },
};

// ── Component ──────────────────────────────────────────────────────

export default function DaveCoachingDelivery({
  scoreResult,
  sessionId,
  enableVoice = true,
  onDeliveryComplete,
}: DaveCoachingDeliveryProps) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  const config: TransportConfig = { supabaseUrl, supabaseAnonKey };

  const playback = useDojoPlayback(config);
  const [textChunks, setTextChunks] = useState<SpeechChunk[]>([]);
  const [visibleChunkIds, setVisibleChunkIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<DeliveryStatus>('idle');
  const initializedRef = useRef(false);
  const deliveryCompleteRef = useRef(false);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Initialize: try crash recovery first, then fresh start
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    deliveryCompleteRef.current = false;

    // Try crash recovery from localStorage
    if (playback.tryRecover(sessionId)) {
      setStatus('recovered');
      statusTimerRef.current = setTimeout(() => setStatus((s) => s === 'recovered' ? 'idle' : s), 4000);
      return;
    }

    // Fresh start
    const session = createSession(sessionId);
    const loaded = loadResult(session, scoreResult);
    const withPb = withPlayback(loaded);
    const mode = enableVoice ? 'voice' : 'text_fallback';
    playback.initialize(withPb, mode);

    setTimeout(() => playback.startDelivery(), 50);

    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      revealTimersRef.current.forEach(clearTimeout);
      playback.destroy();
    };
  }, [sessionId, scoreResult, enableVoice]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to directives
  useEffect(() => {
    const d = playback.lastDirective;
    if (!d) return;

    const audibleState = playback.controllerState?.chunkAudibleState ?? 'none';
    const newStatus = deriveStatus(
      d, playback.isPlaying, playback.deliveryMode,
      playback.wasRecovered, playback.ownershipConflict,
      playback.autoplayBlocked, audibleState, status
    );
    setStatus(newStatus);

    // Auto-clear transient statuses
    if (['voice_restored', 'skipped', 'interrupted', 'recovered'].includes(newStatus)) {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => {
        setStatus((s) => (s === newStatus ? 'idle' : s));
      }, 3000);
    }

    // Accumulate text chunks for display
    if (d.kind === 'show_text' || d.kind === 'chunk_skipped_max_retries') {
      const chunk = d.chunk;
      setTextChunks((prev) => {
        if (prev.some((c) => c.id === chunk.id)) return prev;
        const next = [...prev, chunk].sort((a, b) => a.index - b.index);
        // Stagger reveal for text-fallback coaching arc
        const delay = (next.length - 1) * 350;
        const timer = setTimeout(() => {
          setVisibleChunkIds((ids) => new Set([...ids, chunk.id]));
        }, delay);
        revealTimersRef.current.push(timer);
        return next;
      });
    }

    if (d.kind === 'delivery_complete' && !deliveryCompleteRef.current) {
      deliveryCompleteRef.current = true;
      const summary = summarizeSession(playback.metrics);
      supabase
        .from('dojo_sessions')
        .update({ audio_metrics: JSON.parse(JSON.stringify(summary)) })
        .eq('id', sessionId)
        .then(() => {});
      onDeliveryComplete?.();
    }
  }, [playback.lastDirective, playback.isPlaying, playback.deliveryMode, playback.wasRecovered, playback.ownershipConflict, playback.autoplayBlocked, onDeliveryComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update status when audible state changes (for connecting → speaking transition)
  useEffect(() => {
    const audibleState = playback.controllerState?.chunkAudibleState;
    if (!audibleState) return;

    if (audibleState === 'audible' && status === 'connecting_audio') {
      setStatus('speaking');
    }
  }, [playback.controllerState?.chunkAudibleState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track completed chunks for text transcript
  useEffect(() => {
    const ctrl = playback.controllerState;
    if (!ctrl) return;

    ctrl.completedChunkIds.forEach((id) => {
      const chunk = ctrl.dojo.chunks.find((c) => c.id === id);
      if (chunk) {
        setTextChunks((prev) => {
          if (prev.some((c) => c.id === id)) return prev;
          return [...prev, chunk].sort((a, b) => a.index - b.index);
        });
      }
    });
  }, [playback.controllerState]);

  // Update status on ownership conflict / autoplay change
  useEffect(() => {
    if (playback.ownershipConflict) setStatus('ownership_conflict');
  }, [playback.ownershipConflict]);

  useEffect(() => {
    if (playback.autoplayBlocked) setStatus('autoplay_blocked');
  }, [playback.autoplayBlocked]);

  const statusConfig = STATUS_CONFIG[status];
  const currentChunk = playback.controllerState?.dojo.chunks.find(
    (c) => c.id === playback.controllerState?.dojo.playback.currentPlayingChunkId
  );

  return (
    <div className="space-y-3">
      {/* Status Banner */}
      {statusConfig && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-300',
          status === 'voice_degraded' && 'bg-amber-500/5 border-amber-500/20',
          status === 'interrupted' && 'bg-amber-500/5 border-amber-500/20',
          status === 'ownership_conflict' && 'bg-amber-500/5 border-amber-500/20',
          status === 'speaking' && 'bg-primary/5 border-primary/20',
          status === 'connecting_audio' && 'bg-muted/30 border-border/40',
          status === 'thinking' && 'bg-muted/30 border-border/40',
          status === 'voice_restored' && 'bg-green-500/5 border-green-500/20',
          status === 'recovered' && 'bg-green-500/5 border-green-500/20',
          status === 'complete' && 'bg-green-500/5 border-green-500/20',
          status === 'replaying' && 'bg-blue-500/5 border-blue-500/20',
          status === 'autoplay_blocked' && 'bg-primary/5 border-primary/20 cursor-pointer',
          (status === 'skipped' || status === 'idle') && 'bg-muted/30 border-border/40',
        )}
          onClick={status === 'autoplay_blocked' ? () => playback.unlockAudio() : undefined}
          role={status === 'autoplay_blocked' ? 'button' : undefined}
        >
          <statusConfig.Icon
            className={cn(
              'h-4 w-4 shrink-0',
              statusConfig.className,
              statusConfig.animate && 'animate-spin',
            )}
          />
          <span className={cn('text-xs font-medium', statusConfig.className)}>
            {statusConfig.label}
          </span>
          {status === 'speaking' && currentChunk && (
            <span className="text-xs text-muted-foreground ml-auto mr-2">
              {currentChunk.label}
            </span>
          )}

          {/* Speaking pulse */}
          {status === 'speaking' && (
            <div className="ml-auto flex items-center gap-0.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1 bg-primary rounded-full animate-pulse"
                  style={{
                    height: `${8 + Math.random() * 8}px`,
                    animationDelay: `${i * 150}ms`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Autoplay Blocked — prominent tap target */}
      {status === 'autoplay_blocked' && (
        <div className="flex items-center gap-2 px-3">
          <Button
            variant="default" size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => playback.unlockAudio()}
          >
            <Volume2 className="h-3.5 w-3.5" />
            Tap to hear Dave
          </Button>
          <span className="text-[10px] text-muted-foreground">
            or continue reading below
          </span>
        </div>
      )}

      {/* Ownership Conflict Actions */}
      {status === 'ownership_conflict' && (
        <div className="flex items-center gap-2 px-3">
          <Button
            variant="outline" size="sm"
            className="h-7 text-xs"
            onClick={() => playback.retryOwnership()}
          >
            Take over session
          </Button>
          <Button
            variant="ghost" size="sm"
            className="h-7 text-xs"
            onClick={() => playback.degradeToText('user_chose_text_conflict')}
          >
            Continue in text
          </Button>
        </div>
      )}

      {/* Playback Controls */}
      {playback.controllerState && status !== 'complete' && status !== 'ownership_conflict' && status !== 'autoplay_blocked' && (
        <div className="flex items-center gap-2">
          {playback.isPlaying && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => playback.interrupt()}>
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          )}

          {!playback.isPlaying && playback.controllerState.dojo.playback.interruptedChunkId && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={playback.resume}>
              <Play className="h-3.5 w-3.5" />
              Resume
            </Button>
          )}

          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { setStatus('replaying'); playback.replay(); }}>
            <RotateCcw className="h-3.5 w-3.5" />
            Replay
          </Button>

          {playback.isPlaying && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={playback.skip}>
              <SkipForward className="h-3.5 w-3.5" />
              Skip
            </Button>
          )}

          {playback.deliveryMode === 'text_fallback' && (
            <Button
              variant="ghost" size="sm"
              className="h-8 gap-1.5 text-xs text-primary"
              onClick={() => playback.restoreVoice('user_requested')}
            >
              <Volume2 className="h-3.5 w-3.5" />
              Try Voice
            </Button>
          )}

          {/* Progress */}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {Math.min(
              playback.controllerState.dojo.currentChunkIndex,
              playback.controllerState.dojo.chunks.length
            )}/{playback.controllerState.dojo.chunks.length}
          </span>
        </div>
      )}

      {/* Text Transcript */}
      {textChunks.length > 0 && (playback.deliveryMode === 'text_fallback' || status === 'ownership_conflict' || status === 'autoplay_blocked') && (
        <div className="space-y-2">
          {textChunks.map((chunk) => (
            <div
              key={chunk.id}
              className={cn(
                'text-sm leading-relaxed pl-3 border-l-2',
                chunk.role === 'feedback' && 'border-primary/40',
                chunk.role === 'improvedVersion' && 'border-green-500/40',
                chunk.role === 'worldClassResponse' && 'border-amber-500/40',
                chunk.role === 'practiceCue' && 'border-blue-500/40',
              )}
            >
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                {chunk.label}
              </p>
              <p className="text-foreground">{chunk.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Debug Panel (Ctrl+Shift+A) */}
      <Suspense fallback={null}>
        <DojoAudioDebugPanel
          controllerState={playback.controllerState}
          lastDirective={playback.lastDirective}
          metrics={playback.metrics}
          wasRecovered={playback.wasRecovered}
          restoreReason={playback.restoreReason}
          ownershipConflict={playback.ownershipConflict}
          onSimulateInterrupt={playback.interrupt}
          onForceTextFallback={() => playback.degradeToText('debug_forced')}
          onRestoreVoice={() => playback.restoreVoice('debug_restore')}
          onReplayLast={playback.replay}
          onClearSnapshot={() => {}}
        />
      </Suspense>
    </div>
  );
}

/**
 * DaveCoachingDelivery — renders Dave's coaching audio/text delivery
 * inside the Sales Dojo feedback view.
 *
 * Responsibilities:
 * - Initialize the audio stack when a score result arrives
 * - Render currently-speaking chunk with visual indicator
 * - Show text fallback inline when voice degrades
 * - Provide replay / skip / interrupt controls
 * - Surface reliability status (speaking, degraded, recovered)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Volume2, VolumeX, SkipForward, RotateCcw,
  Pause, Play, AlertTriangle, RefreshCw, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { summarizeSession } from '@/lib/dojo/dojoAudioAnalytics';
import type { DojoScoreResult } from '@/lib/dojo/types';
import type { SpeechChunk } from '@/lib/dojo/conversationEngine';
import { createSession, loadResult } from '@/lib/dojo/conversationEngine';
import { withPlayback, type PlaybackState } from '@/lib/dojo/playbackAdapter';
import { useDojoPlayback, type DojoPlaybackControls } from '@/lib/dojo/useDojoPlayback';
import type { TransportConfig } from '@/lib/dojo/elevenlabsTransport';
import type { ControllerDirective } from '@/lib/dojo/dojoAudioController';

// ── Props ──────────────────────────────────────────────────────────

interface DaveCoachingDeliveryProps {
  /** The score result to deliver as coaching. */
  scoreResult: DojoScoreResult;
  /** Unique session ID for this Dojo session. */
  sessionId: string;
  /** Whether voice mode should be attempted. Default: true. */
  enableVoice?: boolean;
  /** Called when delivery completes all chunks. */
  onDeliveryComplete?: () => void;
}

// ── Status display ─────────────────────────────────────────────────

type DeliveryStatus =
  | 'idle'
  | 'speaking'
  | 'voice_degraded'
  | 'replaying'
  | 'skipped'
  | 'recovered'
  | 'complete';

function getStatusFromDirective(
  directive: ControllerDirective | null,
  isPlaying: boolean,
  deliveryMode: 'voice' | 'text_fallback'
): DeliveryStatus {
  if (!directive) return 'idle';

  if (directive.kind === 'delivery_complete') return 'complete';
  if (directive.kind === 'mode_changed' && directive.mode === 'text_fallback') return 'voice_degraded';

  if (deliveryMode === 'text_fallback') return 'voice_degraded';
  if (isPlaying) return 'speaking';

  return 'idle';
}

const STATUS_CONFIG: Record<DeliveryStatus, { label: string; Icon: LucideIcon; className: string } | null> = {
  idle: null,
  speaking: { label: 'Dave is speaking', Icon: Volume2, className: 'text-primary' },
  voice_degraded: { label: 'Continuing in text', Icon: VolumeX, className: 'text-amber-500' },
  replaying: { label: 'Replaying last chunk', Icon: RotateCcw, className: 'text-blue-500' },
  skipped: { label: 'Skipped', Icon: SkipForward, className: 'text-muted-foreground' },
  recovered: { label: 'Session recovered', Icon: RefreshCw, className: 'text-green-500' },
  complete: null,
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

  const config: TransportConfig = {
    supabaseUrl,
    supabaseAnonKey,
  };

  const playback = useDojoPlayback(config);
  const [textChunks, setTextChunks] = useState<SpeechChunk[]>([]);
  const [status, setStatus] = useState<DeliveryStatus>('idle');
  const initializedRef = useRef(false);
  const deliveryCompleteRef = useRef(false);

  // Initialize and start delivery when score result arrives
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    deliveryCompleteRef.current = false;

    const session = createSession(sessionId);
    const loaded = loadResult(session, scoreResult);
    const withPb = withPlayback(loaded);

    const mode = enableVoice ? 'voice' : 'text_fallback';
    playback.initialize(withPb, mode);

    // Start delivery on next tick so state is set
    setTimeout(() => playback.startDelivery(), 50);

    return () => {
      playback.destroy();
    };
  }, [sessionId, scoreResult, enableVoice]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to directives
  useEffect(() => {
    const d = playback.lastDirective;
    if (!d) return;

    const newStatus = getStatusFromDirective(d, playback.isPlaying, playback.deliveryMode);
    setStatus(newStatus);

    // Accumulate text chunks for display
    if (d.kind === 'show_text' || d.kind === 'chunk_skipped_max_retries') {
      const chunk = d.kind === 'show_text' ? d.chunk : d.chunk;
      setTextChunks((prev) => {
        if (prev.some((c) => c.id === chunk.id)) return prev;
        return [...prev, chunk];
      });
    }

    // Track completed speech chunks for text display too
    if (d.kind === 'speak' || d.kind === 'retry_speak') {
      // Will be shown when completed
    }

    if (d.kind === 'delivery_complete' && !deliveryCompleteRef.current) {
      deliveryCompleteRef.current = true;
      onDeliveryComplete?.();
    }
  }, [playback.lastDirective, playback.isPlaying, playback.deliveryMode, onDeliveryComplete]);

  // Track completed chunks for text transcript
  useEffect(() => {
    const ctrl = playback.controllerState;
    if (!ctrl) return;

    // Add all completed chunks to textChunks
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

  const statusConfig = STATUS_CONFIG[status];
  const currentChunk = playback.controllerState?.dojo.chunks.find(
    (c) => c.id === playback.controllerState?.dojo.playback.currentPlayingChunkId
  );

  return (
    <div className="space-y-3">
      {/* Status Banner */}
      {statusConfig && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg border',
          status === 'voice_degraded'
            ? 'bg-amber-500/5 border-amber-500/20'
            : status === 'speaking'
            ? 'bg-primary/5 border-primary/20'
            : 'bg-muted/30 border-border/40'
        )}>
          <statusConfig.Icon className={cn('h-4 w-4 shrink-0', statusConfig.className)} />
          <span className={cn('text-xs font-medium', statusConfig.className)}>
            {statusConfig.label}
          </span>
          {status === 'speaking' && currentChunk && (
            <span className="text-xs text-muted-foreground ml-auto">
              {currentChunk.label}
            </span>
          )}

          {/* Speaking pulse animation */}
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

      {/* Playback Controls (only during active delivery) */}
      {playback.controllerState && status !== 'complete' && (
        <div className="flex items-center gap-2">
          {playback.isPlaying && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={playback.interrupt}
            >
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          )}

          {!playback.isPlaying && playback.controllerState.dojo.playback.interruptedChunkId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={playback.resume}
            >
              <Play className="h-3.5 w-3.5" />
              Resume
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={playback.replay}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Replay
          </Button>

          {playback.isPlaying && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={playback.skip}
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip
            </Button>
          )}

          {playback.deliveryMode === 'text_fallback' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-primary"
              onClick={() => playback.restoreVoice('user_requested')}
            >
              <Volume2 className="h-3.5 w-3.5" />
              Try Voice
            </Button>
          )}

          {/* Delivery progress */}
          {playback.controllerState && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {Math.min(
                playback.controllerState.dojo.currentChunkIndex,
                playback.controllerState.dojo.chunks.length
              )}/{playback.controllerState.dojo.chunks.length}
            </span>
          )}
        </div>
      )}

      {/* Text Transcript (accumulated delivered chunks) */}
      {textChunks.length > 0 && playback.deliveryMode === 'text_fallback' && (
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
    </div>
  );
}

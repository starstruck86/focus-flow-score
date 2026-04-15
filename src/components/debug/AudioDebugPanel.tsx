/**
 * Audio Debug Panel — toggleable via ?debug=audio query param.
 * Shows real-time audio resilience state with full diagnostics.
 */

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Bug, X, ChevronDown, ChevronUp } from 'lucide-react';
import {
  getAudioDebugState,
  describeMode,
  type AudioDeliveryMode,
  type AudioTelemetryEntry,
} from '@/lib/daveAudioResilience';
import { getRecentLifecycles, type PlaybackLifecycleSummary } from '@/lib/playbackLifecycle';
import type { VoiceModeDiagnostics } from '@/hooks/useVoiceMode';

interface Props {
  mode: AudioDeliveryMode;
  failureCount: number;
  micStatus: string;
  lastAudioError?: string | null;
  lastMicError?: string | null;
  lastInterruptSource?: string | null;
  lastStaleSuppression?: string | null;
  downgradeReason?: string | null;
  dedupeBlocked?: number;
  voiceDiagnostics?: VoiceModeDiagnostics | null;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const EVENT_COLORS: Record<string, string> = {
  audio_started: 'text-green-500',
  audio_ended: 'text-green-500',
  audio_requested: 'text-blue-400',
  step_rendered: 'text-blue-400',
  audio_failed: 'text-destructive',
  audio_timeout: 'text-destructive',
  audio_stalled: 'text-orange-500',
  audio_interrupt: 'text-amber-400',
  retry_attempted: 'text-amber-400',
  mic_granted: 'text-green-500',
  mic_denied: 'text-destructive',
  mic_requested: 'text-blue-400',
  mode_downgraded: 'text-orange-500',
  fallback_activated: 'text-amber-400',
  audio_unlock: 'text-green-600',
  transcript_recorded: 'text-green-500',
  transcript_dedupe_blocked: 'text-amber-400',
};

const OUTCOME_COLORS: Record<string, string> = {
  success: 'text-green-500',
  interrupted: 'text-amber-400',
  failed: 'text-destructive',
  suppressed: 'text-muted-foreground',
  pending: 'text-blue-400',
};

export function AudioDebugPanel({
  mode, failureCount, micStatus,
  lastAudioError, lastMicError,
  lastInterruptSource, lastStaleSuppression,
  downgradeReason, dedupeBlocked,
  voiceDiagnostics,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<ReturnType<typeof getAudioDebugState> | null>(null);
  const [lifecycles, setLifecycles] = useState<PlaybackLifecycleSummary[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'audio') setVisible(true);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const refresh = () => {
      setState(getAudioDebugState(mode, failureCount, micStatus));
      setLifecycles(getRecentLifecycles(3));
    };
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [visible, mode, failureCount, micStatus]);

  if (!visible || !state) return null;

  const modeInfo = describeMode(mode);
  const diag = voiceDiagnostics;

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-80 bg-background/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl text-xs font-mono flex flex-col max-h-[80vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-2.5 pb-1.5 sticky top-0 bg-background/95 backdrop-blur-xl">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <Bug className="w-3 h-3" />
          Audio Debug
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button onClick={() => setVisible(false)} className="text-muted-foreground hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Core state */}
      <div className="px-2.5 space-y-0.5 text-muted-foreground">
        <Row label="Mode" value={`${modeInfo.icon} ${modeInfo.label}`} />
        <Row label="Audio unlocked" value={state.audioUnlocked ? '✓ yes' : '✗ no'} highlight={!state.audioUnlocked} />
        <Row label="Playback ID" value={state.activePlaybackId?.slice(-12) ?? '—'} />
        <Row label="Failures" value={String(state.failureCount)} highlight={state.failureCount > 0} />
        <Row label="Mic" value={state.micStatus} />
        {dedupeBlocked != null && dedupeBlocked > 0 && (
          <Row label="Dedupe blocked" value={String(dedupeBlocked)} />
        )}
      </div>

      {/* Errors & context */}
      {(lastAudioError || lastMicError || lastInterruptSource || lastStaleSuppression || downgradeReason) && (
        <div className="mx-2.5 mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
          {lastAudioError && <Row label="Audio err" value={lastAudioError} highlight />}
          {lastMicError && <Row label="Mic err" value={lastMicError} highlight />}
          {lastInterruptSource && <Row label="Last interrupt" value={lastInterruptSource} />}
          {lastStaleSuppression && <Row label="Last stale" value={lastStaleSuppression} />}
          {downgradeReason && <Row label="Downgrade" value={downgradeReason} highlight />}
        </div>
      )}

      {/* Voice diagnostics */}
      {diag && (
        <div className="mx-2.5 mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
          <div className="text-[9px] text-muted-foreground/50 mb-0.5">Voice Engine</div>
          <Row label="TTS aborts" value={String(diag.activeTtsAbortControllers)} highlight={diag.activeTtsAbortControllers > 0} />
          <Row label="STT aborts" value={String(diag.activeSttAbortControllers)} highlight={diag.activeSttAbortControllers > 0} />
          <Row label="Object URLs" value={String(diag.activeObjectUrls)} highlight={diag.activeObjectUrls > 0} />
          <Row label="Audio element" value={diag.isPlaying ? '▶ playing' : '—'} />
          <Row label="Mounted" value={diag.mounted ? '✓' : '✗ unmounted'} highlight={!diag.mounted} />
        </div>
      )}

      {/* Lifecycle summaries */}
      {expanded && lifecycles.length > 0 && (
        <div className="mx-2.5 mt-1.5 pt-1.5 border-t border-border/50">
          <div className="text-[9px] text-muted-foreground/50 mb-0.5">Recent Lifecycles</div>
          {lifecycles.map((lc) => (
            <div key={lc.playbackId} className="mb-1.5 p-1.5 bg-muted/30 rounded">
              <div className="flex justify-between">
                <span className="text-muted-foreground/60">{lc.playbackId.slice(-10)}</span>
                <span className={cn('font-medium', OUTCOME_COLORS[lc.outcome] || 'text-muted-foreground')}>
                  {lc.outcome}
                </span>
              </div>
              <div className="text-[9px] text-muted-foreground/40">
                {lc.stepId} · {lc.durationMs != null ? `${lc.durationMs}ms` : '...'}
              </div>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {lc.events.map((e, i) => (
                  <span key={i} className="text-[8px] text-muted-foreground/50">{e.event}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent events */}
      {state.recentEvents.length > 0 && (
        <div className="mt-1.5 mx-2.5 pt-1.5 border-t border-border/50">
          <div className="text-[9px] text-muted-foreground/50 mb-0.5">Recent Events</div>
          <div className="space-y-px max-h-28 overflow-y-auto">
            {state.recentEvents.slice().reverse().map((ev, i) => (
              <div key={`${ev.ts}-${i}`} className="flex gap-1 text-[10px] leading-tight">
                <span className="text-muted-foreground/40 shrink-0">{formatTime(ev.ts)}</span>
                <span className={cn('shrink-0', EVENT_COLORS[ev.event] || 'text-muted-foreground')}>
                  {ev.event}
                </span>
                <span className="text-muted-foreground/40 truncate">{ev.stepId}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-2 pt-1.5 text-[9px] text-muted-foreground/40">
        ?debug=audio · expand ▼ for lifecycles
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', highlight && 'text-destructive')}>
      <span className="text-muted-foreground/60 shrink-0">{label}</span>
      <span className="truncate text-right max-w-[180px]">{value}</span>
    </div>
  );
}

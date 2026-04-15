/**
 * Audio Debug Panel — toggleable via ?debug=audio query param.
 * Shows real-time audio resilience state for development.
 */

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Bug, X } from 'lucide-react';
import {
  getAudioDebugState,
  describeMode,
  type AudioDeliveryMode,
  type AudioTelemetryEntry,
} from '@/lib/daveAudioResilience';

interface Props {
  mode: AudioDeliveryMode;
  failureCount: number;
  micStatus: string;
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
  mode_downgraded: 'text-orange-500',
  fallback_activated: 'text-amber-400',
  audio_unlock: 'text-green-600',
};

export function AudioDebugPanel({ mode, failureCount, micStatus }: Props) {
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<ReturnType<typeof getAudioDebugState> | null>(null);

  // Show only when ?debug=audio is in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'audio') {
      setVisible(true);
    }
  }, []);

  // Refresh state every second when visible
  useEffect(() => {
    if (!visible) return;
    const refresh = () => setState(getAudioDebugState(mode, failureCount, micStatus));
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [visible, mode, failureCount, micStatus]);

  if (!visible || !state) return null;

  const modeInfo = describeMode(mode);

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-72 bg-background/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl text-xs font-mono flex flex-col">
      <div className="flex items-center justify-between p-2.5 pb-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <Bug className="w-3 h-3" />
          Audio Debug
        </div>
        <button onClick={() => setVisible(false)} className="text-muted-foreground hover:text-foreground">
          <X className="w-3 h-3" />
        </button>
      </div>

      <div className="px-2.5 space-y-0.5 text-muted-foreground">
        <Row label="Mode" value={`${modeInfo.icon} ${modeInfo.label}`} />
        <Row label="Audio unlocked" value={state.audioUnlocked ? '✓' : '✗'} highlight={!state.audioUnlocked} />
        <Row label="Playback ID" value={state.activePlaybackId?.slice(-12) ?? '—'} />
        <Row label="Failures" value={String(state.failureCount)} highlight={state.failureCount > 0} />
        <Row label="Mic" value={state.micStatus} />
      </div>

      {state.recentEvents.length > 0 && (
        <div className="mt-1.5 mx-2.5 pt-1.5 border-t border-border/50">
          <div className="text-[9px] text-muted-foreground/50 mb-0.5">Recent Events</div>
          <div className="space-y-px">
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
        ?debug=audio
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', highlight && 'text-destructive')}>
      <span className="text-muted-foreground/60 shrink-0">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}

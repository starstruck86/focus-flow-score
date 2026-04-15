/**
 * Audio Stress Harness — dev-only tool for QA stress testing.
 * Visible only when ?debug=audio is in the URL.
 * Triggers synthetic failure modes to verify resilience.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Zap, X } from 'lucide-react';
import {
  nextPlaybackId,
  clearActivePlayback,
  emitStepTelemetry,
  evaluateModeDowngrade,
  type AudioDeliveryMode,
} from '@/lib/daveAudioResilience';

interface Props {
  onForceInterrupt?: () => void;
  onForceDowngrade?: (mode: AudioDeliveryMode) => void;
  onForceFailure?: () => void;
  currentMode: AudioDeliveryMode;
  failureCount: number;
}

export function AudioStressHarness({
  onForceInterrupt,
  onForceDowngrade,
  onForceFailure,
  currentMode,
  failureCount,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [rapidCount, setRapidCount] = useState(0);

  // Only show in debug mode
  const isDebug = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === 'audio';
  if (!isDebug) return null;

  const actions = [
    {
      label: 'Force Interrupt',
      desc: 'Simulate clip interrupted by new playback',
      action: () => {
        emitStepTelemetry('audio_interrupt', 'stress-test', { source: 'stress-harness' });
        onForceInterrupt?.();
      },
      color: 'text-amber-400',
    },
    {
      label: 'Force Stall',
      desc: 'Emit stalled telemetry',
      action: () => {
        emitStepTelemetry('audio_stalled', 'stress-test', { synthetic: true });
      },
      color: 'text-orange-500',
    },
    {
      label: 'Force Timeout',
      desc: 'Emit timeout telemetry',
      action: () => {
        emitStepTelemetry('audio_timeout', 'stress-test', { synthetic: true });
      },
      color: 'text-orange-500',
    },
    {
      label: 'Force TTS Failure',
      desc: 'Trigger failure + increment count',
      action: () => {
        emitStepTelemetry('audio_failed', 'stress-test', { synthetic: true, error: 'Forced TTS failure' });
        onForceFailure?.();
      },
      color: 'text-destructive',
    },
    {
      label: 'Force Downgrade',
      desc: `Evaluate downgrade from ${currentMode}`,
      action: () => {
        const newMode = evaluateModeDowngrade(currentMode, Math.max(failureCount, 3));
        onForceDowngrade?.(newMode);
      },
      color: 'text-destructive',
    },
    {
      label: `Rapid Token (${rapidCount})`,
      desc: 'Mint 5 tokens fast to test stale guard',
      action: () => {
        for (let i = 0; i < 5; i++) {
          nextPlaybackId();
        }
        setRapidCount(prev => prev + 5);
      },
      color: 'text-blue-400',
    },
    {
      label: 'Clear Token',
      desc: 'Clear active playback token',
      action: () => {
        clearActivePlayback();
      },
      color: 'text-muted-foreground',
    },
  ];

  return (
    <div className="fixed bottom-4 left-4 z-[100]">
      {!visible ? (
        <button
          onClick={() => setVisible(true)}
          className="bg-background/90 border border-border rounded-lg p-2 shadow-lg hover:border-amber-500 transition-colors"
          title="Audio Stress Harness"
        >
          <Zap className="w-4 h-4 text-amber-400" />
        </button>
      ) : (
        <div className="bg-background/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl w-64 text-xs font-mono">
          <div className="flex items-center justify-between p-2.5 pb-1.5 border-b border-border/50">
            <div className="flex items-center gap-1.5 font-semibold text-amber-400">
              <Zap className="w-3 h-3" />
              Stress Harness
            </div>
            <button onClick={() => setVisible(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="p-2 space-y-1">
            {actions.map((a) => (
              <button
                key={a.label}
                onClick={a.action}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-muted/50 transition-colors"
              >
                <span className={cn('block text-[11px] font-medium', a.color)}>{a.label}</span>
                <span className="block text-[9px] text-muted-foreground/60">{a.desc}</span>
              </button>
            ))}
          </div>
          <div className="p-2 pt-0 text-[9px] text-muted-foreground/40">
            Dev only · ?debug=audio
          </div>
        </div>
      )}
    </div>
  );
}

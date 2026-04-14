/**
 * Voice Debug Tab — Displays real-time voice cost & perf metrics
 * inside the Dave Debug Panel. All reads are synchronous snapshots;
 * nothing here blocks playback or transcription.
 */

import { useState, useEffect } from 'react';
import { captureDebugSnapshot, formatDebugSnapshot, type VoiceDebugSnapshot } from '@/lib/voice/voiceDebugMetrics';
import { getUsageSummary } from '@/lib/voice/voiceUsageTracker';
import { cn } from '@/lib/utils';

interface Props {
  visible: boolean;
}

export function VoiceDebugTab({ visible }: Props) {
  const [snapshot, setSnapshot] = useState<VoiceDebugSnapshot | null>(null);

  useEffect(() => {
    if (!visible) return;
    // Capture immediately
    setSnapshot(captureDebugSnapshot());
    // Refresh every 3s while visible
    const t = setInterval(() => setSnapshot(captureDebugSnapshot()), 3000);
    return () => clearInterval(t);
  }, [visible]);

  if (!visible || !snapshot) return null;

  const formatted = formatDebugSnapshot(snapshot);
  const usage = getUsageSummary();

  return (
    <div className="space-y-1 text-muted-foreground">
      <div className="text-[10px] text-muted-foreground/50 font-semibold mb-1">Voice Cost & Perf</div>

      {Object.entries(formatted).map(([label, value]) => (
        <Row key={label} label={label} value={String(value)} />
      ))}

      {/* Top repeated utterances */}
      {usage && usage.topRepeatedUtterances.length > 0 && (
        <div className="mt-2 pt-1 border-t border-border/30">
          <div className="text-[10px] text-muted-foreground/50 mb-0.5">Top Repeated (waste signal)</div>
          {usage.topRepeatedUtterances.slice(0, 3).map((u, i) => (
            <div key={i} className="text-[10px] flex justify-between gap-1">
              <span className="truncate text-muted-foreground/60">{u.text}</span>
              <span className="shrink-0 text-amber-500">×{u.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Known Limitations */}
      <div className="mt-2 pt-1 border-t border-border/30">
        <div className="text-[10px] text-muted-foreground/40">
          ⚠ Credits are heuristic estimates, not billing-authoritative.
          Abort-on-cache-win is a latency optimization, not a guaranteed cost save.
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const isWarning = label.includes('Blocked') || label.includes('Failed') || label.includes('Retries');
  const hasValue = value !== '0' && value !== '—';
  return (
    <div className={cn('flex justify-between gap-2 text-[11px]', isWarning && hasValue && 'text-amber-500')}>
      <span className="text-muted-foreground/60 shrink-0">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}

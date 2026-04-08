/**
 * Lightweight debug panel for Dave connection internals.
 * Accessible via Ctrl+Shift+D (or Cmd+Shift+D on Mac).
 * Not visible by default.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bug, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DaveConnectionMeta } from '@/lib/daveConnectionManager';

interface Props {
  meta: DaveConnectionMeta;
  extraInfo?: Record<string, string | number | boolean | null>;
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return '—';
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  return `${Math.round(diff / 60)}m ago`;
}

export function DaveDebugPanel({ meta, extraInfo }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setVisible(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="fixed bottom-4 left-4 z-[100] w-72 bg-background/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl p-3 text-xs font-mono"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <Bug className="w-3.5 h-3.5" />
              Dave Debug
            </div>
            <button onClick={() => setVisible(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1 text-muted-foreground">
            <Row label="State" value={meta.state} highlight={meta.state === 'failed' || meta.state === 'offline'} />
            <Row label="Session" value={meta.sessionId ? meta.sessionId.substring(0, 12) + '…' : '—'} />
            <Row label="Connected" value={formatTimestamp(meta.lastConnectedAt)} />
            <Row label="Disconnected" value={formatTimestamp(meta.lastDisconnectedAt)} />
            <Row label="Heartbeat" value={
              meta.heartbeatLatencyMs !== null
                ? `${meta.heartbeatLatencyMs}ms (${formatTimestamp(meta.lastHeartbeatAt)})`
                : formatTimestamp(meta.lastHeartbeatAt)
            } />
            <Row label="Reconnects" value={String(meta.reconnectAttemptCount)} highlight={meta.reconnectAttemptCount > 2} />
            <Row label="Reconnect timer" value={meta.reconnectTimerActive ? 'active' : 'off'} />
            <Row label="Last error" value={meta.lastError || '—'} highlight={!!meta.lastError} />

            {extraInfo && Object.entries(extraInfo).map(([k, v]) => (
              <Row key={k} label={k} value={String(v ?? '—')} />
            ))}
          </div>

          <div className="mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground/50">
            Ctrl+Shift+D to toggle
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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

/**
 * Lightweight debug panel for Dave connection internals.
 * Accessible via Ctrl+Shift+D (or Cmd+Shift+D on Mac).
 * Now includes event history for runtime debugging.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bug, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DaveConnectionMeta } from '@/lib/daveConnectionManager';
import type { DaveEventRecord } from '@/hooks/useDaveConnectionManager';

interface Props {
  meta: DaveConnectionMeta;
  eventHistory?: DaveEventRecord[];
  extraInfo?: Record<string, string | number | boolean | null>;
  onDumpSummary?: (opts?: { copy?: boolean; download?: boolean }) => void;
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return '—';
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  return `${Math.round(diff / 60)}m ago`;
}

function formatEventTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const EVENT_COLORS: Record<string, string> = {
  CONNECT_SUCCESS: 'text-green-500',
  RECONNECT_SUCCESS: 'text-green-500',
  HEARTBEAT_OK: 'text-green-600/60',
  CONNECT_START: 'text-blue-400',
  RECONNECT_START: 'text-blue-400',
  RECONNECT_SCHEDULED: 'text-amber-400',
  CONNECT_FAILURE: 'text-destructive',
  RECONNECT_FAILURE: 'text-destructive',
  RECONNECT_EXHAUSTED: 'text-destructive',
  HEARTBEAT_FAIL: 'text-orange-500',
  DISCONNECT: 'text-amber-500',
  RESET: 'text-muted-foreground/50',
};

export function DaveDebugPanel({ meta, eventHistory = [], extraInfo, onDumpSummary }: Props) {
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(Date.now());

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

  // Refresh relative timestamps every 5s when visible
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="fixed bottom-4 left-4 z-[100] w-80 max-h-[70vh] bg-background/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl text-xs font-mono flex flex-col"
        >
          <div className="flex items-center justify-between p-3 pb-2">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <Bug className="w-3.5 h-3.5" />
              Dave Debug
            </div>
            <button onClick={() => setVisible(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="px-3 space-y-1 text-muted-foreground">
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

          {/* Event History */}
          {eventHistory.length > 0 && (
            <div className="mt-2 mx-3 pt-2 border-t border-border/50">
              <div className="text-[10px] text-muted-foreground/50 mb-1">Event History (last {eventHistory.length})</div>
              <div className="max-h-32 overflow-y-auto space-y-px">
                {eventHistory.slice().reverse().map((ev, i) => (
                  <div key={`${ev.ts}-${i}`} className="flex gap-1.5 text-[10px] leading-tight">
                    <span className="text-muted-foreground/40 shrink-0">{formatEventTime(ev.ts)}</span>
                    <span className={cn('shrink-0', EVENT_COLORS[ev.type] || 'text-muted-foreground')}>
                      {ev.type}
                    </span>
                    {ev.detail && (
                      <span className="text-muted-foreground/50 truncate" title={ev.detail}>
                        {ev.detail}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-2 p-3 pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground/50">
            <span>Ctrl+Shift+D to toggle</span>
            {onDumpSummary && (
              <div className="flex gap-1">
                <button
                  onClick={() => onDumpSummary()}
                  className="px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground text-[10px] font-semibold"
                >
                  Dump
                </button>
                <button
                  onClick={() => onDumpSummary({ copy: true })}
                  className="px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground text-[10px] font-semibold"
                >
                  Copy
                </button>
                <button
                  onClick={() => onDumpSummary({ download: true })}
                  className="px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground text-[10px] font-semibold"
                >
                  Save
                </button>
              </div>
            )}
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

import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, CheckCircle2, XCircle, AlertTriangle, Wifi, Shield, Timer } from 'lucide-react';

export interface DiagnosticData {
  connectionStatus: string;
  uptimeMs: number;
  contextSize: number;
  contextPreview: string;
  firstMessagePreview: string;
  firstMessageSet: boolean;
  hasInstructions: boolean;
  messagesReceived: number;
  lastMessageType: string | null;
  lastMessageAt: number | null;
  vadScore: number;
  errorHistory: string[];
  healthCheck: { apiKey: boolean; agentId: boolean; tokenOk: boolean; overridesEnabled?: boolean | null } | null;
  greetingStatus: 'waiting' | 'received' | 'timeout' | 'retrying';
  cooldownRemaining?: number;
}

interface Props {
  visible: boolean;
  data: DiagnosticData;
}

function StatusDot({ ok }: { ok: boolean | null | undefined }) {
  if (ok === null || ok === undefined) return <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse" />;
  return ok
    ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
    : <XCircle className="w-3 h-3 text-red-400" />;
}

export function DaveDiagnosticsPanel({ visible, data }: Props) {
  const upSec = Math.round(data.uptimeMs / 1000);

  const failureLabel = data.connectionStatus !== 'connected'
    ? 'disconnected'
    : data.greetingStatus === 'timeout'
    ? 'connected_no_greeting'
    : data.greetingStatus === 'retrying'
    ? 'retrying_fresh_mount'
    : data.messagesReceived === 0 && upSec > 5
    ? 'connected_no_messages'
    : null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="absolute top-16 left-4 right-4 z-20 bg-black/80 backdrop-blur border border-white/10 rounded-xl p-3 text-xs font-mono text-white/70 space-y-1.5 max-h-[50vh] overflow-y-auto"
        >
          <div className="flex items-center gap-2 text-white/90 font-semibold mb-1">
            <Activity className="w-3.5 h-3.5" />
            Dave Diagnostics
          </div>

          {/* Cooldown Warning */}
          {(data.cooldownRemaining ?? 0) > 0 && (
            <div className="border border-amber-500/30 bg-amber-500/10 rounded-lg p-2 flex items-center gap-2">
              <Timer className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-amber-400 font-semibold">
                Concurrency cooldown: {data.cooldownRemaining}s remaining
              </span>
            </div>
          )}

          {/* Identity / Contract Section */}
          <div className="border border-white/10 rounded-lg p-2 space-y-1">
            <div className="flex items-center gap-1.5 text-white/50 uppercase tracking-wider text-[10px]">
              <Shield className="w-3 h-3" />
              Identity Contract
            </div>
            <div className="flex items-center gap-1.5">
              <StatusDot ok={data.hasInstructions} />
              <span className={data.hasInstructions ? 'text-emerald-400' : 'text-red-400'}>
                DAVE instructions {data.hasInstructions ? 'present' : 'MISSING'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusDot ok={data.firstMessageSet} />
              <span>FirstMessage: {data.firstMessageSet ? '✅ set' : '❌ missing'}</span>
            </div>
            <Row label="Context" value={`${data.contextSize.toLocaleString()} chars`} highlight={data.contextSize < 500} />
          </div>

          {/* Context Preview */}
          {data.contextPreview && (
            <div className="border border-white/10 rounded-lg p-2">
              <div className="text-white/50 text-[10px] uppercase tracking-wider mb-1">Context Preview</div>
              <div className="text-white/60 text-[10px] leading-relaxed break-words">
                {data.contextPreview}…
              </div>
            </div>
          )}

          {/* FirstMessage Preview */}
          {data.firstMessagePreview && (
            <div className="border border-white/10 rounded-lg p-2">
              <div className="text-white/50 text-[10px] uppercase tracking-wider mb-1">First Message</div>
              <div className="text-emerald-400/80 text-[10px] leading-relaxed break-words">
                "{data.firstMessagePreview}"
              </div>
            </div>
          )}

          {/* Connection State */}
          <Row label="Status" value={data.connectionStatus} />
          <Row label="Uptime" value={upSec > 0 ? `${upSec}s` : '—'} />
          <Row label="Messages Rx" value={String(data.messagesReceived)} highlight={data.messagesReceived === 0 && upSec > 5} />
          <Row label="Last Msg" value={data.lastMessageType ? `${data.lastMessageType} (${Math.round((Date.now() - (data.lastMessageAt || 0)) / 1000)}s ago)` : '—'} />
          <Row label="VAD" value={data.vadScore.toFixed(2)} />

          {/* Failure Label */}
          {failureLabel && (
            <div className="flex items-center gap-1.5 text-amber-400 font-semibold pt-1">
              <AlertTriangle className="w-3 h-3" />
              Stage: {failureLabel}
            </div>
          )}

          {data.greetingStatus === 'timeout' && (
            <div className="flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              No greeting received — check ElevenLabs agent overrides
            </div>
          )}
          {data.greetingStatus === 'retrying' && (
            <div className="flex items-center gap-1.5 text-amber-300 animate-pulse">
              <Wifi className="w-3 h-3" />
              Retrying via fresh remount...
            </div>
          )}

          {data.healthCheck && (
            <div className="border-t border-white/10 pt-1.5 mt-1.5 space-y-1">
              <div className="text-white/50 uppercase tracking-wider text-[10px]">Health Check</div>
              <div className="flex items-center gap-1.5"><StatusDot ok={data.healthCheck.apiKey} /> API Key</div>
              <div className="flex items-center gap-1.5"><StatusDot ok={data.healthCheck.agentId} /> Agent ID</div>
              <div className="flex items-center gap-1.5"><StatusDot ok={data.healthCheck.tokenOk} /> Token Gen</div>
              {data.healthCheck.overridesEnabled !== undefined && (
                <div className="flex items-center gap-1.5">
                  <StatusDot ok={data.healthCheck.overridesEnabled} />
                  <span className={data.healthCheck.overridesEnabled === false ? 'text-red-400' : ''}>
                    Overrides {data.healthCheck.overridesEnabled ? 'enabled' : data.healthCheck.overridesEnabled === false ? 'DISABLED — Dave will ignore identity' : 'checking...'}
                  </span>
                </div>
              )}
            </div>
          )}

          {data.errorHistory.length > 0 && (
            <div className="border-t border-white/10 pt-1.5 mt-1.5">
              <div className="text-red-400/80 text-[10px] uppercase tracking-wider mb-1">Errors</div>
              {data.errorHistory.slice(-3).map((e, i) => (
                <div key={i} className="text-red-300/70 truncate">{e}</div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn('flex justify-between', highlight && 'text-amber-400')}>
      <span className="text-white/40">{label}</span>
      <span>{value}</span>
    </div>
  );
}

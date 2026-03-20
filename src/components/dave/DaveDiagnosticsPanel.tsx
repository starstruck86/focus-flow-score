import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, CheckCircle2, XCircle, AlertTriangle, Wifi } from 'lucide-react';

export interface DiagnosticData {
  connectionStatus: string;
  uptimeMs: number;
  contextSize: number;
  firstMessageSet: boolean;
  messagesReceived: number;
  lastMessageType: string | null;
  lastMessageAt: number | null;
  vadScore: number;
  errorHistory: string[];
  healthCheck: { apiKey: boolean; agentId: boolean; tokenOk: boolean } | null;
  greetingStatus: 'waiting' | 'received' | 'timeout' | 'retrying';
}

interface Props {
  visible: boolean;
  data: DiagnosticData;
}

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse" />;
  return ok
    ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
    : <XCircle className="w-3 h-3 text-red-400" />;
}

export function DaveDiagnosticsPanel({ visible, data }: Props) {
  const upSec = Math.round(data.uptimeMs / 1000);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="absolute top-16 left-4 right-4 z-20 bg-black/80 backdrop-blur border border-white/10 rounded-xl p-3 text-xs font-mono text-white/70 space-y-1.5 max-h-[40vh] overflow-y-auto"
        >
          <div className="flex items-center gap-2 text-white/90 font-semibold mb-1">
            <Activity className="w-3.5 h-3.5" />
            Dave Diagnostics
          </div>

          <Row label="Status" value={data.connectionStatus} />
          <Row label="Uptime" value={upSec > 0 ? `${upSec}s` : '—'} />
          <Row label="Context" value={`${data.contextSize.toLocaleString()} chars`} />
          <Row label="FirstMessage" value={data.firstMessageSet ? '✅ set' : '❌ missing'} />
          <Row label="Messages Rx" value={String(data.messagesReceived)} highlight={data.messagesReceived === 0 && upSec > 5} />
          <Row label="Last Msg" value={data.lastMessageType ? `${data.lastMessageType} (${Math.round((Date.now() - (data.lastMessageAt || 0)) / 1000)}s ago)` : '—'} />
          <Row label="VAD" value={data.vadScore.toFixed(2)} />

          {data.greetingStatus === 'timeout' && (
            <div className="flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              No greeting received — check ElevenLabs agent overrides
            </div>
          )}
          {data.greetingStatus === 'retrying' && (
            <div className="flex items-center gap-1.5 text-amber-300 animate-pulse">
              <Wifi className="w-3 h-3" />
              Retrying with fresh token...
            </div>
          )}

          {data.healthCheck && (
            <div className="border-t border-white/10 pt-1.5 mt-1.5 space-y-1">
              <div className="text-white/50 uppercase tracking-wider text-[10px]">Health Check</div>
              <div className="flex items-center gap-1.5"><StatusDot ok={data.healthCheck.apiKey} /> API Key</div>
              <div className="flex items-center gap-1.5"><StatusDot ok={data.healthCheck.agentId} /> Agent ID</div>
              <div className="flex items-center gap-1.5"><StatusDot ok={data.healthCheck.tokenOk} /> Token Gen</div>
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

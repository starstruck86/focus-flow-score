/**
 * Non-blocking status banner showing Dave's connection state.
 * Only visible when Dave is NOT in a healthy connected state.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DaveConnectionState, DaveConnectionMeta } from '@/lib/daveConnectionManager';

interface Props {
  meta: DaveConnectionMeta;
  onRetry?: () => void;
  className?: string;
}

const STATE_CONFIG: Record<DaveConnectionState, {
  label: string;
  icon: React.ReactNode;
  color: string;
  showRetry: boolean;
  visible: boolean;
} | null> = {
  idle: null,
  connecting: {
    label: 'Connecting to Dave...',
    icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
    color: 'bg-muted/80 text-muted-foreground border-border/50',
    showRetry: false,
    visible: true,
  },
  connected: null,
  reconnecting: {
    label: 'Reconnecting to Dave...',
    icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
    color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    showRetry: false,
    visible: true,
  },
  degraded: {
    label: 'Dave connection unstable',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    showRetry: true,
    visible: true,
  },
  offline: {
    label: 'Dave is offline',
    icon: <WifiOff className="w-3.5 h-3.5" />,
    color: 'bg-destructive/10 text-destructive border-destructive/30',
    showRetry: true,
    visible: true,
  },
  failed: {
    label: 'Dave connection failed',
    icon: <WifiOff className="w-3.5 h-3.5" />,
    color: 'bg-destructive/10 text-destructive border-destructive/30',
    showRetry: true,
    visible: true,
  },
};

export function DaveConnectionBanner({ meta, onRetry, className }: Props) {
  const config = STATE_CONFIG[meta.state];

  return (
    <AnimatePresence>
      {config?.visible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 text-xs font-medium border rounded-lg',
            config.color,
            className,
          )}
        >
          {config.icon}
          <span className="flex-1">{config.label}</span>
          {meta.reconnectAttemptCount > 0 && meta.state === 'reconnecting' && (
            <span className="text-[10px] opacity-70">
              Attempt {meta.reconnectAttemptCount}
            </span>
          )}
          {meta.lastError && meta.state === 'failed' && (
            <span className="text-[10px] opacity-70 truncate max-w-[120px]" title={meta.lastError}>
              {meta.lastError}
            </span>
          )}
          {config.showRetry && onRetry && (
            <button
              onClick={onRetry}
              className="text-[10px] font-semibold underline hover:no-underline"
            >
              Retry
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

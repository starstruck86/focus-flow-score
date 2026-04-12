/**
 * RecoveryBanner — Lightweight, non-alarming UI signal during session recovery.
 * 
 * Shows calm status + Dave message when the session is in recovery mode.
 * Does NOT look like an error. Feels like a pause, not a crash.
 */

import { cn } from '@/lib/utils';
import { Loader2, WifiOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import type { RecoveryState } from '@/lib/sessionRecovery';
import { getRecoveryStatusLabel } from '@/lib/sessionRecovery';

interface RecoveryBannerProps {
  recovery: RecoveryState;
  onCancel?: () => void;
  onTextFallback?: () => void;
  className?: string;
}

export default function RecoveryBanner({
  recovery,
  onCancel,
  onTextFallback,
  className,
}: RecoveryBannerProps) {
  const isActive = recovery.status === 'recovering' || recovery.status === 'waiting_for_connection';
  const statusLabel = getRecoveryStatusLabel(recovery);

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className={cn(
            'rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 space-y-2',
            className,
          )}
        >
          {/* Status line */}
          <div className="flex items-center gap-2">
            {recovery.status === 'waiting_for_connection' ? (
              <WifiOff className="h-4 w-4 text-amber-500 flex-shrink-0" />
            ) : (
              <Loader2 className="h-4 w-4 text-amber-500 animate-spin flex-shrink-0" />
            )}
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {statusLabel}
            </span>
          </div>

          {/* Dave message */}
          {recovery.daveMessage && (
            <p className="text-xs text-foreground/80 italic pl-6">
              "{recovery.daveMessage}"
            </p>
          )}

          {/* Controls */}
          <div className="flex items-center gap-2 pl-6">
            {onTextFallback && (recovery.reason === 'tts_failure' || recovery.reason === 'stt_failure') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-muted-foreground"
                onClick={onTextFallback}
              >
                Switch to text
              </Button>
            )}
            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-muted-foreground gap-1"
                onClick={onCancel}
              >
                <X className="h-3 w-3" />
                Cancel
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

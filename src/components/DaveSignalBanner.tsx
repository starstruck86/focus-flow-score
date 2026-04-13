/**
 * DaveSignalBanner — Shows connectivity status during audio sessions.
 *
 * Minimal, non-intrusive banner for driving mode.
 * Shows Dave's signal loss/restored messages.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DaveSignalBannerProps {
  message: string | null;
  isOffline: boolean;
  pendingOpsCount: number;
}

export default function DaveSignalBanner({ message, isOffline, pendingOpsCount }: DaveSignalBannerProps) {
  if (!message && !isOffline) return null;

  return (
    <AnimatePresence>
      {(message || isOffline) && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium',
            isOffline
              ? 'bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400'
              : 'bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400',
          )}
        >
          {isOffline ? (
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Wifi className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{message}</span>
          {pendingOpsCount > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {pendingOpsCount} pending
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

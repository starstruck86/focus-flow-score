import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onTap: () => void;
  isLoading: boolean;
  isActive: boolean;
  isSpeaking?: boolean;
}

/**
 * Persistent floating mic button for instant Dave access.
 * Positioned above the bottom nav, right-aligned, thumb-friendly on mobile.
 */
export function DaveMicFAB({ onTap, isLoading, isActive, isSpeaking }: Props) {
  // Hide when Dave conversation is already open
  if (isActive) return null;

  return (
    <AnimatePresence>
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        whileTap={{ scale: 0.9 }}
        onClick={onTap}
        disabled={isLoading}
        aria-label="Talk to Dave"
        className={cn(
          'fixed z-50 flex items-center justify-center rounded-full shadow-lg transition-colors',
          // 56px = 14 tailwind units, well above 44px min tap target
          'h-14 w-14',
          // Position: above bottom nav (bottom nav is ~6.5rem with safe area), right side
          'right-4 bottom-[calc(7.5rem+env(safe-area-inset-bottom))]',
          isLoading
            ? 'bg-muted text-muted-foreground cursor-wait'
            : 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
        )}
        style={{
          boxShadow: isLoading
            ? undefined
            : '0 4px 24px -4px hsl(var(--primary) / 0.4), 0 0 0 1px hsl(var(--primary) / 0.1)',
        }}
      >
        {isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : (
          <Mic className="h-6 w-6" />
        )}

        {/* Subtle pulse ring when idle — draws attention without being annoying */}
        {!isLoading && (
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-primary/30"
            animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </motion.button>
    </AnimatePresence>
  );
}

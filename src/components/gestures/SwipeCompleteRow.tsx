/**
 * SwipeCompleteRow — swipe-right to complete a task (with subtle spring + fade).
 * Tap-through preserved: children get pointer events unless the drag exceeded
 * a small activation threshold. Uses framer-motion (already installed).
 */
import { useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { Check } from 'lucide-react';

interface Props {
  onComplete: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  threshold?: number; // px
}

export function SwipeCompleteRow({ onComplete, children, disabled, threshold = 90 }: Props) {
  const x = useMotionValue(0);
  const opacity = useTransform(x, [0, threshold, threshold + 40], [1, 1, 0]);
  const bgOpacity = useTransform(x, [0, threshold], [0, 1]);
  const [committing, setCommitting] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const active = useRef(false);

  const handleDragStart = (_e: any, info: any) => {
    startX.current = info.point.x;
    startY.current = info.point.y;
    active.current = true;
  };

  const handleDragEnd = (_e: any, info: any) => {
    if (!active.current || disabled) { active.current = false; return; }
    active.current = false;
    if (info.offset.x >= threshold) {
      setCommitting(true);
      animate(x, 400, { duration: 0.18, ease: 'easeOut' });
      // Commit shortly so optimistic UI matches feel.
      setTimeout(() => onComplete(), 120);
    } else {
      animate(x, 0, { type: 'spring', stiffness: 500, damping: 32 });
    }
  };

  return (
    <div className="relative">
      <motion.div
        className="absolute inset-0 rounded flex items-center justify-start pl-4 pointer-events-none"
        style={{ opacity: bgOpacity, background: 'hsl(var(--status-green) / 0.15)' }}
      >
        <Check className="h-4 w-4 text-status-green" />
      </motion.div>
      <motion.div
        drag={disabled || committing ? false : 'x'}
        dragConstraints={{ left: 0, right: 200 }}
        dragElastic={{ left: 0, right: 0.4 }}
        dragDirectionLock
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ x, opacity, touchAction: 'pan-y' }}
        className="relative bg-background"
      >
        {children}
      </motion.div>
    </div>
  );
}

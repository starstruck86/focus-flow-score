import { forwardRef, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Plus, X } from 'lucide-react';

interface RingConfig {
  key: 'dials' | 'connects' | 'emails';
  label: string;
  storeKey: string;
  storeSection: 'activity' | 'raw';
  defaultGoal: number;
  colorVar: string;
  glowVar: string;
}

const RINGS: RingConfig[] = [
  {
    key: 'dials',
    label: 'Dials',
    storeKey: 'dials',
    storeSection: 'activity',
    defaultGoal: 60,
    colorVar: '--strain',
    glowVar: '--strain-glow',
  },
  {
    key: 'connects',
    label: 'Connects',
    storeKey: 'coldCallsWithConversations',
    storeSection: 'raw',
    defaultGoal: 6,
    colorVar: '--recovery',
    glowVar: '--recovery-glow',
  },
  {
    key: 'emails',
    label: 'Emails',
    storeKey: 'emailsTotal',
    storeSection: 'activity',
    defaultGoal: 30,
    colorVar: '--productivity',
    glowVar: '--productivity-glow',
  },
];

function MiniRing({
  value,
  goal,
  size = 56,
  strokeWidth = 5,
  colorVar,
  glowVar,
  label,
  onClick,
}: {
  value: number;
  goal: number;
  size?: number;
  strokeWidth?: number;
  colorVar: string;
  glowVar: string;
  label: string;
  onClick: () => void;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = Math.min(value / Math.max(goal, 1), 1);
  const strokeDashoffset = circumference * (1 - percentage);
  const color = `hsl(var(${colorVar}))`;
  const glow = `hsl(var(${glowVar}))`;

  return (
    <button
      type="button"
      data-ring-trigger
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 transition-transform hover:scale-105 active:scale-95"
    >
      <div className="relative">
        <svg width={size} height={size} className="-rotate-90 transform">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/30"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{
              filter: percentage >= 1 ? `drop-shadow(0 0 4px ${glow})` : undefined,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-display font-bold" style={{ color }}>
            {value}
          </span>
        </div>
      </div>
      <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </button>
  );
}

const EditPopover = forwardRef<HTMLDivElement, {
  ring: RingConfig;
  value: number;
  goal: number;
  onClose: () => void;
  onUpdate: (newValue: number) => void;
}>(({ ring, value, goal, onClose, onUpdate }, ref) => {
  const color = `hsl(var(${ring.colorVar}))`;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.9, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -4 }}
      className="absolute left-1/2 top-full z-50 mt-2 min-w-[160px] -translate-x-1/2 rounded-xl border border-border bg-card p-3 shadow-xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color }}>
          {ring.label}
        </span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onUpdate(Math.max(0, value - 1))}
        >
          <Minus className="h-4 w-4" />
        </Button>

        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={String(value)}
          onChange={(e) => {
            const digitsOnly = e.target.value.replace(/\D/g, '');
            onUpdate(digitsOnly === '' ? 0 : parseInt(digitsOnly, 10));
          }}
          className="h-9 w-14 text-center text-lg font-bold [appearance:textfield]"
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onUpdate(value + 1)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-1.5 text-center text-[10px] text-muted-foreground">
        Goal: {goal} / day
      </div>
    </motion.div>
  );
});

EditPopover.displayName = 'EditPopover';

export function ActivityRings() {
  const { currentDay, initializeToday, updateActivityInputs, updateRawInputs } = useStore();
  const [editing, setEditing] = useState<string | null>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!editing) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-ring-popover]') && !target.closest('[data-ring-trigger]')) {
        setEditing(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing]);

  const getValue = useCallback(
    (ring: RingConfig) => {
      if (ring.key === 'dials') return currentDay?.activityInputs.dials ?? 0;
      if (ring.key === 'connects') return currentDay?.rawInputs.coldCallsWithConversations ?? 0;
      return currentDay?.activityInputs.emailsTotal ?? 0;
    },
    [currentDay],
  );

  const handleUpdate = useCallback(
    (ring: RingConfig, newValue: number) => {
      if (ring.key === 'dials') {
        updateActivityInputs({ dials: newValue });
        return;
      }

      if (ring.key === 'connects') {
        updateRawInputs({ coldCallsWithConversations: newValue });
        return;
      }

      updateActivityInputs({ emailsTotal: newValue });
    },
    [updateActivityInputs, updateRawInputs],
  );

  return (
    <div className="relative flex items-center gap-3">
      {RINGS.map((ring) => {
        const value = getValue(ring);
        const goal = ring.defaultGoal;

        return (
          <div key={ring.key} className="relative">
            <MiniRing
              value={value}
              goal={goal}
              colorVar={ring.colorVar}
              glowVar={ring.glowVar}
              label={ring.label}
              onClick={() => setEditing(editing === ring.key ? null : ring.key)}
            />

            <AnimatePresence>
              {editing === ring.key && (
                <EditPopover
                  ring={ring}
                  value={value}
                  goal={goal}
                  onClose={() => setEditing(null)}
                  onUpdate={(nextValue) => handleUpdate(ring, nextValue)}
                />
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Plus, X } from 'lucide-react';

interface RingConfig {
  key: 'dials' | 'connects' | 'emails';
  label: string;
  storeKey: string;
  storeSection: 'activity' | 'raw';
  goalKey: string;
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
    goalKey: 'target_dials_per_day',
    defaultGoal: 60,
    colorVar: '--strain',
    glowVar: '--strain-glow',
  },
  {
    key: 'connects',
    label: 'Connects',
    storeKey: 'coldCallsWithConversations',
    storeSection: 'raw',
    goalKey: 'target_connects_per_day',
    defaultGoal: 6,
    colorVar: '--recovery',
    glowVar: '--recovery-glow',
  },
  {
    key: 'emails',
    label: 'Emails',
    storeKey: 'emailsTotal',
    storeSection: 'activity',
    goalKey: 'target_emails_per_day',
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
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 group cursor-pointer transition-transform hover:scale-105 active:scale-95"
    >
      <div className="relative">
        <svg width={size} height={size} className="transform -rotate-90">
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
          <span
            className="text-sm font-display font-bold"
            style={{ color }}
          >
            {value}
          </span>
        </div>
      </div>
      <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </button>
  );
}

const EditPopover = React.forwardRef<HTMLDivElement, {
  ring: RingConfig;
  value: number;
  goal: number;
  onClose: () => void;
  onUpdate: (newValue: number) => void;
}>(({
  ring,
  value,
  goal,
  onClose,
  onUpdate,
}, ref) => {
  const color = `hsl(var(${ring.colorVar}))`;
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -4 }}
      className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 bg-card border border-border rounded-xl shadow-xl p-3 min-w-[160px]"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold" style={{ color }}>{ring.label}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onUpdate(Math.max(0, value - 1))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onUpdate(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-16 text-center text-lg font-bold h-9"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onUpdate(value + 1)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="text-[10px] text-muted-foreground text-center mt-1.5">
        Goal: {goal} / day
      </div>
    </motion.div>
  );
}

export function ActivityRings() {
  const { currentDay, updateActivityInputs, updateRawInputs } = useStore();
  const [editing, setEditing] = useState<string | null>(null);

  const getValue = useCallback((ring: RingConfig) => {
    if (ring.storeSection === 'activity') {
      return (currentDay?.activityInputs as any)?.[ring.storeKey] || 0;
    }
    return (currentDay?.rawInputs as any)?.[ring.storeKey] || 0;
  }, [currentDay]);

  const getGoal = useCallback((ring: RingConfig) => {
    return ring.defaultGoal;
  }, []);

  const handleUpdate = useCallback((ring: RingConfig, newValue: number) => {
    if (ring.storeSection === 'activity') {
      updateActivityInputs({ [ring.storeKey]: newValue } as any);
    } else {
      updateRawInputs({ [ring.storeKey]: newValue } as any);
    }
  }, [updateActivityInputs, updateRawInputs]);

  return (
    <div className="flex items-center gap-3 relative">
      {RINGS.map((ring) => {
        const value = getValue(ring);
        const goal = getGoal(ring);
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
                  onUpdate={(v) => handleUpdate(ring, v)}
                />
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

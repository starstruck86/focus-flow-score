import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface RingGaugeProps {
  value: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  type: 'strain' | 'recovery' | 'productivity';
  label?: string;
  sublabel?: string;
  className?: string;
}

export function RingGauge({
  value,
  max,
  size = 180,
  strokeWidth = 12,
  type,
  label,
  sublabel,
  className,
}: RingGaugeProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = Math.min(value / max, 1);
  const strokeDashoffset = circumference * (1 - percentage);

  const typeClasses = {
    strain: 'ring-strain',
    recovery: 'ring-recovery',
    productivity: 'ring-productivity',
  };

  const displayValue = type === 'recovery' || type === 'productivity' 
    ? Math.round(value) 
    : value.toFixed(1);

  return (
    <div className={cn('ring-gauge relative flex items-center justify-center', typeClasses[type], className)}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="ring-gauge-track opacity-20"
        />
        {/* Fill */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="ring-gauge-fill"
        />
      </svg>
      
      {/* Center Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span 
          className={cn(
            'text-4xl font-display font-bold',
            type === 'strain' && 'text-gradient-strain',
            type === 'recovery' && 'text-gradient-recovery',
            type === 'productivity' && 'text-gradient-productivity',
          )}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
        >
          {displayValue}
        </motion.span>
        {label && (
          <span className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
            {label}
          </span>
        )}
        {sublabel && (
          <span className="text-sm font-medium mt-1">
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}

import { useEffect, useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, RotateCcw, Check, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TimerBlockType } from '@/types';

const PRESETS = [
  { label: '15m', value: 15 },
  { label: '25m', value: 25 },
  { label: '45m', value: 45 },
  { label: '60m', value: 60 },
  { label: '90m', value: 90 },
];

const BLOCK_TYPES: { value: TimerBlockType; label: string }[] = [
  { value: 'prospecting', label: 'Prospecting' },
  { value: 'account-research', label: 'Account Research' },
  { value: 'deck-creation', label: 'Deck Creation' },
  { value: 'renewal-prep', label: 'Renewal Prep' },
];

export function FocusTimer({ compact = false }: { compact?: boolean }) {
  const { timer, startTimer, pauseTimer, resumeTimer, resetTimer, tickTimer, completeBlock, todayBlockMinutes } = useStore();
  const [selectedMinutes, setSelectedMinutes] = useState(25);
  const [selectedType, setSelectedType] = useState<TimerBlockType>('prospecting');

  // Timer tick effect
  useEffect(() => {
    if (!timer.isRunning || timer.isPaused) return;

    const interval = setInterval(() => {
      tickTimer();
    }, 1000);

    return () => clearInterval(interval);
  }, [timer.isRunning, timer.isPaused, tickTimer]);

  // Check for completion
  useEffect(() => {
    if (timer.isRunning && timer.remainingSeconds === 0) {
      // Play notification sound or show toast
      completeBlock();
    }
  }, [timer.remainingSeconds, timer.isRunning, completeBlock]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const handleStart = () => {
    startTimer(selectedMinutes, selectedType);
  };

  const progress = timer.totalSeconds > 0 
    ? (timer.totalSeconds - timer.remainingSeconds) / timer.totalSeconds 
    : 0;

  const todayPBM = todayBlockMinutes('prospecting');
  const todayADM = todayBlockMinutes('account-research') + 
                   todayBlockMinutes('deck-creation') + 
                   todayBlockMinutes('renewal-prep');

  if (compact) {
    return (
      <div className="flex items-center gap-3 bg-card rounded-lg px-4 py-2 border border-border/50">
        <Timer className="h-4 w-4 text-primary" />
        {timer.isRunning ? (
          <>
            <span className="font-mono text-lg font-semibold text-primary">
              {formatTime(timer.remainingSeconds)}
            </span>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={timer.isPaused ? resumeTimer : pauseTimer}>
              {timer.isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={resetTimer}>
              <RotateCcw className="h-3 w-3" />
            </Button>
          </>
        ) : (
          <>
            <Select value={selectedMinutes.toString()} onValueChange={(v) => setSelectedMinutes(Number(v))}>
              <SelectTrigger className="w-16 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value.toString()}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-7" onClick={handleStart}>
              <Play className="h-3 w-3 mr-1" /> Start
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-semibold flex items-center gap-2">
          <Timer className="h-5 w-5 text-primary" />
          Focus Timer
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>PBM: {todayPBM}m</span>
          <span className="text-border">|</span>
          <span>ADM: {todayADM}m</span>
        </div>
      </div>

      {/* Timer Ring */}
      <div className="flex flex-col items-center">
        <div className="relative w-40 h-40">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="80"
              cy="80"
              r="70"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-secondary"
            />
            <motion.circle
              cx="80"
              cy="80"
              r="70"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 70}
              animate={{ strokeDashoffset: 2 * Math.PI * 70 * (1 - progress) }}
              style={{ filter: 'drop-shadow(0 0 8px hsl(var(--primary) / 0.5))' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-3xl font-bold text-foreground">
              {timer.isRunning ? formatTime(timer.remainingSeconds) : formatTime(selectedMinutes * 60)}
            </span>
            {timer.isRunning && (
              <span className="text-xs text-muted-foreground capitalize">
                {timer.blockType.replace('-', ' ')}
              </span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col items-center gap-4 mt-6 w-full">
          {!timer.isRunning ? (
            <>
              {/* Presets */}
              <div className="flex gap-2">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    size="sm"
                    variant={selectedMinutes === preset.value ? 'default' : 'secondary'}
                    className="h-8 px-3"
                    onClick={() => setSelectedMinutes(preset.value)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>

              {/* Block Type */}
              <Select value={selectedType} onValueChange={(v) => setSelectedType(v as TimerBlockType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BLOCK_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Start Button */}
              <Button className="w-full" onClick={handleStart}>
                <Play className="h-4 w-4 mr-2" />
                Start Focus Block
              </Button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={timer.isPaused ? resumeTimer : pauseTimer}
                >
                  {timer.isPaused ? (
                    <><Play className="h-4 w-4 mr-2" /> Resume</>
                  ) : (
                    <><Pause className="h-4 w-4 mr-2" /> Pause</>
                  )}
                </Button>
                <Button size="lg" variant="outline" onClick={resetTimer}>
                  <RotateCcw className="h-4 w-4 mr-2" /> Reset
                </Button>
              </div>
              <Button 
                className="w-full" 
                variant="default"
                onClick={completeBlock}
              >
                <Check className="h-4 w-4 mr-2" />
                Complete & Log Block
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { Timer, Play, Pause, RotateCcw, Check } from 'lucide-react';
import type { TimerBlockType } from '@/types';

interface FocusTimerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRESETS = [
  { label: '25m', value: 25 },
  { label: '45m', value: 45 },
  { label: '60m', value: 60 },
  { label: '90m', value: 90 },
];

const BLOCK_TYPES: { value: TimerBlockType; label: string }[] = [
  { value: 'prospecting', label: 'Prospecting' },
  { value: 'account-research', label: 'Research' },
  { value: 'deck-creation', label: 'Meeting Prep' },
  { value: 'renewal-prep', label: 'Renewal Prep' },
];

export function FocusTimerModal({ open, onOpenChange }: FocusTimerModalProps) {
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
      handleComplete();
    }
  }, [timer.remainingSeconds, timer.isRunning]);
  
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);
  
  const handleStart = () => {
    startTimer(selectedMinutes, selectedType);
    toast.success('Focus timer started!', {
      description: `${selectedMinutes} minute ${selectedType.replace('-', ' ')} block`,
    });
  };
  
  const handleComplete = () => {
    const elapsedMinutes = Math.round((timer.totalSeconds - timer.remainingSeconds) / 60);
    completeBlock();
    toast.success('Focus block complete!', {
      description: `${elapsedMinutes} minutes logged to ${timer.blockType.replace('-', ' ')}`,
    });
  };
  
  const handleReset = () => {
    resetTimer();
  };
  
  const handleClose = () => {
    if (timer.isRunning && timer.remainingSeconds > 0) {
      // Warn before closing active timer
      if (confirm('You have an active timer. End the session and save progress?')) {
        handleComplete();
        onOpenChange(false);
      }
    } else {
      onOpenChange(false);
    }
  };
  
  const progress = timer.totalSeconds > 0 
    ? (timer.totalSeconds - timer.remainingSeconds) / timer.totalSeconds 
    : 0;
  
  const todayPBM = todayBlockMinutes('prospecting');
  const todayADM = todayBlockMinutes('account-research') + 
                   todayBlockMinutes('deck-creation') + 
                   todayBlockMinutes('renewal-prep');
  
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Timer className="h-5 w-5 text-primary" />
              Focus Timer
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              PBM: {todayPBM}m | ADM: {todayADM}m
            </span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex flex-col items-center py-4 space-y-6">
          {/* Timer Ring */}
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
          {!timer.isRunning ? (
            <div className="w-full space-y-4">
              {/* Presets */}
              <div className="flex justify-center gap-2">
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
                <SelectTrigger>
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
            </div>
          ) : (
            <div className="w-full space-y-3">
              <div className="flex justify-center gap-2">
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
                <Button size="lg" variant="outline" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4 mr-2" /> Reset
                </Button>
              </div>
              <Button 
                className="w-full" 
                variant="default"
                onClick={handleComplete}
              >
                <Check className="h-4 w-4 mr-2" />
                Complete & Log Block
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

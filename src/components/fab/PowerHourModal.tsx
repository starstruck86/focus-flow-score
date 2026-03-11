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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/store/useStore';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Zap, 
  Play, 
  Pause, 
  Square, 
  Phone, 
  MessageSquare, 
  Calendar,
  Minus,
  Plus,
  TrendingUp,
} from 'lucide-react';
import type { Motion } from '@/types';

interface PowerHourModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DURATION_PRESETS = [
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '60 min', value: 60 },
  { label: '90 min', value: 90 },
];

type SessionState = 'setup' | 'running' | 'paused' | 'completed';

export function PowerHourModal({ open, onOpenChange }: PowerHourModalProps) {
  const { logCall, updateRawInputs, currentDay, initializeToday } = useStore();
  
  const [duration, setDuration] = useState(60);
  const [focus, setFocus] = useState<Motion>('new-logo');
  const [sessionState, setSessionState] = useState<SessionState>('setup');
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [dials, setDials] = useState(0);
  const [connects, setConnects] = useState(0);
  const [meetingsSet, setMeetingsSet] = useState(0);
  const [notes, setNotes] = useState('');
  
  useEffect(() => {
    if (open) initializeToday();
  }, [open, initializeToday]);
  
  useEffect(() => {
    if (sessionState !== 'running') return;
    const interval = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev <= 1) {
          setSessionState('completed');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionState]);
  
  useEffect(() => {
    if (!open && (sessionState === 'setup' || sessionState === 'completed')) {
      setSessionState('setup');
      setRemainingSeconds(0);
      setStartTime(null);
      setDials(0);
      setConnects(0);
      setMeetingsSet(0);
      setNotes('');
    }
  }, [open, sessionState]);
  
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);
  
  const handleStart = () => {
    setRemainingSeconds(duration * 60);
    setStartTime(new Date());
    setSessionState('running');
    toast.success('Power Hour started!', {
      description: `${duration} minute session — ${focus === 'new-logo' ? 'New Logo' : 'Renewal'} focus`,
    });
  };
  
  const handlePause = () => setSessionState('paused');
  const handleResume = () => setSessionState('running');
  
  const handleEnd = () => {
    setSessionState('completed');
    applyToDaily();
  };
  
  const applyToDaily = async () => {
    // Apply to local store
    for (let i = 0; i < dials; i++) {
      logCall(i < connects);
    }
    if (meetingsSet > 0) {
      updateRawInputs({
        initialMeetingsSet: (currentDay?.rawInputs.initialMeetingsSet || 0) + meetingsSet,
      });
    }
    
    // Persist to database for cross-device sync
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const today = new Date().toISOString().slice(0, 10);
        await supabase.from('power_hour_sessions' as any).insert({
          user_id: user.id,
          started_at: startTime?.toISOString() || new Date().toISOString(),
          ended_at: new Date().toISOString(),
          duration_minutes: duration,
          focus,
          dials,
          connects,
          meetings_set: meetingsSet,
          notes: notes || null,
          status: 'completed',
          synced_to_journal: true,
          journal_date: today,
        });
      }
    } catch (err) {
      console.error('Failed to sync power hour session:', err);
    }
    
    toast.success('Power Hour complete!', {
      description: `${dials} dials, ${connects} connects, ${meetingsSet} meetings set`,
    });
  };
  
  const handleClose = () => {
    if (sessionState === 'running' || sessionState === 'paused') {
      if (confirm('End your Power Hour session? Progress will be saved.')) {
        handleEnd();
        onOpenChange(false);
      }
    } else {
      onOpenChange(false);
    }
  };
  
  const progress = duration * 60 > 0 
    ? ((duration * 60 - remainingSeconds) / (duration * 60)) * 100
    : 0;
  
  const connectRate = dials > 0 ? ((connects / dials) * 100).toFixed(1) : '0.0';
  const meetingsPerConnect = connects > 0 ? (meetingsSet / connects).toFixed(2) : '0.00';
  
  const inc = (setter: React.Dispatch<React.SetStateAction<number>>) => setter(prev => prev + 1);
  const dec = (setter: React.Dispatch<React.SetStateAction<number>>, current: number) => {
    if (current > 0) setter(prev => prev - 1);
  };
  
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-status-yellow" />
            Power Hour
          </DialogTitle>
        </DialogHeader>
        
        {sessionState === 'setup' ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Duration</Label>
              <div className="flex gap-2">
                {DURATION_PRESETS.map(preset => (
                  <Button
                    key={preset.value}
                    size="sm"
                    variant={duration === preset.value ? 'default' : 'secondary'}
                    onClick={() => setDuration(preset.value)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Session Focus</Label>
              <Select value={focus} onValueChange={(v) => setFocus(v as Motion)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new-logo">New Logo</SelectItem>
                  <SelectItem value="renewal">Renewal</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Button className="w-full gap-2" size="lg" onClick={handleStart}>
              <Play className="h-4 w-4" />
              Start Power Hour
            </Button>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Timer Ring */}
            <div className="flex flex-col items-center">
              <div className="relative w-32 h-32">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="64" cy="64" r="56" fill="none" stroke="currentColor" strokeWidth="6" className="text-secondary" />
                  <motion.circle
                    cx="64" cy="64" r="56" fill="none"
                    stroke="hsl(var(--status-yellow))"
                    strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 56}
                    animate={{ strokeDashoffset: 2 * Math.PI * 56 * (1 - progress / 100) }}
                    style={{ filter: 'drop-shadow(0 0 8px hsl(var(--status-yellow) / 0.5))' }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-2xl font-bold text-foreground">{formatTime(remainingSeconds)}</span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {sessionState === 'paused' ? 'Paused' : focus.replace('-', ' ')}
                  </span>
                </div>
              </div>
              
              <div className="flex gap-2 mt-4">
                {sessionState === 'running' ? (
                  <Button variant="secondary" size="sm" onClick={handlePause} className="gap-1">
                    <Pause className="h-4 w-4" /> Pause
                  </Button>
                ) : sessionState === 'paused' ? (
                  <Button variant="secondary" size="sm" onClick={handleResume} className="gap-1">
                    <Play className="h-4 w-4" /> Resume
                  </Button>
                ) : null}
                {(sessionState === 'running' || sessionState === 'paused') && (
                  <Button variant="outline" size="sm" onClick={handleEnd} className="gap-1">
                    <Square className="h-4 w-4" /> End
                  </Button>
                )}
              </div>
            </div>
            
            {/* Live Counters */}
            <div className="space-y-3">
              {[
                { icon: Phone, label: 'Dials', value: dials, setter: setDials },
                { icon: MessageSquare, label: 'Connects', value: connects, setter: setConnects },
                { icon: Calendar, label: 'Meetings Set', value: meetingsSet, setter: setMeetingsSet },
              ].map(({ icon: Icon, label, value, setter }) => (
                <div key={label} className="flex items-center justify-between bg-secondary/50 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => dec(setter, value)}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-12 text-center text-2xl font-bold">{value}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => inc(setter)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Stats */}
            <div className="flex justify-center gap-6 text-sm">
              <div className="text-center">
                <div className="text-muted-foreground">Connect Rate</div>
                <div className="font-semibold text-lg">{connectRate}%</div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground">Mtgs/Connect</div>
                <div className="font-semibold text-lg">{meetingsPerConnect}</div>
              </div>
            </div>
            
            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea placeholder="Session notes..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            
            {/* Completion */}
            {sessionState === 'completed' && (
              <div className="text-center p-4 bg-status-green/10 rounded-lg">
                <TrendingUp className="h-8 w-8 text-status-green mx-auto mb-2" />
                <p className="font-medium text-status-green">Session Complete!</p>
                <p className="text-sm text-muted-foreground">
                  {dials} dials, {connects} connects, {meetingsSet} meetings — synced ✓
                </p>
                <Button className="mt-3" onClick={() => onOpenChange(false)}>Close</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

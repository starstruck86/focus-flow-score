import { 
  Moon, 
  Zap, 
  Brain, 
  AlertCircle,
  Eye,
  Shuffle,
  Briefcase,
  Plane,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { RecoveryJournalInputs, DistractionLevelJournal, ContextSwitchingLevelJournal } from '@/types/journal';

interface RecoveryStepProps {
  recovery: RecoveryJournalInputs;
  onChange: (recovery: RecoveryJournalInputs) => void;
}

interface RatingSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  icon: React.ElementType;
  lowLabel?: string;
  highLabel?: string;
  inverted?: boolean; // For stress where low is good
}

function RatingSlider({ 
  label, 
  value, 
  onChange, 
  icon: Icon, 
  lowLabel = 'Low', 
  highLabel = 'High',
  inverted = false,
}: RatingSliderProps) {
  const getColor = () => {
    if (inverted) {
      if (value <= 2) return 'text-status-green';
      if (value === 3) return 'text-status-yellow';
      return 'text-status-red';
    } else {
      if (value >= 4) return 'text-status-green';
      if (value === 3) return 'text-status-yellow';
      return 'text-status-red';
    }
  };
  
  return (
    <div className="space-y-2 p-3 bg-secondary/30 rounded-lg">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-primary" />
          {label}
        </Label>
        <span className={cn("text-lg font-bold font-mono", getColor())}>
          {value}/5
        </span>
      </div>
      <Slider
        value={[value]}
        min={1}
        max={5}
        step={1}
        onValueChange={([v]) => onChange(v)}
        className="py-2"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

export function RecoveryStep({ recovery, onChange }: RecoveryStepProps) {
  const updateField = <K extends keyof RecoveryJournalInputs>(
    field: K, 
    value: RecoveryJournalInputs[K]
  ) => {
    onChange({ ...recovery, [field]: value });
  };
  
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Quick recovery check — helps predict tomorrow's performance.
      </p>
      
      {/* Sleep */}
      <div className="space-y-2 p-3 bg-secondary/30 rounded-lg">
        <Label className="flex items-center gap-2 text-sm">
          <Moon className="h-4 w-4 text-primary" />
          Sleep Hours
        </Label>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={0}
            max={12}
            step={0.5}
            value={recovery.sleepHours}
            onChange={(e) => updateField('sleepHours', parseFloat(e.target.value) || 0)}
            className="w-24 text-center text-lg font-mono"
          />
          <span className="text-sm text-muted-foreground">hours</span>
          <span className={cn(
            "text-xs px-2 py-1 rounded",
            recovery.sleepHours >= 7 ? 'bg-status-green/10 text-status-green' :
            recovery.sleepHours >= 6 ? 'bg-status-yellow/10 text-status-yellow' :
            'bg-status-red/10 text-status-red'
          )}>
            {recovery.sleepHours >= 7 ? 'Good' : recovery.sleepHours >= 6 ? 'Fair' : 'Low'}
          </span>
        </div>
      </div>
      
      {/* Rating Sliders */}
      <div className="space-y-3">
        <RatingSlider
          label="Energy"
          value={recovery.energy}
          onChange={(v) => updateField('energy', v)}
          icon={Zap}
          lowLabel="Exhausted"
          highLabel="Energized"
        />
        
        <RatingSlider
          label="Focus Quality"
          value={recovery.focusQuality}
          onChange={(v) => updateField('focusQuality', v)}
          icon={Eye}
          lowLabel="Scattered"
          highLabel="Laser-focused"
        />
        
        <RatingSlider
          label="Stress"
          value={recovery.stress}
          onChange={(v) => updateField('stress', v)}
          icon={AlertCircle}
          lowLabel="Calm"
          highLabel="Stressed"
          inverted
        />
        
        <RatingSlider
          label="Mental Clarity"
          value={recovery.clarity}
          onChange={(v) => updateField('clarity', v)}
          icon={Brain}
          lowLabel="Foggy"
          highLabel="Crystal clear"
        />
      </div>
      
      {/* Dropdowns */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Distractions
          </Label>
          <Select 
            value={recovery.distractions} 
            onValueChange={(v) => updateField('distractions', v as DistractionLevelJournal)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-2">
            <Shuffle className="h-4 w-4" />
            Context Switching
          </Label>
          <Select 
            value={recovery.contextSwitching} 
            onValueChange={(v) => updateField('contextSwitching', v as ContextSwitchingLevelJournal)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {/* Toggle Flags */}
      <div className="flex gap-4">
        <div className="flex items-center gap-2 p-3 bg-secondary/30 rounded-lg flex-1">
          <Switch
            checked={recovery.adminHeavyDay}
            onCheckedChange={(checked) => updateField('adminHeavyDay', checked)}
          />
          <Label className="text-sm flex items-center gap-1">
            <Briefcase className="h-4 w-4" />
            Admin-heavy day
          </Label>
        </div>
        
        <div className="flex items-center gap-2 p-3 bg-secondary/30 rounded-lg flex-1">
          <Switch
            checked={recovery.travelDay}
            onCheckedChange={(checked) => updateField('travelDay', checked)}
          />
          <Label className="text-sm flex items-center gap-1">
            <Plane className="h-4 w-4" />
            Travel day
          </Label>
        </div>
      </div>
      
      {/* Optional Notes */}
      <div className="space-y-3">
        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">
            What drained you today? (optional)
          </Label>
          <Textarea
            placeholder="Meetings, interruptions, difficult calls..."
            value={recovery.whatDrainedYou}
            onChange={(e) => updateField('whatDrainedYou', e.target.value)}
            rows={2}
          />
        </div>
        
        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">
            What worked today? (optional)
          </Label>
          <Textarea
            placeholder="Good focus block, great call, early start..."
            value={recovery.whatWorkedToday}
            onChange={(e) => updateField('whatWorkedToday', e.target.value)}
            rows={2}
          />
        </div>
      </div>
    </div>
  );
}

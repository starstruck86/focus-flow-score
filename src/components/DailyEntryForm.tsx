import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Phone, 
  Mail, 
  Users, 
  Calendar, 
  Target, 
  Lightbulb,
  Plus,
  Minus,
  ChevronDown,
  ChevronUp,
  Flame,
  Zap,
  TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import type { FocusMode, DistractionLevel, ContextSwitchingLevel } from '@/types';

export function DailyEntryForm() {
  const { currentDay, updateRawInputs, updateActivityInputs, updateRecoveryInputs, saveDay } = useStore();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  if (!currentDay) return null;

  const { rawInputs, activityInputs, recoveryInputs } = currentDay;

  const CounterInput = ({ 
    label, 
    value, 
    onChange, 
    icon: Icon,
    max,
    step = 1,
    suffix,
  }: { 
    label: string; 
    value: number; 
    onChange: (v: number) => void; 
    icon: React.ElementType;
    max?: number;
    step?: number;
    suffix?: string;
  }) => (
    <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button 
          size="icon" 
          variant="ghost" 
          className="h-8 w-8"
          onClick={() => onChange(Math.max(0, value - step))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-12 text-center font-mono text-lg font-semibold">
          {value}{suffix}
        </span>
        <Button 
          size="icon" 
          variant="ghost" 
          className="h-8 w-8"
          onClick={() => onChange(max ? Math.min(max, value + step) : value + step)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Core Daily Tracker - Fast Entry */}
      <div className="metric-card">
        <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Daily Tracker
        </h3>
        
        <div className="space-y-3">
          <CounterInput
            label="Prospects Added to Cadence"
            value={rawInputs.prospectsAddedToCadence}
            onChange={(v) => updateRawInputs({ prospectsAddedToCadence: v })}
            icon={Users}
          />
          <CounterInput
            label="Cold Calls with Conversations"
            value={rawInputs.coldCallsWithConversations}
            onChange={(v) => updateRawInputs({ coldCallsWithConversations: v })}
            icon={Phone}
          />
          <CounterInput
            label="Emails/InMails to Manager+"
            value={rawInputs.emailsInMailsToManager}
            onChange={(v) => updateRawInputs({ emailsInMailsToManager: v })}
            icon={Mail}
          />
          <CounterInput
            label="Initial Meetings Set"
            value={rawInputs.initialMeetingsSet}
            onChange={(v) => updateRawInputs({ initialMeetingsSet: v })}
            icon={Calendar}
          />
          <CounterInput
            label="Opportunities Created"
            value={rawInputs.opportunitiesCreated}
            onChange={(v) => updateRawInputs({ opportunitiesCreated: v })}
            icon={TrendingUp}
          />
          
          {/* Personal Development Toggle */}
          <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Lightbulb className="h-4 w-4 text-primary" />
              </div>
              <span className="text-sm font-medium">Personal Development (1hr)</span>
            </div>
            <Switch
              checked={rawInputs.personalDevelopment === 1}
              onCheckedChange={(checked) => updateRawInputs({ personalDevelopment: checked ? 1 : 0 })}
            />
          </div>
        </div>

        {/* Points Display */}
        <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Daily Points</span>
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-2xl font-display font-bold",
              currentDay.scores.dailyScore >= 8 ? "text-status-green" : "text-foreground"
            )}>
              {currentDay.scores.dailyScore}
            </span>
            <span className="text-muted-foreground">/ 8 goal</span>
          </div>
        </div>
      </div>

      {/* Advanced Activity Inputs */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <div className="metric-card">
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold flex items-center gap-2">
                <Flame className="h-5 w-5 text-strain" />
                Activity Details
              </h3>
              {showAdvanced ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </div>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <div className="mt-4 space-y-4">
              {/* Focus Mode */}
              <div className="space-y-2">
                <Label>Daily Focus Mode</Label>
                <div className="flex gap-2">
                  {(['new-logo', 'balanced', 'expansion'] as FocusMode[]).map((mode) => (
                    <Button
                      key={mode}
                      size="sm"
                      variant={activityInputs.focusMode === mode ? 'default' : 'secondary'}
                      onClick={() => updateActivityInputs({ focusMode: mode })}
                      className="flex-1"
                    >
                      {mode === 'new-logo' ? 'New Logo' : mode === 'expansion' ? 'Expansion' : 'Balanced'}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Total Dials</Label>
                  <Input
                    type="number"
                    value={activityInputs.dials}
                    onChange={(e) => updateActivityInputs({ dials: Number(e.target.value) })}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Total Emails</Label>
                  <Input
                    type="number"
                    value={activityInputs.emailsTotal}
                    onChange={(e) => updateActivityInputs({ emailsTotal: Number(e.target.value) })}
                    className="h-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Automated Email %</Label>
                <Select 
                  value={activityInputs.automatedPercent.toString()} 
                  onValueChange={(v) => updateActivityInputs({ automatedPercent: Number(v) as 0 | 25 | 50 | 75 | 100 })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 25, 50, 75, 100].map((p) => (
                      <SelectItem key={p} value={p.toString()}>{p}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Exec/Manager+ Outreach</Label>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={activityInputs.execManagerOutreach}
                    onChange={(e) => updateActivityInputs({ execManagerOutreach: Math.min(5, Number(e.target.value)) })}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Customer Meetings Held</Label>
                  <Input
                    type="number"
                    value={activityInputs.customerMeetingsHeld}
                    onChange={(e) => updateActivityInputs({ customerMeetingsHeld: Number(e.target.value) })}
                    className="h-9"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Expansion Touchpoints</Label>
                  <Input
                    type="number"
                    value={activityInputs.expansionTouchpoints}
                    onChange={(e) => updateActivityInputs({ expansionTouchpoints: Number(e.target.value) })}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Meeting Minutes (optional)</Label>
                  <Input
                    type="number"
                    value={recoveryInputs.meetingMinutes || 0}
                    onChange={(e) => updateRecoveryInputs({ meetingMinutes: Number(e.target.value) })}
                    className="h-9"
                  />
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Recovery Journal */}
      <Collapsible open={showRecovery} onOpenChange={setShowRecovery}>
        <div className="metric-card">
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold flex items-center gap-2">
                <Zap className="h-5 w-5 text-recovery" />
                Recovery Journal
              </h3>
              {showRecovery ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </div>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <div className="mt-4 space-y-4">
              {/* Slider inputs */}
              {[
                { key: 'energy', label: 'Energy', value: recoveryInputs.energy },
                { key: 'focusQuality', label: 'Focus Quality', value: recoveryInputs.focusQuality },
                { key: 'stress', label: 'Stress Level', value: recoveryInputs.stress },
                { key: 'clarity', label: 'Mental Clarity', value: recoveryInputs.clarity },
              ].map((item) => (
                <div key={item.key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{item.label}</Label>
                    <span className="text-xs font-mono text-muted-foreground">{item.value}/5</span>
                  </div>
                  <Slider
                    value={[item.value]}
                    min={1}
                    max={5}
                    step={1}
                    onValueChange={([v]) => updateRecoveryInputs({ [item.key]: v })}
                  />
                </div>
              ))}

              <div className="space-y-2">
                <Label className="text-xs">Sleep Hours</Label>
                <Input
                  type="number"
                  step={0.5}
                  value={recoveryInputs.sleepHours}
                  onChange={(e) => updateRecoveryInputs({ sleepHours: Number(e.target.value) })}
                  className="h-9"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Distractions</Label>
                  <Select 
                    value={recoveryInputs.distractions} 
                    onValueChange={(v) => updateRecoveryInputs({ distractions: v as DistractionLevel })}
                  >
                    <SelectTrigger className="h-9">
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
                  <Label className="text-xs">Context Switching</Label>
                  <Select 
                    value={recoveryInputs.contextSwitching} 
                    onValueChange={(v) => updateRecoveryInputs({ contextSwitching: v as ContextSwitchingLevel })}
                  >
                    <SelectTrigger className="h-9">
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

              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={recoveryInputs.adminHeavyDay}
                    onCheckedChange={(checked) => updateRecoveryInputs({ adminHeavyDay: checked })}
                  />
                  <Label className="text-xs">Admin-heavy day</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={recoveryInputs.travelDay}
                    onCheckedChange={(checked) => updateRecoveryInputs({ travelDay: checked })}
                  />
                  <Label className="text-xs">Travel day</Label>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Save Button */}
      <Button className="w-full" size="lg" onClick={saveDay}>
        Save Today's Entry
      </Button>
    </div>
  );
}

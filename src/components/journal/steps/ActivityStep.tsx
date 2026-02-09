import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  Phone, 
  MessageSquare, 
  Users, 
  Mail, 
  Calendar, 
  TrendingUp,
  Lightbulb,
  Timer,
  Plus,
  Minus,
  AlertCircle,
  Star,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ActivityTotals, FocusModeJournal } from '@/types/journal';
import { cn } from '@/lib/utils';
import { 
  DAY_TYPE_TEMPLATES, 
  calculateGoodDayPoints,
  type DayTypeTemplate,
} from '@/lib/goodDayModel';

interface ActivityStepProps {
  activity: ActivityTotals;
  onChange: (activity: ActivityTotals) => void;
  selectedTemplate?: DayTypeTemplate;
  onTemplateChange?: (template: DayTypeTemplate) => void;
}

interface CounterFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  icon: React.ElementType;
  max?: number;
  step?: number;
}

function CounterField({ label, value, onChange, icon: Icon, max, step = 1 }: CounterFieldProps) {
  const handleIncrement = () => {
    const newValue = value + step;
    onChange(max ? Math.min(max, newValue) : newValue);
  };
  
  const handleDecrement = () => {
    onChange(Math.max(0, value - step));
  };
  
  return (
    <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button 
          size="icon" 
          variant="ghost" 
          className="h-8 w-8"
          onClick={handleDecrement}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <button
          onClick={() => {
            const input = prompt(`Enter ${label}:`, value.toString());
            if (input !== null) {
              const num = parseInt(input, 10);
              if (!isNaN(num) && num >= 0) {
                onChange(max ? Math.min(max, num) : num);
              }
            }
          }}
          className="w-12 text-center font-mono text-lg font-semibold hover:bg-secondary/50 rounded py-1"
        >
          {value}
        </button>
        <Button 
          size="icon" 
          variant="ghost" 
          className="h-8 w-8"
          onClick={handleIncrement}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function ActivityStep({ 
  activity, 
  onChange,
  selectedTemplate = 'balanced-pd',
  onTemplateChange,
}: ActivityStepProps) {
  const [estimateMode, setEstimateMode] = useState(false);
  
  const updateField = <K extends keyof ActivityTotals>(field: K, value: ActivityTotals[K]) => {
    onChange({ ...activity, [field]: value });
  };
  
  // Calculate points in real-time
  const pointsResult = useMemo(() => calculateGoodDayPoints({
    prospectsAdded: activity.prospectsAdded,
    conversations: activity.conversations,
    managerPlusMessages: activity.managerPlusMessages,
    meetingsSet: activity.meetingsSet,
    oppsCreated: activity.opportunitiesCreated,
    personalDevelopment: activity.personalDevelopment,
  }), [activity]);
  
  const currentTemplate = DAY_TYPE_TEMPLATES.find(t => t.id === selectedTemplate);
  
  return (
    <div className="space-y-4">
      {/* Points Progress - Top */}
      <div className={cn(
        "p-4 rounded-xl border-2 text-center",
        pointsResult.total >= 8 
          ? "bg-status-green/10 border-status-green/30" 
          : "bg-primary/5 border-primary/20"
      )}>
        <div className="flex items-center justify-center gap-2 mb-2">
          <Star className={cn(
            "h-5 w-5",
            pointsResult.total >= 8 ? "text-status-green fill-status-green" : "text-primary"
          )} />
          <span className="text-2xl font-bold">
            {pointsResult.total}
            <span className="text-lg font-normal text-muted-foreground">/8 points</span>
          </span>
        </div>
        <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
          {pointsResult.breakdown.prospects > 0 && (
            <span>Prospects: {pointsResult.breakdown.prospects}pt</span>
          )}
          {pointsResult.breakdown.conversations > 0 && (
            <span>Convos: {pointsResult.breakdown.conversations}pt</span>
          )}
          {pointsResult.breakdown.messages > 0 && (
            <span>Msgs: {pointsResult.breakdown.messages}pt</span>
          )}
          {pointsResult.breakdown.meetings > 0 && (
            <span>Mtgs: {pointsResult.breakdown.meetings}pt</span>
          )}
          {pointsResult.breakdown.opps > 0 && (
            <span>Opps: {pointsResult.breakdown.opps}pt</span>
          )}
          {pointsResult.breakdown.pd > 0 && (
            <span>PD: {pointsResult.breakdown.pd}pt</span>
          )}
        </div>
      </div>
      
      {/* Day Type Template Selection */}
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Target className="h-4 w-4" />
          Day Type (8 points each)
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {DAY_TYPE_TEMPLATES.filter(t => t.id !== 'custom').map((template) => (
            <Button
              key={template.id}
              size="sm"
              variant={selectedTemplate === template.id ? 'default' : 'secondary'}
              onClick={() => onTemplateChange?.(template.id)}
              className="flex flex-col h-auto py-2 px-3"
            >
              <span className="font-medium">{template.name}</span>
              <span className="text-[10px] opacity-70 font-normal">{template.description}</span>
            </Button>
          ))}
        </div>
        {currentTemplate && currentTemplate.id !== 'custom' && (
          <p className="text-xs text-muted-foreground">
            Target: {currentTemplate.prospectsAdded} prospects, {currentTemplate.conversations} convos, {currentTemplate.managerPlusMessages} msgs
          </p>
        )}
      </div>
      
      {/* Estimate Mode Toggle */}
      <div className="flex items-center gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
        <AlertCircle className="h-4 w-4 text-amber-500" />
        <span className="text-sm text-amber-600 dark:text-amber-400 flex-1">
          Didn't track today? Estimate now.
        </span>
        <Switch
          checked={estimateMode}
          onCheckedChange={setEstimateMode}
        />
      </div>
      
      {/* Focus Mode */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Daily Focus Mode</Label>
        <div className="flex gap-2">
          {(['new-logo', 'balanced', 'expansion'] as FocusModeJournal[]).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={activity.focusMode === mode ? 'default' : 'secondary'}
              onClick={() => updateField('focusMode', mode)}
              className="flex-1"
            >
              {mode === 'new-logo' ? 'New Logo' : mode === 'expansion' ? 'Expansion' : 'Balanced'}
            </Button>
          ))}
        </div>
      </div>
      
      {/* Core Metrics */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Outreach</Label>
        <div className="space-y-2">
          <CounterField
            label="Dials"
            value={activity.dials}
            onChange={(v) => updateField('dials', v)}
            icon={Phone}
          />
          <CounterField
            label="Conversations"
            value={activity.conversations}
            onChange={(v) => updateField('conversations', v)}
            icon={MessageSquare}
          />
          <CounterField
            label="Prospects Added"
            value={activity.prospectsAdded}
            onChange={(v) => updateField('prospectsAdded', v)}
            icon={Users}
          />
          <CounterField
            label="Manager+ Messages"
            value={activity.managerPlusMessages}
            onChange={(v) => updateField('managerPlusMessages', v)}
            icon={Mail}
          />
        </div>
      </div>
      
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email Activity</Label>
        <div className="grid grid-cols-2 gap-2">
          <CounterField
            label="Manual Emails"
            value={activity.manualEmails}
            onChange={(v) => updateField('manualEmails', v)}
            icon={Mail}
          />
          <CounterField
            label="Automated"
            value={activity.automatedEmails}
            onChange={(v) => updateField('automatedEmails', v)}
            icon={Mail}
          />
        </div>
      </div>
      
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Meetings & Opps</Label>
        <div className="space-y-2">
          <CounterField
            label="Meetings Set"
            value={activity.meetingsSet}
            onChange={(v) => updateField('meetingsSet', v)}
            icon={Calendar}
          />
          <CounterField
            label="Customer Meetings Held"
            value={activity.customerMeetingsHeld}
            onChange={(v) => updateField('customerMeetingsHeld', v)}
            icon={Calendar}
          />
          <CounterField
            label="Opportunities Created"
            value={activity.opportunitiesCreated}
            onChange={(v) => updateField('opportunitiesCreated', v)}
            icon={TrendingUp}
          />
        </div>
      </div>
      
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Focus Time</Label>
        <div className="grid grid-cols-2 gap-2">
          <CounterField
            label="Prospecting (min)"
            value={activity.prospectingBlockMinutes}
            onChange={(v) => updateField('prospectingBlockMinutes', v)}
            icon={Timer}
            step={15}
            max={180}
          />
          <CounterField
            label="Deep Work (min)"
            value={activity.accountDeepWorkMinutes}
            onChange={(v) => updateField('accountDeepWorkMinutes', v)}
            icon={Timer}
            step={15}
            max={180}
          />
        </div>
      </div>
      
      {/* Personal Development */}
      <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Lightbulb className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-medium">Personal Development (1hr)</span>
        </div>
        <Switch
          checked={activity.personalDevelopment}
          onCheckedChange={(checked) => updateField('personalDevelopment', checked)}
        />
      </div>
    </div>
  );
}

import { 
  Search, 
  UserCheck, 
  Phone, 
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { PreparednessInputs } from '@/types/journal';

interface PreparednessStepProps {
  preparedness: PreparednessInputs;
  onChange: (preparedness: PreparednessInputs) => void;
}

export function PreparednessStep({ preparedness, onChange }: PreparednessStepProps) {
  const updateField = <K extends keyof PreparednessInputs>(
    field: K, 
    value: PreparednessInputs[K]
  ) => {
    onChange({ ...preparedness, [field]: value });
  };
  
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Track your research and prep work to stay ahead of tomorrow's calls.
      </p>
      
      {/* Research Counts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            Accounts Researched
          </Label>
          <Input
            type="number"
            min={0}
            max={50}
            value={preparedness.accountsResearched}
            onChange={(e) => updateField('accountsResearched', parseInt(e.target.value) || 0)}
            className="text-center text-lg font-mono"
          />
          <p className="text-xs text-muted-foreground">Goal: 10/day</p>
        </div>
        
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-primary" />
            Contacts Prepped
          </Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={preparedness.contactsPrepped}
            onChange={(e) => updateField('contactsPrepped', parseInt(e.target.value) || 0)}
            className="text-center text-lg font-mono"
          />
          <p className="text-xs text-muted-foreground">Goal: 20/day</p>
        </div>
      </div>
      
      {/* Prepped for Calls Tomorrow */}
      <div className="space-y-3 p-4 bg-secondary/30 rounded-lg">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />
            Prepped for all calls tomorrow?
          </Label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={preparedness.preppedForAllCallsTomorrow === true ? 'default' : 'outline'}
              onClick={() => updateField('preppedForAllCallsTomorrow', true)}
            >
              Yes
            </Button>
            <Button
              size="sm"
              variant={preparedness.preppedForAllCallsTomorrow === false ? 'destructive' : 'outline'}
              onClick={() => updateField('preppedForAllCallsTomorrow', false)}
            >
              No
            </Button>
          </div>
        </div>
        
        {preparedness.preppedForAllCallsTomorrow === false && (
          <div className="space-y-3 pt-2 border-t border-border/50">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <Label className="text-sm">How many calls need prep?</Label>
              <Input
                type="number"
                min={0}
                max={20}
                value={preparedness.callsNeedPrepCount}
                onChange={(e) => updateField('callsNeedPrepCount', parseInt(e.target.value) || 0)}
                className="w-20 text-center"
              />
            </div>
            <Textarea
              placeholder="Notes on what needs prep..."
              value={preparedness.callsPrepNote}
              onChange={(e) => updateField('callsPrepNote', e.target.value)}
              rows={2}
            />
          </div>
        )}
      </div>
      
      {/* Meeting Prep */}
      <div className="space-y-3 p-4 bg-secondary/30 rounded-lg">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Meeting prep done today?
          </Label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={preparedness.meetingPrepDone === true ? 'default' : 'outline'}
              onClick={() => updateField('meetingPrepDone', true)}
            >
              Yes
            </Button>
            <Button
              size="sm"
              variant={preparedness.meetingPrepDone === false ? 'destructive' : 'outline'}
              onClick={() => updateField('meetingPrepDone', false)}
            >
              No
            </Button>
          </div>
        </div>
      </div>
      
      {/* Unprepared for Meetings Tomorrow */}
      <div className="space-y-3 p-4 bg-secondary/30 rounded-lg">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Any meeting tomorrow you feel unprepared for?</Label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={preparedness.meetingsUnpreparedFor === false ? 'default' : 'outline'}
              onClick={() => updateField('meetingsUnpreparedFor', false)}
            >
              No
            </Button>
            <Button
              size="sm"
              variant={preparedness.meetingsUnpreparedFor === true ? 'destructive' : 'outline'}
              onClick={() => updateField('meetingsUnpreparedFor', true)}
            >
              Yes
            </Button>
          </div>
        </div>
        
        {preparedness.meetingsUnpreparedFor === true && (
          <Textarea
            placeholder="Which meetings and why..."
            value={preparedness.meetingsUnpreparedNote}
            onChange={(e) => updateField('meetingsUnpreparedNote', e.target.value)}
            rows={2}
          />
        )}
      </div>
    </div>
  );
}

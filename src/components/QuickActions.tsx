import { 
  Phone, 
  MessageSquare,
  Users,
  Minus,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { useState, useCallback } from 'react';

/**
 * Quick metric counters — Salesforce is the system of record for individual activities.
 * This only tracks aggregate daily numbers for coaching & accountability.
 */
export function QuickActions() {
  const { updateRawInputs, currentDay } = useStore();

  const metrics = [
    { key: 'initialDials', label: 'Dials', icon: Phone, value: currentDay?.rawInputs.initialDials || 0 },
    { key: 'initialConversations', label: 'Convos', icon: MessageSquare, value: currentDay?.rawInputs.initialConversations || 0 },
    { key: 'initialMeetingsSet', label: 'Meetings Set', icon: Users, value: currentDay?.rawInputs.initialMeetingsSet || 0 },
  ] as const;

  const adjust = useCallback((key: string, delta: number) => {
    const current = (currentDay?.rawInputs as any)?.[key] || 0;
    const newVal = Math.max(0, current + delta);
    updateRawInputs({ [key]: newVal } as any);
    if (delta > 0) toast.success(`+1 logged`);
  }, [currentDay, updateRawInputs]);

  return (
    <div className="metric-card">
      <h3 className="font-display text-sm font-semibold mb-1 text-muted-foreground uppercase tracking-wider">
        Today's Metrics
      </h3>
      <p className="text-[11px] text-muted-foreground mb-3">Log activity here — details live in Salesforce</p>
      
      <div className="space-y-2">
        {metrics.map(({ key, label, icon: Icon, value }) => (
          <div key={key} className="flex items-center justify-between bg-secondary/50 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{label}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjust(key, -1)}>
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-8 text-center text-lg font-bold tabular-nums">{value}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjust(key, 1)}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

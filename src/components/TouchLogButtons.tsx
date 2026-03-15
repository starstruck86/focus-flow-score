import { Phone, Mail, Calendar, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { emitSaveStatus } from '@/components/SaveIndicator';
import type { TouchType } from '@/types';

interface TouchLogButtonsProps {
  accountId: string;
  compact?: boolean;
}

const TOUCH_TYPES: { type: TouchType; icon: typeof Phone; label: string; hasConversation?: boolean }[] = [
  { type: 'call', icon: Phone, label: 'Log Call', hasConversation: true },
  { type: 'manual-email', icon: Mail, label: 'Log Email' },
  { type: 'meeting', icon: Calendar, label: 'Log Meeting' },
  { type: 'linkedin', icon: MessageSquare, label: 'Log LinkedIn' },
];

export function TouchLogButtons({ accountId, compact }: TouchLogButtonsProps) {
  const { updateAccount, accounts } = useStore();

  const handleTouch = (touchType: TouchType) => {
    const today = new Date().toISOString().split('T')[0];
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    emitSaveStatus('saving');

    // Update account touch tracking only — SF is system of record for activities
    updateAccount(accountId, {
      lastTouchDate: today,
      lastTouchType: touchType,
      touchesThisWeek: (account.touchesThisWeek || 0) + 1,
    });

    setTimeout(() => emitSaveStatus('saved'), 300);
    toast.success(`${touchType.replace('-', ' ')} logged for ${account.name}`, { duration: 2000 });
  };

  return (
    <div className="flex items-center gap-0.5">
      {TOUCH_TYPES.map(({ type, icon: Icon, label }) => (
        <Tooltip key={type}>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); handleTouch(type); }}
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

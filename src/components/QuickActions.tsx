import { 
  Phone, 
  Mail, 
  MailCheck,
  Users, 
  MessageSquare 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useState } from 'react';

export function QuickActions() {
  const { logCall, logManualEmail, logAutomatedEmail, logMeetingHeld, logProspectsAdded } = useStore();
  const [showConversationDialog, setShowConversationDialog] = useState(false);

  const handleLogCall = (hadConversation: boolean) => {
    logCall(hadConversation);
    setShowConversationDialog(false);
    toast.success(hadConversation ? 'Call + Conversation logged!' : 'Dial logged!');
  };

  const handleManualEmail = () => {
    logManualEmail();
    toast.success('Manual email logged!');
  };

  const handleAutomatedEmail = () => {
    logAutomatedEmail();
    toast.success('Automated email logged!');
  };

  const handleMeeting = () => {
    logMeetingHeld();
    toast.success('Customer meeting logged!');
  };

  const handleProspects = (count: number) => {
    logProspectsAdded(count);
    toast.success(`${count} prospect(s) added!`);
  };

  return (
    <div className="metric-card">
      <h3 className="font-display text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
        Quick Actions
      </h3>
      
      <div className="grid grid-cols-2 gap-2">
        <Dialog open={showConversationDialog} onOpenChange={setShowConversationDialog}>
          <DialogTrigger asChild>
            <button className="quick-action justify-center">
              <Phone className="h-4 w-4" />
              <span>Log Call</span>
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log Call</DialogTitle>
              <DialogDescription>
                Did you have a conversation?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => handleLogCall(false)}>
                No Conversation
              </Button>
              <Button onClick={() => handleLogCall(true)}>
                Yes, Conversation!
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <button className="quick-action justify-center" onClick={handleManualEmail}>
          <Mail className="h-4 w-4" />
          <span>Manual Email</span>
        </button>

        <button className="quick-action justify-center" onClick={handleAutomatedEmail}>
          <MailCheck className="h-4 w-4" />
          <span>Auto Email</span>
        </button>

        <button className="quick-action justify-center" onClick={handleMeeting}>
          <MessageSquare className="h-4 w-4" />
          <span>Meeting Held</span>
        </button>

        <button className="quick-action justify-center col-span-2" onClick={() => handleProspects(10)}>
          <Users className="h-4 w-4" />
          <span>+10 Prospects</span>
        </button>
      </div>
    </div>
  );
}

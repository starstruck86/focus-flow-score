import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ResourceLinksPanel } from '@/components/ResourceLinksPanel';
import { StakeholderMap } from '@/components/StakeholderMap';
import {
  Phone,
  Mail,
  MailCheck,
  MessageSquare,
  Timer,
  Plus,
  Calendar,
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { EditableDatePicker } from '@/components/EditableDatePicker';
import { format, parseISO } from 'date-fns';
import type { Opportunity, OpportunityStatus, OpportunityStage, Task, Priority, Motion } from '@/types';
import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<OpportunityStatus, string> = {
  'active': 'bg-status-green/20 text-status-green',
  'stalled': 'bg-status-yellow/20 text-status-yellow',
  'closed-lost': 'bg-status-red/20 text-status-red',
  'closed-won': 'bg-green-600/20 text-green-400',
};

const STAGE_OPTIONS: OpportunityStage[] = ['', 'Prospect', 'Discover', 'Demo', 'Proposal', 'Negotiate', 'Closed Won', 'Closed Lost'];

const STAGE_LABELS: Record<string, string> = {
  '': '—',
  'Prospect': '1 - Prospect',
  'Discover': '2 - Discover',
  'Demo': '3 - Demo',
  'Proposal': '4 - Proposal',
  'Negotiate': '5 - Negotiate',
  'Closed Won': '6 - Closed Won',
  'Closed Lost': '7 - Closed Lost',
};

interface OpportunityDrawerProps {
  opportunity: Opportunity | null;
  onClose: () => void;
}

export function OpportunityDrawer({ opportunity, onClose }: OpportunityDrawerProps) {
  const {
    accounts,
    updateOpportunity,
    logOpportunityActivity,
    logCall,
    logManualEmail,
    logAutomatedEmail,
    logMeetingHeld,
    startTimer,
    addTask,
  } = useStore();

  const [showConversationDialog, setShowConversationDialog] = useState(false);
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
  const [newTask, setNewTask] = useState<Partial<Task>>({
    priority: 'P1',
    motion: 'new-logo',
    status: 'next',
    category: 'call',
    subtasks: [],
  });

  if (!opportunity) return null;

  const linkedAccount = accounts.find(a => a.id === opportunity.accountId);

  const handleLogCall = (hadConversation: boolean) => {
    logCall(hadConversation);
    logOpportunityActivity(opportunity.id, 'call', hadConversation ? 'Had conversation' : 'No answer');
    setShowConversationDialog(false);
    toast.success(hadConversation ? 'Call + Conversation logged!' : 'Dial logged!');
  };

  const handleManualEmail = () => {
    logManualEmail();
    logOpportunityActivity(opportunity.id, 'manual-email');
    toast.success('Manual email logged!');
  };

  const handleAutomatedEmail = () => {
    logAutomatedEmail();
    logOpportunityActivity(opportunity.id, 'automated-email');
    toast.success('Automated email logged!');
  };

  const handleMeeting = () => {
    logMeetingHeld();
    logOpportunityActivity(opportunity.id, 'meeting');
    toast.success('Meeting logged!');
  };

  const handleStartTimer = (type: 'prospecting' | 'account-research' | 'deck-creation') => {
    startTimer(25, type, opportunity.accountId);
    toast.success(`Focus timer started: ${type.replace('-', ' ')}`);
  };

  const handleCreateTask = () => {
    if (!newTask.title) {
      toast.error('Task title is required');
      return;
    }

    addTask({
      title: newTask.title,
      workstream: (newTask.motion === 'renewal' ? 'renewals' : 'pg') as any,
      priority: newTask.priority as Priority,
      dueDate: newTask.dueDate || new Date().toISOString().split('T')[0],
      status: 'next',
      motion: newTask.motion as Motion,
      linkedRecordType: 'opportunity',
      linkedRecordId: opportunity.id,
      linkedAccountId: opportunity.accountId || undefined,
      linkedOpportunityId: opportunity.id,
      category: newTask.category as any,
      subtasks: [],
    });

    toast.success('Task created!');
    setShowCreateTaskDialog(false);
    setNewTask({
      priority: 'P1',
      motion: 'new-logo',
      status: 'next',
      category: 'call',
      subtasks: [],
    });
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    try {
      return format(parseISO(dateStr), 'MMM d, yyyy');
    } catch {
      return dateStr;
    }
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <>
      <Sheet open={!!opportunity} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-xl">{opportunity.name}</SheetTitle>
            <SheetDescription>
              <Badge className={cn("text-xs", STATUS_COLORS[opportunity.status])}>
                {opportunity.status.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}
              </Badge>
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Quick Actions */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Quick Actions
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <Dialog open={showConversationDialog} onOpenChange={setShowConversationDialog}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => setShowConversationDialog(true)}
                  >
                    <Phone className="h-4 w-4 mr-2" />
                    Log Call
                  </Button>
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

                <Button variant="outline" size="sm" className="justify-start" onClick={handleManualEmail}>
                  <Mail className="h-4 w-4 mr-2" />
                  Manual Email
                </Button>

                <Button variant="outline" size="sm" className="justify-start" onClick={handleAutomatedEmail}>
                  <MailCheck className="h-4 w-4 mr-2" />
                  Auto Email
                </Button>

                <Button variant="outline" size="sm" className="justify-start" onClick={handleMeeting}>
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Log Meeting
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={() => handleStartTimer('prospecting')}
                >
                  <Timer className="h-4 w-4 mr-2" />
                  Focus: Prospecting
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={() => handleStartTimer('deck-creation')}
                >
                  <Timer className="h-4 w-4 mr-2" />
                  Focus: Deck/Research
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start col-span-2"
                  onClick={() => setShowCreateTaskDialog(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Task
                </Button>
              </div>
            </div>

            <Separator />

            {/* Details */}
            <div className="space-y-4">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Details
              </Label>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Linked Account</Label>
                  <Select
                    value={opportunity.accountId || 'none'}
                    onValueChange={(v) => updateOpportunity(opportunity.id, { 
                      accountId: v === 'none' ? undefined : v,
                      accountName: v === 'none' ? undefined : accounts.find(a => a.id === v)?.name
                    })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select account..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No account</SelectItem>
                      {accounts.map(account => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Stage</Label>
                  <Select
                    value={opportunity.stage || 'none'}
                    onValueChange={(v) => updateOpportunity(opportunity.id, { 
                      stage: (v === 'none' ? '' : v) as OpportunityStage 
                    })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select stage..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {STAGE_OPTIONS.filter(s => s).map(stage => (
                        <SelectItem key={stage} value={stage}>{STAGE_LABELS[stage]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>ARR</Label>
                  <Input
                    type="number"
                    value={opportunity.arr || ''}
                    onChange={(e) => updateOpportunity(opportunity.id, { 
                      arr: e.target.value ? Number(e.target.value) : undefined 
                    })}
                    placeholder="$0"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Close Date</Label>
                  <EditableDatePicker
                    value={opportunity.closeDate}
                    onChange={(v) => updateOpportunity(opportunity.id, { closeDate: v })}
                    placeholder="Select close date"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Next Step</Label>
                <div className="flex gap-2">
                  <EditableDatePicker
                    value={opportunity.nextStepDate}
                    onChange={(v) => updateOpportunity(opportunity.id, { nextStepDate: v })}
                    placeholder="Select date"
                    className="w-44"
                  />
                  <Input
                    value={opportunity.nextStep || ''}
                    onChange={(e) => updateOpportunity(opportunity.id, { nextStep: e.target.value })}
                    placeholder="Description (or TBD)"
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={opportunity.notes || ''}
                  onChange={(e) => updateOpportunity(opportunity.id, { notes: e.target.value })}
                  placeholder="Add notes..."
                  rows={4}
                />
              </div>
            </div>

            <Separator />

            {/* Resources & Templates */}
            <ResourceLinksPanel
              recordType="opportunity"
              recordId={opportunity.id}
              parentAccountId={opportunity.accountId}
            />

            <Separator />

            {/* Activity Log */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Activity Log
              </Label>
              {opportunity.activityLog.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No activities logged yet
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {[...opportunity.activityLog].reverse().map(activity => (
                    <div
                      key={activity.id}
                      className="flex items-start gap-3 p-2 rounded-lg bg-muted/30"
                    >
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(activity.date)}
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-medium capitalize">
                          {activity.type.replace('-', ' ')}
                        </span>
                        {activity.notes && (
                          <p className="text-xs text-muted-foreground">{activity.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Create Task Dialog */}
      <Dialog open={showCreateTaskDialog} onOpenChange={setShowCreateTaskDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
            <DialogDescription>
              Create a task linked to {opportunity.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Task Title *</Label>
              <Input
                value={newTask.title || ''}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                placeholder="Follow up call..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={newTask.priority || 'P1'}
                  onValueChange={(v) => setNewTask({ ...newTask, priority: v as Priority })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="P0">P0 - Urgent</SelectItem>
                    <SelectItem value="P1">P1 - High</SelectItem>
                    <SelectItem value="P2">P2 - Medium</SelectItem>
                    <SelectItem value="P3">P3 - Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <EditableDatePicker
                  value={newTask.dueDate}
                  onChange={(v) => setNewTask({ ...newTask, dueDate: v || '' })}
                  placeholder="Select due date"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={newTask.category || 'call'}
                onValueChange={(v) => setNewTask({ ...newTask, category: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="manual-email">Manual Email</SelectItem>
                  <SelectItem value="research">Research</SelectItem>
                  <SelectItem value="deck">Deck</SelectItem>
                  <SelectItem value="meeting-prep">Meeting Prep</SelectItem>
                  <SelectItem value="proposal">Proposal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateTaskDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateTask}>Create Task</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

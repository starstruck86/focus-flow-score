import { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import type { Priority, Workstream } from '@/types';
import { ListPlus, Zap } from 'lucide-react';
import { useLinkedRecordContext } from '@/contexts/LinkedRecordContext';

interface QuickAddTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickAddTaskModal({ open, onOpenChange }: QuickAddTaskModalProps) {
  const { addTask, accounts, opportunities } = useStore();
  const { currentRecord } = useLinkedRecordContext();
  
  const [title, setTitle] = useState('');
  const [workstream, setWorkstream] = useState<Workstream>('pg');
  const [priority, setPriority] = useState<Priority>('P1');
  const [dueDate, setDueDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [oppId, setOppId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setTitle('');
      setPriority('P1');
      setDueDate('');
      setNotes('');
      
      // Smart prefill from context
      if (currentRecord.type === 'account' && currentRecord.id) {
        setAccountId(currentRecord.id);
        setWorkstream('pg');
        setOppId('');
      } else if (currentRecord.type === 'opportunity' && currentRecord.id) {
        setOppId(currentRecord.id);
        setAccountId(currentRecord.accountId || '');
        // Determine workstream from opp
        const opp = opportunities.find(o => o.id === currentRecord.id);
        setWorkstream(opp?.dealType === 'renewal' ? 'renewals' : 'pg');
      } else {
        setAccountId('');
        setOppId('');
        setWorkstream('pg');
      }
    }
  }, [open, currentRecord, opportunities]);

  const accountOpps = accountId
    ? opportunities.filter(o => o.accountId === accountId)
    : [];

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error('Please enter a task title');
      return;
    }

    addTask({
      title: title.trim(),
      workstream,
      status: 'next',
      priority,
      dueDate: dueDate || undefined,
      linkedAccountId: accountId || undefined,
      linkedOpportunityId: oppId || undefined,
      notes: notes.trim() || undefined,
      motion: workstream === 'renewals' ? 'renewal' : 'new-logo',
      linkedRecordType: oppId ? 'opportunity' : (accountId ? 'account' : 'account'),
      linkedRecordId: oppId || accountId || '',
    } as any);

    toast.success('Task added', {
      description: title.trim(),
      action: {
        label: 'View',
        onClick: () => { window.location.href = '/tasks'; },
      },
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListPlus className="h-5 w-5 text-primary" />
            Quick Add Task
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title *</Label>
            <Input
              id="task-title"
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Workstream *</Label>
              <Select value={workstream} onValueChange={(v) => setWorkstream(v as Workstream)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pg">PG (New Logo)</SelectItem>
                  <SelectItem value="renewals">Renewals</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="P0">P0 - Critical</SelectItem>
                  <SelectItem value="P1">P1 - High</SelectItem>
                  <SelectItem value="P2">P2 - Medium</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Linked Account</Label>
            <Select value={accountId || '__none__'} onValueChange={(v) => {
              setAccountId(v === '__none__' ? '' : v);
              setOppId('');
            }}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {accounts.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {accountId && accountOpps.length > 0 && (
            <div className="space-y-2">
              <Label>Linked Opportunity</Label>
              <Select value={oppId || '__none__'} onValueChange={(v) => setOppId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {accountOpps.map(o => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Note</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Quick context..."
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} className="gap-2">
            <Zap className="h-4 w-4" />
            Add Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

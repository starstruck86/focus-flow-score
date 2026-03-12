import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import type { Priority, Workstream } from '@/types';

interface AddTaskDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultWorkstream: Workstream;
}

export function AddTaskDialog({ open, onOpenChange, defaultWorkstream }: AddTaskDialogProps) {
  const { addTask, accounts, opportunities, renewals } = useStore();
  
  // Merge accounts + renewal-only accounts (renewals without a linked account record)
  const allAccounts = (() => {
    const accountIds = new Set(accounts.map(a => a.id));
    const renewalOnlyAccounts = renewals
      .filter(r => !r.accountId || !accountIds.has(r.accountId))
      .map(r => ({ id: r.id, name: r.accountName, isRenewal: true }));
    const baseAccounts = accounts.map(a => ({ id: a.id, name: a.name, isRenewal: false }));
    // Deduplicate by name
    const seen = new Set<string>();
    return [...baseAccounts, ...renewalOnlyAccounts].filter(a => {
      const key = a.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  })();
  const [title, setTitle] = useState('');
  const [workstream, setWorkstream] = useState<Workstream>(defaultWorkstream);
  const [priority, setPriority] = useState<Priority>('P1');
  const [dueDate, setDueDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [oppId, setOppId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) { setWorkstream(defaultWorkstream); setTitle(''); setPriority('P1'); setDueDate(''); setAccountId(''); setOppId(''); setNotes(''); }
  }, [open, defaultWorkstream]);

  const accountOpps = accountId ? opportunities.filter(o => o.accountId === accountId) : [];

  const handleSubmit = () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    addTask({
      title: title.trim(), workstream, status: 'next', priority,
      dueDate: dueDate || undefined, linkedAccountId: accountId || undefined,
      linkedOpportunityId: oppId || undefined, notes: notes.trim() || undefined,
      motion: workstream === 'renewals' ? 'renewal' : 'new-logo',
      linkedRecordType: oppId ? 'opportunity' : (accountId ? 'account' : 'account'),
      linkedRecordId: oppId || accountId || '',
    } as any);
    toast.success('Task added');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Task</DialogTitle>
          <DialogDescription>Create a task for PG or Renewals.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Workstream</Label>
              <Select value={workstream} onValueChange={v => setWorkstream(v as Workstream)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pg">PG (New Logo)</SelectItem>
                  <SelectItem value="renewals">Renewals</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={v => setPriority(v as Priority)}>
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
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Linked Account</Label>
            <Select value={accountId || '__none__'} onValueChange={v => { setAccountId(v === '__none__' ? '' : v); setOppId(''); }}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {allAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}{a.isRenewal ? ' (Renewal)' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {accountId && accountOpps.length > 0 && (
            <div className="space-y-2">
              <Label>Linked Opportunity</Label>
              <Select value={oppId || '__none__'} onValueChange={v => setOppId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {accountOpps.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Note</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Quick context..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>Add Task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

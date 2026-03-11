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
import type { Task, Priority, TaskStatus, Workstream } from '@/types';
import { STATUS_ORDER, STATUS_META } from './constants';
import { getWorkstream } from './helpers';

interface TaskEditDialogProps {
  task: Task;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function TaskEditDialog({ task, open, onOpenChange }: TaskEditDialogProps) {
  const { updateTask, accounts, opportunities } = useStore();
  const [s, setS] = useState<Task>(task);

  useEffect(() => { if (open) setS({ ...task }); }, [open, task]);

  const accountOpps = s.linkedAccountId
    ? opportunities.filter(o => o.accountId === s.linkedAccountId)
    : [];

  const save = () => {
    const updates: Partial<Task> = {
      title: s.title, priority: s.priority, status: s.status,
      dueDate: s.dueDate, notes: s.notes, workstream: s.workstream,
      linkedAccountId: s.linkedAccountId, linkedOpportunityId: s.linkedOpportunityId,
    };
    if (s.status === 'done' && task.status !== 'done') updates.completedAt = new Date().toISOString();
    if (s.status !== 'done') updates.completedAt = undefined;
    updateTask(task.id, updates);
    onOpenChange(false);
    toast.success('Saved', { duration: 1500 });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
          <DialogDescription>Update task details.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={s.title} onChange={e => setS({ ...s, title: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Workstream</Label>
              <Select value={s.workstream || getWorkstream(s)} onValueChange={v => setS({ ...s, workstream: v as Workstream })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pg">PG (New Logo)</SelectItem>
                  <SelectItem value="renewals">Renewals</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={s.status} onValueChange={v => setS({ ...s, status: v as TaskStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_ORDER.map(st => <SelectItem key={st} value={st}>{STATUS_META[st].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={s.priority} onValueChange={v => setS({ ...s, priority: v as Priority })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="P0">P0 - Critical</SelectItem>
                  <SelectItem value="P1">P1 - High</SelectItem>
                  <SelectItem value="P2">P2 - Medium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input type="date" value={s.dueDate || ''} onChange={e => setS({ ...s, dueDate: e.target.value || undefined })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Linked Account</Label>
            <Select value={s.linkedAccountId || '__none__'} onValueChange={v => setS({
              ...s, linkedAccountId: v === '__none__' ? undefined : v,
              linkedOpportunityId: v === '__none__' ? undefined : s.linkedOpportunityId,
            })}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {s.linkedAccountId && accountOpps.length > 0 && (
            <div className="space-y-2">
              <Label>Linked Opportunity</Label>
              <Select value={s.linkedOpportunityId || '__none__'} onValueChange={v => setS({ ...s, linkedOpportunityId: v === '__none__' ? undefined : v })}>
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
            <Input value={s.notes || ''} onChange={e => setS({ ...s, notes: e.target.value || undefined })} placeholder="Quick context..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

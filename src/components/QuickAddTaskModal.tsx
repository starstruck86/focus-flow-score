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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LinkedRecordSelector } from '@/components/LinkedRecordSelector';
import { useStore } from '@/store/useStore';
import { useLinkedRecordContext } from '@/contexts/LinkedRecordContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { Motion, Priority, TaskCategory, LinkedRecordType } from '@/types';
import { ListPlus, Zap } from 'lucide-react';

interface QuickAddTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Optional prefill overrides
  prefillRecord?: { type: LinkedRecordType; id: string; accountId?: string };
  prefillMotion?: Motion;
}

export function QuickAddTaskModal({
  open,
  onOpenChange,
  prefillRecord,
  prefillMotion,
}: QuickAddTaskModalProps) {
  const { addTask } = useStore();
  const { currentRecord } = useLinkedRecordContext();
  
  // Form state
  const [title, setTitle] = useState('');
  const [linkedRecord, setLinkedRecord] = useState<{
    type: LinkedRecordType;
    id: string;
    accountId?: string;
    suggestedMotion?: Motion;
  } | null>(null);
  const [motion, setMotion] = useState<Motion>('new-logo');
  const [priority, setPriority] = useState<Priority>('P1');
  const [dueDate, setDueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [category, setCategory] = useState<TaskCategory | 'none'>('none');
  const [notes, setNotes] = useState('');
  
  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setTitle('');
      setNotes('');
      setPriority('P1');
      setDueDate(format(new Date(), 'yyyy-MM-dd'));
      setCategory('none');
      
      // Apply prefills in order of priority: explicit prefill > context
      if (prefillRecord) {
        setLinkedRecord({
          type: prefillRecord.type,
          id: prefillRecord.id,
          accountId: prefillRecord.accountId,
        });
        setMotion(prefillMotion || 'new-logo');
      } else if (currentRecord.type && currentRecord.id) {
        setLinkedRecord({
          type: currentRecord.type,
          id: currentRecord.id,
          accountId: currentRecord.accountId,
          suggestedMotion: currentRecord.suggestedMotion,
        });
        setMotion(currentRecord.suggestedMotion || 'new-logo');
      } else {
        setLinkedRecord(null);
        setMotion('new-logo');
      }
    }
  }, [open, prefillRecord, prefillMotion, currentRecord]);
  
  // Update motion when linked record changes
  const handleLinkedRecordChange = (value: {
    type: LinkedRecordType;
    id: string;
    accountId?: string;
    suggestedMotion?: Motion;
  } | null) => {
    setLinkedRecord(value);
    if (value?.suggestedMotion) {
      setMotion(value.suggestedMotion);
    }
  };
  
  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error('Please enter a task title');
      return;
    }
    
    if (!linkedRecord) {
      toast.error('Please select a linked record');
      return;
    }
    
    addTask({
      title: title.trim(),
      priority,
      dueDate,
      status: 'open',
      motion,
      linkedRecordType: linkedRecord.type,
      linkedRecordId: linkedRecord.id,
      linkedAccountId: linkedRecord.accountId,
      category: category === 'none' ? 'admin' : category,
      notes: notes.trim() || undefined,
      subtasks: [],
    });
    
    toast.success('Task added', {
      description: title.trim(),
      action: {
        label: 'View',
        onClick: () => {
          window.location.href = '/tasks';
        },
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
          {/* Title */}
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
          
          {/* Linked Record */}
          <div className="space-y-2">
            <Label>Linked Record *</Label>
            <LinkedRecordSelector
              value={linkedRecord ? { type: linkedRecord.type, id: linkedRecord.id } : undefined}
              onChange={handleLinkedRecordChange}
              placeholder="Select account or opportunity..."
            />
          </div>
          
          {/* Motion */}
          <div className="space-y-2">
            <Label>Motion</Label>
            <Select value={motion} onValueChange={(v) => setMotion(v as Motion)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new-logo">New Logo</SelectItem>
                <SelectItem value="renewal">Renewal</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Priority & Due Date Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="P0">P0 - Critical</SelectItem>
                  <SelectItem value="P1">P1 - High</SelectItem>
                  <SelectItem value="P2">P2 - Medium</SelectItem>
                  <SelectItem value="P3">P3 - Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          
          {/* Completion Type */}
          <div className="space-y-2">
            <Label>Completion Type</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as TaskCategory | 'none')}>
              <SelectTrigger>
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="manual-email">Manual Email</SelectItem>
                <SelectItem value="automated-email">Automated Email</SelectItem>
                <SelectItem value="research">Research</SelectItem>
                <SelectItem value="meeting-prep">Meeting Prep</SelectItem>
                <SelectItem value="deck">Deck</SelectItem>
                <SelectItem value="proposal">Proposal</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              placeholder="Optional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} className="gap-2">
            <Zap className="h-4 w-4" />
            Add Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

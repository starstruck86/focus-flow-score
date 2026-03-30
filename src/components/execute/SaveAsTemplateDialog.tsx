import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateTemplate } from '@/hooks/useExecutionTemplates';
import { OUTPUT_TYPES, OUTPUT_TYPE_LABELS } from '@/lib/executionTemplateTypes';
import type { OutputType } from '@/lib/executionTemplateTypes';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialBody: string;
  initialSubject?: string;
  initialOutputType?: OutputType;
  initialTitle?: string;
}

export function SaveAsTemplateDialog({ open, onOpenChange, initialBody, initialSubject, initialOutputType, initialTitle }: Props) {
  const [title, setTitle] = useState(initialTitle || '');
  const [outputType, setOutputType] = useState<OutputType>(initialOutputType || 'custom');
  const create = useCreateTemplate();

  const handleSave = () => {
    if (!title.trim()) { toast.error('Title required'); return; }
    create.mutate({
      title: title.trim(),
      body: initialBody,
      subject_line: initialSubject || null,
      output_type: outputType,
      template_type: 'email',
      template_origin: 'uploaded',
    }, {
      onSuccess: () => { toast.success('Template saved'); onOpenChange(false); },
      onError: () => toast.error('Failed to save template'),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save as Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. My Best Demo Follow-Up" />
          </div>
          <div>
            <Label className="text-xs">Output Type</Label>
            <Select value={outputType} onValueChange={v => setOutputType(v as OutputType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OUTPUT_TYPES.map(t => (
                  <SelectItem key={t} value={t}>{OUTPUT_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Save Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

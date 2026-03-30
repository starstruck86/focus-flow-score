import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateTemplate } from '@/hooks/useExecutionTemplates';
import { OUTPUT_TYPES, OUTPUT_TYPE_LABELS } from '@/lib/executionTemplateTypes';
import type { OutputType } from '@/lib/executionTemplateTypes';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function UploadTemplateDialog({ open, onOpenChange }: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [subjectLine, setSubjectLine] = useState('');
  const [outputType, setOutputType] = useState<OutputType>('custom');
  const create = useCreateTemplate();

  const handleFileRead = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBody(text);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
  };

  const handleSave = () => {
    if (!title.trim() || !body.trim()) {
      toast.error('Title and body are required');
      return;
    }
    create.mutate({
      title: title.trim(),
      body: body.trim(),
      subject_line: subjectLine.trim() || null,
      output_type: outputType,
      template_type: 'email',
      template_origin: 'uploaded',
    }, {
      onSuccess: () => {
        toast.success('Template uploaded');
        onOpenChange(false);
        setTitle(''); setBody(''); setSubjectLine('');
      },
      onError: () => toast.error('Failed to upload'),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" /> Upload Template
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Upload a file (txt, doc, md)</Label>
            <Input type="file" accept=".txt,.md,.doc,.docx,.pdf" onChange={handleFileRead} />
          </div>
          <div>
            <Label className="text-xs">Or paste content</Label>
            <Textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              placeholder="Paste your email, prep sheet, cadence, or template text here…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Template name" />
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
          <div>
            <Label className="text-xs">Subject Line (optional)</Label>
            <Input value={subjectLine} onChange={e => setSubjectLine(e.target.value)} placeholder="Email subject line" />
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

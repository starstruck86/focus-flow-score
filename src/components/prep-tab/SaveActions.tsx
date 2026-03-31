/**
 * Save dialog for Prep outputs — supports Output, Template, or Example.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Save, FileText, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { useSaveOutput } from '@/hooks/useExecutionOutputs';
import { useCreateTemplate } from '@/hooks/useExecutionTemplates';
import { useAuth } from '@/contexts/AuthContext';
import { trackActionizationFeedback } from '@/lib/actionizationEngine';

const USE_CASES = [
  'Discovery',
  'Demo',
  'Pricing / ROI',
  'Procurement / Legal / IT',
  'Closing',
  'Outbound',
  'Follow-up / Recap',
  'Competitive',
  'Executive / CFO / Finance',
] as const;

type SaveMode = 'output' | 'template' | 'example';

interface Props {
  output: string;
  subjectLine: string;
  actionLabel: string;
  accountName?: string;
}

export function SaveActions({ output, subjectLine, actionLabel, accountName }: Props) {
  const { user } = useAuth();
  const [mode, setMode] = useState<SaveMode | null>(null);
  const [name, setName] = useState('');
  const [useCase, setUseCase] = useState('');
  const [notes, setNotes] = useState('');

  const saveOutput = useSaveOutput();
  const createTemplate = useCreateTemplate();

  if (!output) return null;

  const handleOpen = (m: SaveMode) => {
    setMode(m);
    const defaultName = `${actionLabel}${accountName ? ` — ${accountName}` : ''} (${new Date().toLocaleDateString()})`;
    setName(defaultName);
    setUseCase('');
    setNotes('');
  };

  const handleSave = () => {
    if (!name.trim()) { toast.error('Name is required'); return; }

    if (mode === 'output') {
      saveOutput.mutate({
        title: name,
        output_type: 'custom',
        content: output,
        subject_line: subjectLine || null,
        account_name: accountName || null,
        custom_instructions: notes || null,
      }, {
        onSuccess: () => { toast.success('Output saved'); setMode(null); },
        onError: () => toast.error('Save failed'),
      });
    } else if (mode === 'template') {
      createTemplate.mutate({
        title: name,
        body: output,
        output_type: 'custom',
        template_type: 'other',
        subject_line: subjectLine || null,
        template_origin: 'promoted_from_output' as any,
        status: 'active',
        use_case: useCase || null,
        tags: useCase ? [useCase.toLowerCase()] : [],
      }, {
        onSuccess: () => {
          toast.success('Saved as Template');
          setMode(null);
          if (user) trackActionizationFeedback(user.id, { outputId: 'save', tacticsUsed: [], promptsUsed: [], templatesUsed: [], action: 'saved_as_template' });
        },
        onError: () => toast.error('Save failed'),
      });
    } else if (mode === 'example') {
      saveOutput.mutate({
        title: name,
        output_type: 'custom',
        content: output,
        subject_line: subjectLine || null,
        account_name: accountName || null,
        is_strong_example: true,
        custom_instructions: notes || null,
      }, {
        onSuccess: () => { toast.success('Saved as Example'); setMode(null); },
        onError: () => toast.error('Save failed'),
      });
    }
  };

  const needsTagging = mode === 'template' || mode === 'example';

  return (
    <>
      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-[10px] font-medium text-muted-foreground">Save this output</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleOpen('output')}>
            <Save className="h-3 w-3 mr-1" /> Save Output
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleOpen('template')}>
            <FileText className="h-3 w-3 mr-1" /> Save as Template
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleOpen('example')}>
            <Star className="h-3 w-3 mr-1" /> Save as Example
          </Button>
        </div>
      </div>

      <Dialog open={mode !== null} onOpenChange={open => { if (!open) setMode(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {mode === 'output' ? 'Save Output' : mode === 'template' ? 'Save as Template' : 'Save as Example'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="text-sm" autoFocus />
            </div>

            {needsTagging && (
              <div>
                <Label className="text-xs">Use Case</Label>
                <Select value={useCase} onValueChange={setUseCase}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select use case" />
                  </SelectTrigger>
                  <SelectContent>
                    {USE_CASES.map(uc => (
                      <SelectItem key={uc} value={uc}>{uc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                className="text-xs"
                placeholder="Why this is useful, when to use it…"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setMode(null)}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={!name.trim()}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

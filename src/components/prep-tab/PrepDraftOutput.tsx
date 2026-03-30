import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Save, Copy, RotateCcw, FileText, Star, BookOpen, Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSaveOutput, usePromoteOutputToTemplate } from '@/hooks/useExecutionOutputs';
import { useCreateTemplate } from '@/hooks/useExecutionTemplates';
import type { OutputType } from '@/lib/executionTemplateTypes';
import { OUTPUT_TYPE_LABELS } from '@/lib/executionTemplateTypes';

interface Props {
  draft: string;
  onDraftChange: (v: string) => void;
  subjectLine: string;
  onSubjectChange: (v: string) => void;
  outputType: OutputType;
  accountName?: string;
  sources: string[];
  onRegenerate: () => void;
  isGenerating: boolean;
}

export function PrepDraftOutput({
  draft, onDraftChange, subjectLine, onSubjectChange,
  outputType, accountName, sources, onRegenerate, isGenerating,
}: Props) {
  const saveOutput = useSaveOutput();
  const createTemplate = useCreateTemplate();
  const promoteOutput = usePromoteOutputToTemplate();

  const handleCopy = () => {
    const text = subjectLine ? `Subject: ${subjectLine}\n\n${draft}` : draft;
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const handleSaveAs = async (role: 'template' | 'example' | 'reference' | 'working_asset') => {
    if (!draft.trim()) return;

    const title = `${OUTPUT_TYPE_LABELS[outputType]}${accountName ? ` — ${accountName}` : ''} (${new Date().toLocaleDateString()})`;

    if (role === 'template') {
      createTemplate.mutate({
        title,
        body: draft,
        output_type: outputType,
        template_type: 'email',
        subject_line: subjectLine || null,
        template_origin: 'promoted_from_output' as any,
        status: 'active',
      }, {
        onSuccess: () => toast.success('Saved as Template'),
        onError: () => toast.error('Save failed'),
      });
    } else {
      saveOutput.mutate({
        title,
        output_type: outputType,
        content: draft,
        subject_line: subjectLine || null,
        account_name: accountName || null,
        is_strong_example: role === 'example',
      }, {
        onSuccess: () => toast.success(`Saved as ${role === 'example' ? 'Example' : role === 'reference' ? 'Reference' : 'Working Asset'}`),
        onError: () => toast.error('Save failed'),
      });
    }
  };

  if (!draft && !isGenerating) return null;

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Draft</CardTitle>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={handleCopy} disabled={!draft}>
              <Copy className="h-3 w-3 mr-1" /> Copy
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onRegenerate} disabled={isGenerating}>
              <RotateCcw className="h-3 w-3 mr-1" /> Regenerate
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {subjectLine && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Subject</Label>
            <Input
              value={subjectLine}
              onChange={e => onSubjectChange(e.target.value)}
              className="h-8 text-sm font-medium"
            />
          </div>
        )}

        <Textarea
          value={draft}
          onChange={e => onDraftChange(e.target.value)}
          rows={14}
          placeholder={isGenerating ? 'Generating…' : ''}
          className="text-sm"
        />

        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-[9px] text-muted-foreground">Sources:</span>
            {sources.map((s, i) => (
              <Badge key={i} variant="outline" className="text-[9px]">{s}</Badge>
            ))}
          </div>
        )}

        {/* Save-back loop */}
        {draft && (
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-[10px] font-medium text-muted-foreground">Save this output as:</p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => handleSaveAs('template')}>
                <FileText className="h-3 w-3 mr-1" /> Template
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => handleSaveAs('example')}>
                <Star className="h-3 w-3 mr-1" /> Example
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => handleSaveAs('reference')}>
                <BookOpen className="h-3 w-3 mr-1" /> Reference
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => handleSaveAs('working_asset')}>
                <Briefcase className="h-3 w-3 mr-1" /> Working Asset
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

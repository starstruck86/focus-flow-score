import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Loader2, Search, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useAllResources } from '@/hooks/useResources';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface AIGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: (markdown: string) => void;
  accountContext?: { name: string; industry?: string; contacts?: string; dealStage?: string } | null;
  sourceResourceId?: string | null;
  initialPrompt?: string;
  initialOutputType?: string;
}

const OUTPUT_TYPES = [
  { value: 'document', label: 'Document' },
  { value: 'email', label: 'Email' },
  { value: 'presentation', label: 'Presentation Outline' },
  { value: 'prep', label: 'Prep Brief' },
  { value: 'battlecard', label: 'Battlecard' },
  { value: 'scorecard', label: 'Scorecard / Rubric' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'cadence', label: 'Outreach Cadence' },
  { value: 'training_guide', label: 'Training Guide' },
  { value: 'one_pager', label: 'One-Pager' },
];

export function AIGenerateDialog({ open, onOpenChange, onGenerated, accountContext, sourceResourceId, initialPrompt, initialOutputType }: AIGenerateDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [outputType, setOutputType] = useState('document');
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [resourceSearch, setResourceSearch] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const { data: allResources = [] } = useAllResources();

  // Reset and apply initial values when dialog opens
  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt || '');
      setOutputType(initialOutputType || 'document');
      setSelectedResourceIds(sourceResourceId ? [sourceResourceId] : []);
      setResourceSearch('');
    }
  }, [open, initialPrompt, initialOutputType, sourceResourceId]);

  const isTransformMode = !!sourceResourceId && ['scorecard', 'checklist', 'cadence', 'training_guide', 'one_pager'].includes(outputType);

  const filteredResources = allResources.filter(r =>
    r.title.toLowerCase().includes(resourceSearch.toLowerCase()) && r.content
  );

  const toggleResource = (id: string) => {
    setSelectedResourceIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, 5 > prev.length ? id : prev[0]]
    );
  };

  const handleGenerate = async () => {
    if (!prompt.trim() && !isTransformMode) { toast.error('Enter a prompt'); return; }
    setIsGenerating(true);

    try {
      const body: Record<string, any> = isTransformMode
        ? {
            type: 'transform',
            sourceResourceId,
            targetType: outputType,
            prompt: prompt || undefined,
            resourceIds: selectedResourceIds.filter(id => id !== sourceResourceId),
            accountContext,
          }
        : {
            type: 'generate',
            prompt,
            outputType,
            resourceIds: selectedResourceIds,
            accountContext,
          };

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/build-resource`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Error ${resp.status}`);
      }

      // Stream response
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No stream');
      const decoder = new TextDecoder();
      let result = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (json === '[DONE]') break;
          try {
            const parsed = JSON.parse(json);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) result += content;
          } catch { /* partial */ }
        }
      }

      onGenerated(result);
      onOpenChange(false);
      setPrompt('');
      setSelectedResourceIds([]);
      toast.success('Content generated');
    } catch (e: any) {
      toast.error(e.message || 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {isTransformMode ? 'Transform Resource' : 'AI Document Generator'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {isTransformMode ? 'Additional instructions (optional)' : 'What do you want to create?'}
            </label>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder={isTransformMode
                ? "e.g., Focus on enterprise SaaS scenarios, include scoring examples..."
                : "e.g., Write a discovery prep brief for our upcoming call with the VP of Marketing..."
              }
              className="min-h-[100px] text-sm"
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Output Type</label>
              <Select value={outputType} onValueChange={setOutputType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OUTPUT_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {accountContext && (
              <div className="flex items-end">
                <Badge variant="secondary" className="text-[10px] h-8 px-2">
                  🏢 {accountContext.name}
                </Badge>
              </div>
            )}
          </div>

          {!isTransformMode && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Include resources as context ({selectedResourceIds.length}/5)
              </label>
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={resourceSearch}
                  onChange={e => setResourceSearch(e.target.value)}
                  placeholder="Search resources..."
                  className="h-7 text-xs pl-7"
                />
              </div>
              <ScrollArea className="h-[140px] border rounded-md">
                <div className="p-1.5 space-y-0.5">
                  {filteredResources.slice(0, 20).map(r => (
                    <button
                      key={r.id}
                      onClick={() => toggleResource(r.id)}
                      className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent/50 transition-colors"
                    >
                      <div className={`h-3.5 w-3.5 rounded border flex items-center justify-center ${selectedResourceIds.includes(r.id) ? 'bg-primary border-primary' : 'border-border'}`}>
                        {selectedResourceIds.includes(r.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </div>
                      <span className="truncate flex-1">{r.title}</span>
                      <Badge variant="outline" className="text-[9px] shrink-0">{r.resource_type}</Badge>
                    </button>
                  ))}
                  {filteredResources.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No resources found</p>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleGenerate} disabled={isGenerating || (!prompt.trim() && !isTransformMode)}>
              {isGenerating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              {isTransformMode ? 'Transform' : 'Generate'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

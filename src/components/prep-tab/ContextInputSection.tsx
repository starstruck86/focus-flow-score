import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  accounts: { id: string; name: string }[];
  accountId: string;
  onAccountChange: (id: string) => void;
  stage: string;
  onStageChange: (v: string) => void;
  persona: string;
  onPersonaChange: (v: string) => void;
  competitor: string;
  onCompetitorChange: (v: string) => void;
  contextText: string;
  onContextTextChange: (v: string) => void;
}

export function ContextInputSection({
  accounts, accountId, onAccountChange,
  stage, onStageChange, persona, onPersonaChange,
  competitor, onCompetitorChange,
  contextText, onContextTextChange,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const textParts: string[] = [];

    for (const file of files) {
      if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        const text = await file.text();
        textParts.push(`--- ${file.name} ---\n${text}`);
      } else {
        textParts.push(`[File: ${file.name} (${file.type || 'unknown type'})]`);
      }
    }

    // Also check for dropped text
    const droppedText = e.dataTransfer.getData('text/plain');
    if (droppedText) textParts.push(droppedText);

    if (textParts.length) {
      onContextTextChange((contextText ? contextText + '\n\n' : '') + textParts.join('\n\n'));
    }
  }, [contextText, onContextTextChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Default paste behavior is fine for text
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Deal Context</h3>

      {/* Context fields */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">Account</Label>
          <Select
            value={accountId || '__none__'}
            onValueChange={v => onAccountChange(v === '__none__' ? '' : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Stage</Label>
          <Input value={stage} onChange={e => onStageChange(e.target.value)} placeholder="e.g. Discovery" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Persona</Label>
          <Input value={persona} onChange={e => onPersonaChange(e.target.value)} placeholder="e.g. VP Marketing" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Competitor</Label>
          <Input value={competitor} onChange={e => onCompetitorChange(e.target.value)} placeholder="e.g. Klaviyo" className="h-8 text-xs" />
        </div>
      </div>

      {/* Drag & drop / paste area */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'relative rounded-lg border-2 border-dashed transition-colors',
          isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/20 hover:border-muted-foreground/40'
        )}
      >
        {!contextText ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Upload className="h-6 w-6 mb-2 opacity-50" />
            <p className="text-xs font-medium">Add context</p>
            <p className="text-[10px] mt-0.5">Drop files, paste transcripts, screenshots, notes, emails…</p>
          </div>
        ) : (
          <div className="p-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              <FileText className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground">Context added</span>
            </div>
            <Textarea
              value={contextText}
              onChange={e => onContextTextChange(e.target.value)}
              onPaste={handlePaste}
              rows={4}
              className="text-xs border-0 p-0 focus-visible:ring-0 resize-none"
              placeholder="Paste or type additional context…"
            />
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Upload, FileText, Image, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContextItem } from './contextTypes';
import { createId } from './contextTypes';

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
  contextItems: ContextItem[];
  onContextItemsChange: (items: ContextItem[]) => void;
}

export function ContextInputSection({
  accounts, accountId, onAccountChange,
  stage, onStageChange, persona, onPersonaChange,
  competitor, onCompetitorChange,
  contextItems, onContextItemsChange,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (files: File[]) => {
    const newItems: ContextItem[] = [];

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        newItems.push({
          id: createId(),
          label: file.name,
          type: 'image',
          content: `[Image: ${file.name}]`,
          fileName: file.name,
          mimeType: file.type,
          previewUrl: url,
        });
      } else if (
        file.type.startsWith('text/') ||
        file.name.endsWith('.txt') ||
        file.name.endsWith('.md') ||
        file.name.endsWith('.csv')
      ) {
        const text = await file.text();
        newItems.push({
          id: createId(),
          label: file.name,
          type: 'file',
          content: text,
          fileName: file.name,
          mimeType: file.type,
        });
      } else if (
        file.type === 'application/pdf' ||
        file.name.endsWith('.pdf') ||
        file.name.endsWith('.docx') ||
        file.name.endsWith('.pptx')
      ) {
        // For PDFs/docs — store as attached context asset
        newItems.push({
          id: createId(),
          label: file.name,
          type: 'file',
          content: `[Document attached: ${file.name}]`,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        });
      } else {
        newItems.push({
          id: createId(),
          label: file.name,
          type: 'file',
          content: `[File: ${file.name} (${file.type || 'unknown'})]`,
          fileName: file.name,
          mimeType: file.type,
        });
      }
    }

    onContextItemsChange([...contextItems, ...newItems]);
  }, [contextItems, onContextItemsChange]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      await processFiles(files);
      return;
    }

    const droppedText = e.dataTransfer.getData('text/plain');
    if (droppedText) {
      onContextItemsChange([...contextItems, {
        id: createId(),
        label: 'Pasted text',
        type: 'text',
        content: droppedText,
      }]);
    }
  }, [contextItems, onContextItemsChange, processFiles]);

  const handleAddText = () => {
    if (!pasteText.trim()) return;
    onContextItemsChange([...contextItems, {
      id: createId(),
      label: `Note (${pasteText.slice(0, 30).trim()}…)`,
      type: 'text',
      content: pasteText,
    }]);
    setPasteText('');
    setShowTextInput(false);
  };

  const handleRemoveItem = (id: string) => {
    const item = contextItems.find(i => i.id === id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    onContextItemsChange(contextItems.filter(i => i.id !== id));
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Deal Context</h3>

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
        {stage && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Stage</Label>
            <Input value={stage} readOnly className="h-8 text-xs bg-muted/50 cursor-default" />
          </div>
        )}
        <div>
          <Label className="text-[10px] text-muted-foreground">Persona</Label>
          <Input value={persona} onChange={e => onPersonaChange(e.target.value)} placeholder="e.g. VP Marketing" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Competitor</Label>
          <Input value={competitor} onChange={e => onCompetitorChange(e.target.value)} placeholder="e.g. Klaviyo" className="h-8 text-xs" />
        </div>
      </div>

      {/* Drop zone + context items */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'rounded-lg border-2 border-dashed transition-colors',
          isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/20 hover:border-muted-foreground/40'
        )}
      >
        {contextItems.length === 0 && !showTextInput ? (
          <div
            className="flex flex-col items-center justify-center py-6 text-muted-foreground cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-5 w-5 mb-1.5 opacity-50" />
            <p className="text-xs font-medium">Add context</p>
            <p className="text-[10px] mt-0.5">Drop files, paste transcripts, screenshots, notes, emails…</p>
          </div>
        ) : (
          <div className="p-2.5 space-y-2">
            {/* Context chips */}
            <div className="flex flex-wrap gap-1.5">
              {contextItems.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/60 border border-border text-xs group"
                >
                  {item.type === 'image' ? (
                    <>
                      {item.previewUrl && (
                        <img src={item.previewUrl} alt="" className="h-4 w-4 rounded object-cover" />
                      )}
                      <Image className="h-3 w-3 text-muted-foreground" />
                    </>
                  ) : (
                    <FileText className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span className="max-w-[120px] truncate">{item.label}</span>
                  <button
                    onClick={() => handleRemoveItem(item.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}

              {/* Add more buttons */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-muted-foreground/30 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" /> File
              </button>
              <button
                onClick={() => setShowTextInput(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-muted-foreground/30 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" /> Text
              </button>
            </div>

            {/* Inline text input */}
            {showTextInput && (
              <div className="space-y-1.5">
                <Textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  rows={3}
                  placeholder="Paste transcript, notes, email content…"
                  className="text-xs"
                  autoFocus
                />
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-6 text-[10px]" onClick={handleAddText} disabled={!pasteText.trim()}>
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setShowTextInput(false); setPasteText(''); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={async e => {
          if (e.target.files?.length) {
            await processFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
    </div>
  );
}

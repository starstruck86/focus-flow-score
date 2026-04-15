/**
 * CommandOutput — structured block-based output with copy, regenerate, save-as-template.
 * Renders output in distinct sections, not as one blob.
 */
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Copy, RotateCcw, BookmarkPlus, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import type { OutputBlock } from '@/lib/commandTypes';

interface Props {
  output: string;
  blocks: OutputBlock[];
  subjectLine?: string;
  sources: string[];
  kiCount: number;
  templateName?: string;
  isGenerating: boolean;
  onRegenerate: () => void;
  onSaveAsTemplate: (name: string) => void;
}

export function CommandOutput({
  output, blocks, subjectLine, sources, kiCount, templateName,
  isGenerating, onRegenerate, onSaveAsTemplate,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedOutput, setEditedOutput] = useState(output);
  const [copied, setCopied] = useState(false);
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSources, setShowSources] = useState(false);

  if (output !== editedOutput && !isEditing) {
    setEditedOutput(output);
  }

  const displayOutput = isEditing ? editedOutput : output;

  const handleCopy = useCallback(() => {
    const text = subjectLine ? `Subject: ${subjectLine}\n\n${displayOutput}` : displayOutput;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }, [displayOutput, subjectLine]);

  const handleCopyBlock = useCallback((heading: string, content: string) => {
    navigator.clipboard.writeText(`## ${heading}\n${content}`);
    setCopiedBlock(heading);
    setTimeout(() => setCopiedBlock(null), 2000);
  }, []);

  const handleSave = useCallback(() => {
    if (!saveName.trim()) return;
    onSaveAsTemplate(saveName.trim());
    setShowSaveDialog(false);
    setSaveName('');
  }, [saveName, onSaveAsTemplate]);

  if (!output && !isGenerating) return null;

  const hasBlocks = blocks.length > 1;

  return (
    <div className="space-y-3 animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {templateName && (
            <span className="text-xs font-medium text-primary">{templateName}</span>
          )}
          {kiCount > 0 && (
            <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {kiCount} KIs applied
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setIsEditing(!isEditing)}>
            {isEditing ? 'Preview' : 'Edit'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
            {copied ? 'Copied' : 'Copy All'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onRegenerate} disabled={isGenerating}>
            <RotateCcw className={cn('h-3.5 w-3.5 mr-1', isGenerating && 'animate-spin')} />
            Regenerate
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowSaveDialog(true)}>
            <BookmarkPlus className="h-3.5 w-3.5 mr-1" />
            Save as Template
          </Button>
        </div>
      </div>

      {/* Subject line */}
      {subjectLine && (
        <div className="px-4 py-2 rounded-lg bg-muted/50 border border-border">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Subject</span>
          <p className="text-sm font-medium text-foreground mt-0.5">{subjectLine}</p>
        </div>
      )}

      {/* Output body — structured blocks or single blob */}
      {isGenerating ? (
        <div className="rounded-xl border border-border bg-card p-8">
          <div className="flex items-center gap-2 text-muted-foreground justify-center">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse [animation-delay:150ms]" />
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse [animation-delay:300ms]" />
            <span className="text-sm ml-2">Generating...</span>
          </div>
        </div>
      ) : isEditing ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <Textarea
            value={editedOutput}
            onChange={e => setEditedOutput(e.target.value)}
            className="min-h-[400px] border-0 rounded-none text-sm font-mono resize-y focus-visible:ring-0"
          />
        </div>
      ) : hasBlocks ? (
        <div className="space-y-2">
          {blocks.map((block, i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden group">
              {block.heading && (
                <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
                  <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                    {block.heading}
                  </h3>
                  <button
                    onClick={() => handleCopyBlock(block.heading, block.content)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {copiedBlock === block.heading ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    )}
                  </button>
                </div>
              )}
              <div className="p-4 prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{block.content}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-5 prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{displayOutput}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Sources */}
      {sources.length > 0 && (
        <button
          onClick={() => setShowSources(!showSources)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showSources ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {sources.length} source{sources.length > 1 ? 's' : ''} used
        </button>
      )}
      {showSources && sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sources.map((s, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{s}</span>
          ))}
        </div>
      )}

      {/* Save as template dialog */}
      {showSaveDialog && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
          <Input
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            placeholder="Template name..."
            className="h-8 text-sm flex-1"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <Button size="sm" onClick={handleSave} disabled={!saveName.trim()} className="h-8">Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowSaveDialog(false)} className="h-8">Cancel</Button>
        </div>
      )}
    </div>
  );
}

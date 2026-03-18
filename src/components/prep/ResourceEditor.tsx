import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ArrowLeft, Save, Clock, Download, FileText, Sparkles, Bold, Italic,
  List, ListOrdered, Heading1, Heading2, Link, Quote, Code, Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUpdateResource, type Resource } from '@/hooks/useResources';
import { useCopilot } from '@/contexts/CopilotContext';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ResourceEditorProps {
  resource: Resource;
  onBack: () => void;
  onViewVersions: () => void;
}

const TOOLBAR_ACTIONS = [
  { icon: Bold, label: 'Bold', prefix: '**', suffix: '**' },
  { icon: Italic, label: 'Italic', prefix: '_', suffix: '_' },
  { icon: Heading1, label: 'Heading 1', prefix: '# ', suffix: '' },
  { icon: Heading2, label: 'Heading 2', prefix: '## ', suffix: '' },
  { icon: List, label: 'Bullet List', prefix: '- ', suffix: '' },
  { icon: ListOrdered, label: 'Numbered List', prefix: '1. ', suffix: '' },
  { icon: Quote, label: 'Quote', prefix: '> ', suffix: '' },
  { icon: Code, label: 'Code', prefix: '`', suffix: '`' },
  { icon: Link, label: 'Link', prefix: '[', suffix: '](url)' },
  { icon: Minus, label: 'Divider', prefix: '\n---\n', suffix: '' },
];

export function ResourceEditor({ resource, onBack, onViewVersions }: ResourceEditorProps) {
  const [title, setTitle] = useState(resource.title);
  const [content, setContent] = useState(resource.content || '');
  const [showPreview, setShowPreview] = useState(false);
  const [showSaveVersion, setShowSaveVersion] = useState(false);
  const [changeSummary, setChangeSummary] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const updateResource = useUpdateResource();
  const { ask: askCopilot } = useCopilot();

  useEffect(() => {
    setHasChanges(title !== resource.title || content !== (resource.content || ''));
  }, [title, content, resource]);

  const handleSave = useCallback(() => {
    updateResource.mutate({ id: resource.id, updates: { title, content } });
    setHasChanges(false);
    toast.success('Saved');
  }, [resource.id, title, content, updateResource]);

  const handleSaveVersion = useCallback(() => {
    updateResource.mutate({
      id: resource.id,
      updates: { title, content },
      createVersion: { change_summary: changeSummary || undefined },
    });
    setHasChanges(false);
    setShowSaveVersion(false);
    setChangeSummary('');
    toast.success('Version saved');
  }, [resource.id, title, content, changeSummary, updateResource]);

  const insertMarkdown = useCallback((prefix: string, suffix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.substring(start, end);
    const newContent = content.substring(0, start) + prefix + selected + suffix + content.substring(end);
    setContent(newContent);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  }, [content]);

  const handleAiEnhance = useCallback(async () => {
    if (!content.trim()) {
      toast.error('Add some content first');
      return;
    }
    setIsAiGenerating(true);
    askCopilot(
      `Improve and enhance this ${resource.resource_type} document. Make it more professional, well-structured, and actionable. Keep the same topic and key points but elevate the quality:\n\n${content}`,
      'recap-email'
    );
    setIsAiGenerating(false);
  }, [content, resource.resource_type, askCopilot]);

  const handleExportPdf = useCallback(() => {
    // Create a printable window with the content
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html><head><title>${title}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1a1a1a; }
        h1 { font-size: 24px; margin-bottom: 8px; }
        h2 { font-size: 20px; margin-top: 24px; }
        h3 { font-size: 16px; margin-top: 20px; }
        table { border-collapse: collapse; width: 100%; margin: 16px 0; }
        th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
        th { background: #f5f5f5; }
        blockquote { border-left: 3px solid #ddd; margin: 16px 0; padding: 8px 16px; color: #666; }
        code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 14px; }
        pre { background: #f5f5f5; padding: 16px; border-radius: 6px; overflow-x: auto; }
        hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
      </style></head>
      <body><h1>${title}</h1><div id="content"></div></body></html>
    `);
    // Simple markdown to HTML (basic)
    const html = content
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/---/g, '<hr />')
      .replace(/\n/g, '<br />');
    printWindow.document.getElementById('content')!.innerHTML = html;
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
    toast.success('PDF export opened — use your browser\'s print dialog');
  }, [title, content]);

  // Auto-save on Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" className="h-8" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="flex-1 min-w-[200px] h-8 text-sm font-medium border-0 bg-transparent focus-visible:ring-1 px-2"
        />
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">v{resource.current_version}</Badge>
          <Badge variant="secondary" className="text-[10px] capitalize">{resource.resource_type}</Badge>
          {resource.is_template && <Badge className="text-[10px] bg-primary/20 text-primary">Template</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onViewVersions}>
            <Clock className="h-3.5 w-3.5 mr-1" /> History
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleExportPdf}>
            <Download className="h-3.5 w-3.5 mr-1" /> PDF
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleAiEnhance} disabled={isAiGenerating}>
            <Sparkles className="h-3.5 w-3.5 mr-1" /> Enhance
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowSaveVersion(true)} disabled={!hasChanges}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save Version
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!hasChanges}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
        </div>
      </div>

      {/* Formatting toolbar */}
      <div className="flex items-center gap-0.5 border-b border-border pb-2">
        {TOOLBAR_ACTIONS.map(action => (
          <Button
            key={action.label}
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={action.label}
            onClick={() => insertMarkdown(action.prefix, action.suffix)}
          >
            <action.icon className="h-3.5 w-3.5" />
          </Button>
        ))}
        <div className="ml-auto">
          <Button
            variant={showPreview ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? 'Edit' : 'Preview'}
          </Button>
        </div>
      </div>

      {/* Editor / Preview */}
      {showPreview ? (
        <div className="prose prose-sm dark:prose-invert max-w-none min-h-[500px] p-4 border rounded-lg bg-card">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Start writing... (Markdown supported)"
          className="min-h-[500px] text-sm font-mono resize-none"
        />
      )}

      {/* Save Version Dialog */}
      <Dialog open={showSaveVersion} onOpenChange={setShowSaveVersion}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Save New Version</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              This will create version {(resource.current_version || 0) + 1} of this resource.
            </p>
            <Input
              value={changeSummary}
              onChange={e => setChangeSummary(e.target.value)}
              placeholder="What changed? (optional)"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSaveVersion()}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowSaveVersion(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSaveVersion}>Save Version</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

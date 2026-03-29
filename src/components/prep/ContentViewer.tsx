/**
 * ContentViewer — Full-screen modal to view resource content/transcripts.
 * Mobile: full-screen sheet. Desktop: large dialog.
 * Includes copy, monospace toggle, metadata display.
 */
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Copy, Check, FileText, Loader2, ArrowLeft, ArrowUp, Code } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Resource } from '@/hooks/useResources';

interface Props {
  resource: Resource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RESOLUTION_LABELS: Record<string, string> = {
  metadata_only: 'Metadata Only',
  manual_transcript_paste: 'Manual Transcript',
  manual_paste: 'Manual Content',
  transcript_upload: 'Uploaded Transcript',
  content_upload: 'Uploaded Content',
  alternate_url: 'Alternate URL',
  fixed_from_existing_content: 'Fixed From Existing Content',
  manual_content: 'Manual Content',
};

export function ContentViewer({ resource, open, onOpenChange }: Props) {
  const isMobile = useIsMobile();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [monospace, setMonospace] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Lazy-load content on open
  useEffect(() => {
    if (!open) {
      setContent(null);
      return;
    }
    if (resource.content && resource.content.length > 0) {
      setContent(resource.content);
      return;
    }
    setLoading(true);
    (supabase
      .from('resources')
      .select('content')
      .eq('id', resource.id)
      .single() as any)
      .then(({ data }: any) => {
        setContent(data?.content ?? '');
      })
      .finally(() => setLoading(false));
  }, [open, resource.id, resource.content]);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const contentLength = content?.length ?? (resource as any).content_length ?? 0;
  const rm = (resource as any).resolution_method;
  const em = (resource as any).extraction_method;
  const resolutionLabel = rm ? (RESOLUTION_LABELS[rm] || rm.replace(/_/g, ' ')) : null;
  const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;
  const updatedAt = resource.updated_at ? new Date(resource.updated_at).toLocaleDateString() : null;

  const headerContent = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isMobile && (
          <Button variant="ghost" size="sm" className="h-11 w-11 p-0 shrink-0" onClick={() => onOpenChange(false)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{resource.title}</h2>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge variant="outline" className="text-[9px]">
              {contentLength.toLocaleString()} chars
            </Badge>
            <Badge variant="outline" className="text-[9px]">
              {wordCount.toLocaleString()} words
            </Badge>
            {resolutionLabel && (
              <Badge className="text-[9px] bg-primary/15 text-primary border-primary/30">
                {resolutionLabel}
              </Badge>
            )}
            {em && em !== rm && (
              <Badge variant="outline" className="text-[9px]">
                {em.replace(/_/g, ' ')}
              </Badge>
            )}
            {updatedAt && (
              <Badge variant="outline" className="text-[9px]">
                Updated {updatedAt}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
          onClick={() => setMonospace(m => !m)}
          title="Toggle monospace"
        >
          <Code className={cn("h-3.5 w-3.5", monospace && "text-primary")} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 min-h-[44px] sm:min-h-0"
          onClick={handleCopy}
          disabled={!content}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {!isMobile && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );

  const bodyContent = (
    <ScrollArea className="flex-1 min-h-0">
      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !content || content.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No content available</p>
          </div>
        ) : (
          <pre className={cn(
            'whitespace-pre-wrap break-words text-sm text-foreground leading-relaxed',
            monospace ? 'font-mono text-xs' : 'font-sans',
          )}>
            {content}
          </pre>
        )}
      </div>
    </ScrollArea>
  );

  // Mobile: full-screen sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] p-0 flex flex-col rounded-t-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>{resource.title}</SheetTitle>
          </SheetHeader>
          <div className="flex justify-center py-2 shrink-0">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
          {headerContent}
          {bodyContent}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: dialog
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col gap-0">
        {headerContent}
        {bodyContent}
      </DialogContent>
    </Dialog>
  );
}

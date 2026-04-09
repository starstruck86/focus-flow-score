import { useState, useCallback } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Loader2, Globe, ExternalLink } from 'lucide-react';
import { useClassifyResource, useAddUrlResource } from '@/hooks/useResourceUpload';
import { toast } from 'sonner';

type LinkItem = { title: string; url: string; category?: string };

interface WebpageImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WebpageImportModal({ open, onOpenChange }: WebpageImportModalProps) {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });

  const classify = useClassifyResource();
  const addUrl = useAddUrlResource();

  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setLinks([]);
    try {
      const { data, error } = await trackedInvoke<any>('import-webpage-links', {
        body: { url: url.trim() },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch links');
      const items: LinkItem[] = data.links || [];
      if (items.length === 0) {
        toast.error('No links found on this page');
        return;
      }
      setLinks(items);
      setSelected(new Set(items.map((_, i) => i)));
    } catch (e: any) {
      toast.error(e.message || 'Failed to fetch links');
    } finally {
      setFetching(false);
    }
  }, [url]);

  const toggleLink = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === links.length) setSelected(new Set());
    else setSelected(new Set(links.map((_, i) => i)));
  };

  const handleImport = useCallback(async () => {
    const toImport = links.filter((_, i) => selected.has(i));
    if (toImport.length === 0) return;
    setImporting(true);
    setImportProgress({ done: 0, total: toImport.length });

    let successCount = 0;
    for (let i = 0; i < toImport.length; i++) {
      const link = toImport[i];
      try {
        const classification = await classify.mutateAsync({ url: link.url });
        if (classification.title === 'Untitled' || classification.title.length < 3) {
          classification.title = link.title;
        }
        await addUrl.mutateAsync({ url: link.url, classification });
        successCount++;
      } catch (e) {
        console.error(`Failed to import ${link.title}:`, e);
      }
      setImportProgress({ done: i + 1, total: toImport.length });
    }

    toast.success(`Imported ${successCount} of ${toImport.length} resources`);
    setImporting(false);
    setLinks([]);
    setUrl('');
    setSelected(new Set());
    onOpenChange(false);
  }, [links, selected, classify, addUrl, onOpenChange]);

  const selectedCount = selected.size;
  const progressPct = importProgress.total > 0 ? (importProgress.done / importProgress.total) * 100 : 0;

  // Group links by category
  const categories = new Map<string, { link: LinkItem; index: number }[]>();
  links.forEach((link, i) => {
    const cat = link.category || 'Uncategorized';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push({ link, index: i });
  });

  return (
    <Dialog open={open} onOpenChange={importing ? undefined : onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Import from Webpage
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://example.com/resources"
              disabled={fetching || importing}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
            />
            <Button onClick={handleFetch} disabled={fetching || importing || !url.trim()} size="sm">
              {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fetch'}
            </Button>
          </div>

          {links.length > 0 && !importing && (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Found {links.length} links</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={toggleAll}>
                  {selected.size === links.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              <ScrollArea className="max-h-[350px] border rounded-md">
                <div className="p-2 space-y-3">
                  {[...categories.entries()].map(([cat, items]) => (
                    <div key={cat}>
                      {categories.size > 1 && (
                        <div className="px-2 py-1 mb-1">
                          <Badge variant="secondary" className="text-[10px] font-medium">{cat}</Badge>
                        </div>
                      )}
                      <div className="space-y-0.5">
                        {items.map(({ link, index }) => (
                          <label
                            key={index}
                            className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer text-sm"
                          >
                            <Checkbox
                              checked={selected.has(index)}
                              onCheckedChange={() => toggleLink(index)}
                            />
                            <span className="flex-1 truncate">{link.title}</span>
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={e => e.stopPropagation()}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}

          {importing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Importing & classifying...</span>
                <span>{importProgress.done} / {importProgress.total}</span>
              </div>
              <Progress value={progressPct} className="h-2" />
            </div>
          )}
        </div>

        {links.length > 0 && !importing && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={selectedCount === 0}>
              Import {selectedCount} Link{selectedCount !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Loader2, Podcast, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useClassifyResource, useAddUrlResource } from '@/hooks/useResourceUpload';
import { toast } from 'sonner';

type Episode = { title: string; url: string };

interface PodcastImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PodcastImportModal({ open, onOpenChange }: PodcastImportModalProps) {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });

  const classify = useClassifyResource();
  const addUrl = useAddUrlResource();

  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setEpisodes([]);
    try {
      const { data, error } = await supabase.functions.invoke('import-podcast', {
        body: { url: url.trim() },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch podcast');
      const eps: Episode[] = data.episodes || [];
      if (eps.length === 0) {
        toast.error('No episodes found');
        return;
      }
      setEpisodes(eps);
      setSelected(new Set(eps.map((_, i) => i)));
      toast.success(`Found ${eps.length} episodes`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to fetch podcast');
    } finally {
      setFetching(false);
    }
  }, [url]);

  const toggleEpisode = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === episodes.length) setSelected(new Set());
    else setSelected(new Set(episodes.map((_, i) => i)));
  };

  const handleImport = useCallback(async () => {
    const toImport = episodes.filter((_, i) => selected.has(i));
    if (toImport.length === 0) return;
    setImporting(true);
    setImportProgress({ done: 0, total: toImport.length });

    let successCount = 0;
    for (let i = 0; i < toImport.length; i++) {
      const episode = toImport[i];
      try {
        const classification = await classify.mutateAsync({ url: episode.url });
        if (classification.title === 'Untitled' || classification.title.length < 3) {
          classification.title = episode.title;
        }
        await addUrl.mutateAsync({ url: episode.url, classification });
        successCount++;
      } catch (e) {
        console.error(`Failed to import ${episode.title}:`, e);
      }
      setImportProgress({ done: i + 1, total: toImport.length });
    }

    toast.success(`Imported ${successCount} of ${toImport.length} episodes`);
    setImporting(false);
    setEpisodes([]);
    setUrl('');
    setSelected(new Set());
    onOpenChange(false);
  }, [episodes, selected, classify, addUrl, onOpenChange]);

  const selectedCount = selected.size;
  const progressPct = importProgress.total > 0 ? (importProgress.done / importProgress.total) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={importing ? undefined : onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Podcast className="h-5 w-5 text-primary" />
            Import Podcast
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Paste an Apple Podcasts, Spotify, or RSS feed URL to import up to 1,000 episodes.
          </p>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://podcasts.apple.com/... or https://open.spotify.com/show/..."
              disabled={fetching || importing}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
            />
            <Button onClick={handleFetch} disabled={fetching || importing || !url.trim()} size="sm">
              {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fetch'}
            </Button>
          </div>

          {episodes.length > 0 && !importing && (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Found {episodes.length} episodes</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={toggleAll}>
                  {selected.size === episodes.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              <ScrollArea className="max-h-[300px] border rounded-md">
                <div className="p-2 space-y-1">
                  {episodes.map((episode, i) => (
                    <label
                      key={i}
                      className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selected.has(i)}
                        onCheckedChange={() => toggleEpisode(i)}
                      />
                      <span className="flex-1 truncate">{episode.title}</span>
                      {episode.url && (
                        <a
                          href={episode.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={e => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </label>
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

        {episodes.length > 0 && !importing && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={selectedCount === 0}>
              Import {selectedCount} Episode{selectedCount !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

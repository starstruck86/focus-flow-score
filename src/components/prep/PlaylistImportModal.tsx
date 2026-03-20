import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Loader2, ListVideo, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useClassifyResource, useAddUrlResource } from '@/hooks/useResourceUpload';
import { toast } from 'sonner';

type Video = { title: string; url: string };

interface PlaylistImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlaylistImportModal({ open, onOpenChange }: PlaylistImportModalProps) {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });

  const classify = useClassifyResource();
  const addUrl = useAddUrlResource();

  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setVideos([]);
    try {
      const { data, error } = await supabase.functions.invoke('import-youtube-playlist', {
        body: { url: url.trim() },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch playlist');
      const vids: Video[] = data.videos || [];
      if (vids.length === 0) {
        toast.error('No videos found in this playlist');
        return;
      }
      setVideos(vids);
      setSelected(new Set(vids.map((_, i) => i)));
    } catch (e: any) {
      toast.error(e.message || 'Failed to fetch playlist');
    } finally {
      setFetching(false);
    }
  }, [url]);

  const toggleVideo = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === videos.length) setSelected(new Set());
    else setSelected(new Set(videos.map((_, i) => i)));
  };

  const handleImport = useCallback(async () => {
    const toImport = videos.filter((_, i) => selected.has(i));
    if (toImport.length === 0) return;
    setImporting(true);
    setImportProgress({ done: 0, total: toImport.length });

    let successCount = 0;
    // Process sequentially to avoid overwhelming edge functions
    for (let i = 0; i < toImport.length; i++) {
      const video = toImport[i];
      try {
        const classification = await classify.mutateAsync({ url: video.url });
        if (classification.title === 'Untitled' || classification.title.length < 3) {
          classification.title = video.title;
        }
        await addUrl.mutateAsync({ url: video.url, classification });
        successCount++;
      } catch (e) {
        console.error(`Failed to import ${video.title}:`, e);
      }
      setImportProgress({ done: i + 1, total: toImport.length });
    }

    toast.success(`Imported ${successCount} of ${toImport.length} videos`);
    setImporting(false);
    setVideos([]);
    setUrl('');
    setSelected(new Set());
    onOpenChange(false);
  }, [videos, selected, classify, addUrl, onOpenChange]);

  const selectedCount = selected.size;
  const progressPct = importProgress.total > 0 ? (importProgress.done / importProgress.total) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={importing ? undefined : onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListVideo className="h-5 w-5 text-primary" />
            Import YouTube Playlist
          </DialogTitle>
          <p className="text-sm text-muted-foreground">Paste a YouTube playlist URL to import up to 1,000 videos.</p>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://youtube.com/playlist?list=..."
              disabled={fetching || importing}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
            />
            <Button onClick={handleFetch} disabled={fetching || importing || !url.trim()} size="sm">
              {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fetch'}
            </Button>
          </div>

          {videos.length > 0 && !importing && (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Found {videos.length} videos</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={toggleAll}>
                  {selected.size === videos.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              <ScrollArea className="max-h-[300px] border rounded-md">
                <div className="p-2 space-y-1">
                  {videos.map((video, i) => (
                    <label
                      key={i}
                      className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selected.has(i)}
                        onCheckedChange={() => toggleVideo(i)}
                      />
                      <span className="flex-1 truncate">{video.title}</span>
                      <a
                        href={video.url}
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

        {videos.length > 0 && !importing && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={selectedCount === 0}>
              Import {selectedCount} Video{selectedCount !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState, useCallback, useMemo } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, ListVideo, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useBulkIngestion } from '@/hooks/useBulkIngestion';
import { BulkIngestionPanel } from './BulkIngestionPanel';

type Video = { title: string; url: string; videoId?: string; channel?: string; publishDate?: string; duration?: string };

interface PlaylistImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlaylistImportModal({ open, onOpenChange }: PlaylistImportModalProps) {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const bulk = useBulkIngestion();
  const isProcessing = bulk.state.status === 'running' || bulk.state.status === 'paused';
  const isDone = bulk.state.status === 'completed' || bulk.state.status === 'failed' || bulk.state.status === 'cancelled';

  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setVideos([]);
    try {
      const { data, error } = await trackedInvoke<any>('import-youtube-playlist', {
        body: { url: url.trim() },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch playlist');
      const vids: Video[] = (data.videos || []).map((v: any) => ({
        title: v.title || 'Untitled',
        url: v.url,
        videoId: v.videoId || v.video_id,
        channel: v.channel,
        publishDate: v.publishDate || v.publish_date,
        duration: v.duration,
      }));
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

  const selectedVideos = useMemo(
    () => videos.filter((_, i) => selected.has(i)),
    [videos, selected]
  );

  const handleClose = () => {
    if (isProcessing) return;
    if (isDone) {
      bulk.reset();
      setVideos([]);
      setUrl('');
      setSelected(new Set());
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={isProcessing ? undefined : handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListVideo className="h-5 w-5 text-primary" />
            Import YouTube Playlist
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Paste a YouTube playlist URL to import up to 1,000 videos with controlled batching.
          </p>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
          {/* URL input */}
          {!isProcessing && !isDone && (
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://youtube.com/playlist?list=..."
                disabled={fetching}
                onKeyDown={e => e.key === 'Enter' && handleFetch()}
              />
              <Button onClick={handleFetch} disabled={fetching || !url.trim()} size="sm">
                {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fetch'}
              </Button>
            </div>
          )}

          {/* Video list */}
          {videos.length > 0 && !isProcessing && !isDone && (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Found {videos.length} videos · {selected.size} selected</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={toggleAll}>
                  {selected.size === videos.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              <ScrollArea className="max-h-[240px] border rounded-md">
                <div className="p-2 space-y-1">
                  {videos.map((video, i) => (
                    <label
                      key={i}
                      className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <Checkbox checked={selected.has(i)} onCheckedChange={() => toggleVideo(i)} />
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

          {/* Bulk ingestion panel */}
          {(isProcessing || isDone || (videos.length > 0 && bulk.state.status === 'idle')) && (
            <BulkIngestionPanel
              state={bulk.state}
              onSetBatchSize={bulk.setBatchSize}
              onSetReprocessMode={bulk.setReprocessMode}
              onStart={bulk.start}
              onPause={bulk.pause}
              onResume={bulk.resume}
              onCancel={bulk.cancel}
              onReset={bulk.reset}
              hasFailures={bulk.hasFailures}
              sourceItems={selectedVideos}
              sourceLabel="videos"
            />
          )}
        </div>

        {isDone && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

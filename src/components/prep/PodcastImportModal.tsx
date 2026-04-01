import { useState, useCallback } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Loader2, Podcast, ExternalLink } from 'lucide-react';
import { useClassifyResource, useAddUrlResource } from '@/hooks/useResourceUpload';
import { insertSource, getSources } from '@/data/source-registry';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type Episode = {
  title: string;
  url: string;
  description?: string;
  duration?: string;
  published?: string;
  episode_number?: string;
  guest?: string | null;
};

type ShowMetadata = {
  show_title: string;
  show_author: string;
  show_description: string;
  show_image: string;
  feed_url: string;
};

interface PodcastImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PodcastImportModal({ open, onOpenChange }: PodcastImportModalProps) {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [showMeta, setShowMeta] = useState<ShowMetadata | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });

  const { user } = useAuth();
  const classify = useClassifyResource();
  const addUrl = useAddUrlResource();

  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setEpisodes([]);
    setShowMeta(null);
    try {
      const { data, error } = await trackedInvoke<any>('import-podcast', {
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
      setShowMeta(data.show || null);
      setSelected(new Set(eps.map((_, i) => i)));
      const showName = data.show?.show_title ? ` from "${data.show.show_title}"` : '';
      toast.success(`Found ${eps.length} episodes${showName}`);
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
    if (toImport.length === 0 || !user) return;
    setImporting(true);
    setImportProgress({ done: 0, total: toImport.length });

    // ── Step 1: Upsert source_registry entry for the show ──
    let sourceRegistryId: string | null = null;
    if (showMeta?.show_title) {
      try {
        // Check if we already have a registry entry for this feed URL
        const existing = await getSources(user.id);
        const match = existing.find(
          s => s.source_type === 'podcast_rss' && s.url === showMeta.feed_url
        );
        if (match) {
          sourceRegistryId = match.id;
        } else {
          const newSource = await insertSource({
            user_id: user.id,
            name: showMeta.show_title,
            source_type: 'podcast_rss',
            url: showMeta.feed_url,
            external_id: null,
            polling_enabled: false,
            poll_interval_hours: 24,
            trust_weight: 0.8,
            status: 'active',
            metadata: {
              show_author: showMeta.show_author,
              show_description: showMeta.show_description,
              show_image: showMeta.show_image,
              episode_count: toImport.length,
              imported_at: new Date().toISOString(),
            },
          });
          sourceRegistryId = newSource.id;
        }
      } catch (e) {
        console.warn('Failed to create source registry entry:', e);
      }
    }

    // ── Step 2: Import each episode ──
    let successCount = 0;
    for (let i = 0; i < toImport.length; i++) {
      const episode = toImport[i];
      try {
        const classification = await classify.mutateAsync({ url: episode.url });
        if (classification.title === 'Untitled' || classification.title.length < 3) {
          classification.title = episode.title;
        }
        const resource = await addUrl.mutateAsync({ url: episode.url, classification });

        // Link resource to source_registry and populate metadata
        if (resource?.id) {
          const updateFields: Record<string, any> = {};
          if (sourceRegistryId) updateFields.source_registry_id = sourceRegistryId;
          if (episode.guest) updateFields.author_or_speaker = episode.guest;
          else if (showMeta?.show_author) updateFields.author_or_speaker = showMeta.show_author;
          if (episode.published) {
            try {
              updateFields.source_published_at = new Date(episode.published).toISOString();
            } catch { /* invalid date */ }
          }
          if (Object.keys(updateFields).length > 0) {
            await (supabase as any).from('resources').update(updateFields).eq('id', resource.id);
          }
        }

        successCount++;
      } catch (e) {
        console.error(`Failed to import ${episode.title}:`, e);
      }
      setImportProgress({ done: i + 1, total: toImport.length });
    }

    toast.success(`Imported ${successCount} of ${toImport.length} episodes`);
    setImporting(false);
    setEpisodes([]);
    setShowMeta(null);
    setUrl('');
    setSelected(new Set());
    onOpenChange(false);
  }, [episodes, selected, classify, addUrl, onOpenChange, user, showMeta]);

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

          {showMeta?.show_title && !importing && (
            <div className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
              {showMeta.show_image && (
                <img src={showMeta.show_image} alt="" className="h-10 w-10 rounded-md object-cover" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{showMeta.show_title}</p>
                {showMeta.show_author && (
                  <p className="text-xs text-muted-foreground truncate">{showMeta.show_author}</p>
                )}
              </div>
            </div>
          )}

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
                      <div className="flex-1 min-w-0">
                        <span className="block truncate">{episode.title}</span>
                        {episode.guest && (
                          <span className="block text-xs text-muted-foreground truncate">
                            Guest: {episode.guest}
                          </span>
                        )}
                      </div>
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

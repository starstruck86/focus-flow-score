import { useState, useCallback, useMemo } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, Podcast, ExternalLink, Users, CalendarDays, CheckCircle2 } from 'lucide-react';
import { insertSource, getSources } from '@/data/source-registry';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useBulkIngestion } from '@/hooks/useBulkIngestion';
import { BulkIngestionPanel } from './BulkIngestionPanel';

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
  const [alreadyImported, setAlreadyImported] = useState<Set<number>>(new Set());
  const [sourceRegistryId, setSourceRegistryId] = useState<string | null>(null);

  const { user } = useAuth();
  const bulk = useBulkIngestion();
  const isProcessing = bulk.state.status === 'running' || bulk.state.status === 'paused';
  const isDone = bulk.state.status === 'completed' || bulk.state.status === 'failed' || bulk.state.status === 'cancelled';

  // ── Fetch episodes ──────────────────────────────────────────
  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setEpisodes([]);
    setShowMeta(null);
    setAlreadyImported(new Set());
    setSourceRegistryId(null);
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

      // ── Dedup check: find already-imported episode URLs ──
      if (user) {
        try {
          const epUrls = eps.map(e => e.url).filter(Boolean);
          // Query in batches of 50 to avoid URL length issues
          const importedUrls = new Set<string>();
          for (let i = 0; i < epUrls.length; i += 50) {
            const batch = epUrls.slice(i, i + 50);
            const { data: existing } = await supabase
              .from('resources')
              .select('file_url')
              .eq('user_id', user.id)
              .in('file_url', batch);
            existing?.forEach((r: any) => { if (r.file_url) importedUrls.add(r.file_url); });
          }
          const alreadySet = new Set<number>();
          eps.forEach((ep, idx) => { if (importedUrls.has(ep.url)) alreadySet.add(idx); });
          setAlreadyImported(alreadySet);
          // Select only non-imported episodes
          setSelected(new Set(eps.map((_, i) => i).filter(i => !alreadySet.has(i))));
        } catch {
          // Fallback: select all
          setSelected(new Set(eps.map((_, i) => i)));
        }
      } else {
        setSelected(new Set(eps.map((_, i) => i)));
      }

      // ── Upsert source_registry ──
      if (data.show?.show_title && user) {
        try {
          const existing = await getSources(user.id);
          const match = existing.find(
            s => s.source_type === 'podcast_rss' && s.url === data.show.feed_url
          );
          if (match) {
            setSourceRegistryId(match.id);
          } else {
            const newSource = await insertSource({
              user_id: user.id,
              name: data.show.show_title,
              source_type: 'podcast_rss',
              url: data.show.feed_url,
              external_id: null,
              polling_enabled: false,
              poll_interval_hours: 24,
              trust_weight: 0.8,
              status: 'active',
              metadata: {
                show_author: data.show.show_author,
                show_description: data.show.show_description,
                show_image: data.show.show_image,
                episode_count: eps.length,
                imported_at: new Date().toISOString(),
              },
            });
            setSourceRegistryId(newSource.id);
          }
        } catch (e) {
          console.warn('Failed to create source registry entry:', e);
        }
      }

      const showName = data.show?.show_title ? ` from "${data.show.show_title}"` : '';
      const counts = data.source_counts;
      const countInfo = counts ? ` (${counts.rss_count} RSS + ${counts.itunes_count} iTunes)` : '';
      toast.success(`Found ${eps.length} episodes${showName}${countInfo}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to fetch podcast');
    } finally {
      setFetching(false);
    }
  }, [url, user]);

  // ── Selection helpers ──────────────────────────────────────
  const toggleEpisode = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === episodes.length - alreadyImported.size) setSelected(new Set());
    else setSelected(new Set(episodes.map((_, i) => i).filter(i => !alreadyImported.has(i))));
  };

  const selectNewest = (count: number) => {
    // Episodes are typically in reverse-chronological order from RSS
    const eligible = episodes.map((_, i) => i).filter(i => !alreadyImported.has(i));
    setSelected(new Set(eligible.slice(0, count)));
  };

  const selectWithGuests = () => {
    const eligible = episodes.map((_, i) => i).filter(i => !alreadyImported.has(i) && episodes[i].guest);
    setSelected(new Set(eligible));
  };

  const guestCount = useMemo(() => episodes.filter(e => e.guest).length, [episodes]);
  const newEpisodeCount = episodes.length - alreadyImported.size;

  // ── Map selected episodes to bulk ingestion format ──────────
  const selectedEpisodes = useMemo(
    () => episodes
      .filter((_, i) => selected.has(i))
      .map(ep => ({
        url: ep.url,
        title: ep.title,
        publishDate: ep.published,
        duration: ep.duration,
        channel: showMeta?.show_author || undefined,
      })),
    [episodes, selected, showMeta]
  );

  // ── Close handler ──────────────────────────────────────────
  const handleClose = () => {
    if (isProcessing) return;
    if (isDone) {
      // After bulk completes, link resources to source_registry + populate metadata
      linkImportedResources();
      bulk.reset();
      setEpisodes([]);
      setShowMeta(null);
      setUrl('');
      setSelected(new Set());
      setAlreadyImported(new Set());
      setSourceRegistryId(null);
    }
    onOpenChange(false);
  };

  // ── Post-import: link resources to source_registry ─────────
  const linkImportedResources = useCallback(async () => {
    if (!sourceRegistryId || !user) return;
    const completedItems = bulk.state.items.filter(i => i.stage === 'complete' && i.existingResourceId);
    if (completedItems.length === 0) return;

    for (const item of completedItems) {
      try {
        const updateFields: Record<string, any> = { source_registry_id: sourceRegistryId };
        // Find matching episode for metadata
        const ep = episodes.find(e => e.url === item.url);
        if (ep?.guest) updateFields.author_or_speaker = ep.guest;
        else if (showMeta?.show_author) updateFields.author_or_speaker = showMeta.show_author;
        if (ep?.published) {
          try { updateFields.source_published_at = new Date(ep.published).toISOString(); } catch { /* skip */ }
        }
        await (supabase as any).from('resources').update(updateFields).eq('id', item.existingResourceId);
      } catch (e) {
        console.warn('Failed to link resource:', e);
      }
    }
  }, [sourceRegistryId, user, bulk.state.items, episodes, showMeta]);

  const selectedCount = selected.size;

  return (
    <Dialog open={open} onOpenChange={isProcessing ? undefined : handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Podcast className="h-5 w-5 text-primary" />
            Import Podcast
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* URL input — hide during processing */}
          {!isProcessing && !isDone && (
            <>
              <p className="text-xs text-muted-foreground">
                Paste an Apple Podcasts, Spotify, or RSS feed URL to import episodes with controlled batching.
              </p>
              <div className="flex gap-2">
                <Input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://podcasts.apple.com/... or RSS feed URL"
                  disabled={fetching}
                  onKeyDown={e => e.key === 'Enter' && handleFetch()}
                />
                <Button onClick={handleFetch} disabled={fetching || !url.trim()} size="sm">
                  {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fetch'}
                </Button>
              </div>
            </>
          )}

          {/* Show metadata */}
          {showMeta?.show_title && !isProcessing && !isDone && (
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

          {/* Episode list with selection helpers */}
          {episodes.length > 0 && !isProcessing && !isDone && (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2 flex-wrap">
                  <span>{episodes.length} episodes · {selectedCount} selected</span>
                  {alreadyImported.size > 0 && (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <CheckCircle2 className="h-3 w-3 text-status-green" />
                      {alreadyImported.size} already imported
                    </Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={toggleAll}>
                  {selected.size === newEpisodeCount ? 'Deselect All' : 'Select All'}
                </Button>
              </div>

              {/* Smart selection helpers for large lists */}
              {episodes.length > 50 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">Quick select:</span>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => selectNewest(50)}>
                    <CalendarDays className="h-3 w-3" /> Newest 50
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => selectNewest(100)}>
                    <CalendarDays className="h-3 w-3" /> Newest 100
                  </Button>
                  {guestCount > 0 && (
                    <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={selectWithGuests}>
                      <Users className="h-3 w-3" /> With guests ({guestCount})
                    </Button>
                  )}
                </div>
              )}

              <ScrollArea className="max-h-[260px] border rounded-md">
                <div className="p-2 space-y-1">
                  {episodes.map((episode, i) => {
                    const imported = alreadyImported.has(i);
                    return (
                      <label
                        key={i}
                        className={`flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer text-sm ${imported ? 'opacity-50' : ''}`}
                      >
                        <Checkbox
                          checked={selected.has(i)}
                          onCheckedChange={() => toggleEpisode(i)}
                          disabled={imported}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="block truncate">{episode.title}</span>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {episode.guest && <span>Guest: {episode.guest}</span>}
                            {imported && <Badge variant="secondary" className="text-[9px] h-4">Already imported</Badge>}
                          </div>
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
                    );
                  })}
                </div>
              </ScrollArea>
            </>
          )}

          {/* Bulk ingestion panel */}
          {(isProcessing || isDone || (episodes.length > 0 && !isDone && bulk.state.status === 'idle' && selectedCount > 0)) && (
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
              sourceItems={selectedEpisodes}
              sourceLabel="episodes"
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

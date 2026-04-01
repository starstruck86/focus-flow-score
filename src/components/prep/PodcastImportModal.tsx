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
import { usePodcastQueue } from '@/hooks/usePodcastQueue';
import { PodcastQueueProgress } from './PodcastQueueProgress';

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
  const [enqueued, setEnqueued] = useState(false);

  const { user } = useAuth();
  const queue = usePodcastQueue();

  // ── Fetch episodes ──────────────────────────────────────────
  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setEpisodes([]);
    setShowMeta(null);
    setAlreadyImported(new Set());
    setSourceRegistryId(null);
    setEnqueued(false);
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
          setSelected(new Set(eps.map((_, i) => i).filter(i => !alreadySet.has(i))));
        } catch {
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
    const eligible = episodes.map((_, i) => i).filter(i => !alreadyImported.has(i));
    setSelected(new Set(eligible.slice(0, count)));
  };

  const selectWithGuests = () => {
    const eligible = episodes.map((_, i) => i).filter(i => !alreadyImported.has(i) && episodes[i].guest);
    setSelected(new Set(eligible));
  };

  const guestCount = useMemo(() => episodes.filter(e => e.guest).length, [episodes]);
  const newEpisodeCount = episodes.length - alreadyImported.size;

  // ── Start server-side import ───────────────────────────────
  const handleStartImport = useCallback(async () => {
    const selectedEps = episodes
      .filter((_, i) => selected.has(i))
      .map(ep => ({
        url: ep.url,
        title: ep.title,
        guest: ep.guest,
        published: ep.published,
        duration: ep.duration,
      }));

    if (selectedEps.length === 0) return;

    await queue.enqueue(selectedEps, sourceRegistryId, showMeta?.show_author);
    setEnqueued(true);
    toast.success(`Queued ${selectedEps.length} episodes for server-side import`);
  }, [episodes, selected, sourceRegistryId, showMeta, queue]);

  // ── Close handler ──────────────────────────────────────────
  const handleClose = () => {
    if (!enqueued && !queue.isActive) {
      setEpisodes([]);
      setShowMeta(null);
      setUrl('');
      setSelected(new Set());
      setAlreadyImported(new Set());
      setSourceRegistryId(null);
    }
    onOpenChange(false);
  };

  const selectedCount = selected.size;
  const showQueue = enqueued || queue.isActive || queue.isDone;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Podcast className="h-5 w-5 text-primary" />
            Import Podcast
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* URL input — hide when queue is active */}
          {!showQueue && (
            <>
              <p className="text-xs text-muted-foreground">
                Paste an Apple Podcasts, Spotify, or RSS feed URL. Episodes are imported server-side — you can close the browser.
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
          {showMeta?.show_title && !showQueue && (
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
          {episodes.length > 0 && !showQueue && (
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

              {/* Start import button */}
              {selectedCount > 0 && (
                <Button
                  onClick={handleStartImport}
                  disabled={queue.loading}
                  className="w-full gap-2"
                >
                  {queue.loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Podcast className="h-4 w-4" />
                  )}
                  Queue {selectedCount} episodes for import
                </Button>
              )}
            </>
          )}

          {/* Queue progress panel */}
          {showQueue && (
            <PodcastQueueProgress
              items={queue.items}
              stats={queue.stats}
              isActive={queue.isActive}
              isDone={queue.isDone}
              onCancel={queue.cancelRemaining}
              onGenerateKIs={queue.generateKIs}
              onGenerateAllKIs={queue.generateAllKIs}
              generatingKIs={queue.generatingKIs}
              onClear={() => {
                queue.clearDone();
                setEnqueued(false);
                setEpisodes([]);
                setShowMeta(null);
                setUrl('');
                setSelected(new Set());
                setAlreadyImported(new Set());
                setSourceRegistryId(null);
              }}
            />
          )}
        </div>

        {(showQueue && !queue.isActive) && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

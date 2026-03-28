import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useIncomingQueue,
  useIncomingQueueRealtime,
  useUpdateBrainStatus,
  useManualIngest,
  useManualRefresh,
  useSyncTracker,
} from '@/hooks/useIncomingQueue';
import type { BrainStatus } from '@/lib/salesBrain/ingestion';
import {
  CheckCircle, XCircle, Archive, ExternalLink,
  Plus, Inbox, EyeOff, RefreshCw, Wifi, WifiOff,
  Loader2, AlertTriangle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const isDev = import.meta.env.DEV;
const STALE_THRESHOLD_MS = 45_000; // 45 seconds

export function IncomingQueue() {
  const [filter, setFilter] = useState<BrainStatus>('pending');

  const { realtimeConnected } = useIncomingQueueRealtime();
  const { data: items = [], isLoading, isFetching, dataUpdatedAt } = useIncomingQueue(filter);
  const updateStatus = useUpdateBrainStatus();
  const manualIngest = useManualIngest();
  const { refresh, refreshing } = useManualRefresh();
  const lastSyncedAt = useSyncTracker(dataUpdatedAt);

  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addTitle, setAddTitle] = useState('');

  // Stale detection — ticks every 10s
  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      if (!realtimeConnected && lastSyncedAt) {
        setIsStale(Date.now() - lastSyncedAt.getTime() > STALE_THRESHOLD_MS);
      } else {
        setIsStale(false);
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [realtimeConnected, lastSyncedAt]);

  // Clear stale on fresh data
  useEffect(() => {
    if (dataUpdatedAt > 0) setIsStale(false);
  }, [dataUpdatedAt]);

  const handleManualAdd = () => {
    if (!addUrl.trim() || !addTitle.trim()) return;
    manualIngest.mutate({ url: addUrl.trim(), title: addTitle.trim() });
    setAddUrl('');
    setAddTitle('');
    setShowAdd(false);
  };

  const count = items.length;
  const syncLabel = lastSyncedAt
    ? formatDistanceToNow(lastSyncedAt, { addSuffix: true })
    : 'not yet';

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Incoming Queue</h3>
          <p className="text-[11px] text-muted-foreground">{count} {filter} items</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add URL
        </Button>
      </div>

      {/* ── Status Bar ── */}
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 border border-border text-[10px] text-muted-foreground">
        {/* Live indicator */}
        <span className="flex items-center gap-1">
          {realtimeConnected ? (
            <Wifi className="h-3 w-3 text-green-500" />
          ) : (
            <WifiOff className="h-3 w-3 text-destructive" />
          )}
          <span>{realtimeConnected ? 'Live' : 'Offline'}</span>
        </span>

        <span className="text-border">·</span>

        {/* Last synced */}
        <span className="flex items-center gap-1">
          Synced {syncLabel}
          {isFetching && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
        </span>

        {/* Stale warning */}
        {isStale && (
          <>
            <span className="text-border">·</span>
            <Badge variant="outline" className="text-[9px] h-4 gap-0.5 border-destructive/50 text-destructive">
              <AlertTriangle className="h-2.5 w-2.5" />
              May be stale
            </Badge>
          </>
        )}

        <span className="flex-1" />

        {/* Row count */}
        <span>{count} rows</span>

        <span className="text-border">·</span>

        {/* Refresh button */}
        <Button
          size="sm"
          variant="ghost"
          className="h-5 px-1.5 text-[10px] gap-1"
          disabled={refreshing || isFetching}
          onClick={refresh}
        >
          <RefreshCw className={`h-2.5 w-2.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Manual add form */}
      {showAdd && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <Input
              placeholder="URL"
              value={addUrl}
              onChange={e => setAddUrl(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="flex gap-2">
              <Input
                placeholder="Title"
                value={addTitle}
                onChange={e => setAddTitle(e.target.value)}
                className="h-8 text-xs flex-1"
              />
              <Button size="sm" onClick={handleManualAdd} disabled={manualIngest.isPending}>
                Ingest
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={filter} onValueChange={v => setFilter(v as BrainStatus)}>
        <TabsList className="h-7">
          <TabsTrigger value="pending" className="text-[11px] px-2 h-6">
            <Inbox className="h-3 w-3 mr-1" /> Pending
          </TabsTrigger>
          <TabsTrigger value="promoted" className="text-[11px] px-2 h-6">
            <CheckCircle className="h-3 w-3 mr-1" /> Promoted
          </TabsTrigger>
          <TabsTrigger value="ignored" className="text-[11px] px-2 h-6">
            <EyeOff className="h-3 w-3 mr-1" /> Ignored
          </TabsTrigger>
          <TabsTrigger value="archived" className="text-[11px] px-2 h-6">
            <Archive className="h-3 w-3 mr-1" /> Archived
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* List */}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : count === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-xs text-muted-foreground">
              {filter === 'pending' ? 'No pending items. Add sources or ingest URLs to get started.' : `No ${filter} items.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {items.map(item => (
            <Card key={item.id} className="group">
              <CardContent className="p-2.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{item.title}</p>
                    {item.file_url && (
                      <a
                        href={item.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-primary hover:underline flex items-center gap-0.5 truncate"
                      >
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        {item.file_url}
                      </a>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge variant="outline" className="text-[9px]">{item.resource_type}</Badge>
                      {item.discovered_at && (
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(item.discovered_at), { addSuffix: true })}
                        </span>
                      )}
                    </div>

                    {/* Dev-mode row metadata */}
                    {isDev && (
                      <div className="mt-1 text-[9px] text-muted-foreground/60 font-mono space-x-2">
                        <span>id:{item.id.slice(0, 8)}</span>
                        <span>q:{item.brain_status}</span>
                        <span>enrich:{item.enrichment_status}</span>
                        <span>sync:{lastSyncedAt?.toLocaleTimeString() ?? '?'}</span>
                      </div>
                    )}
                  </div>

                  {filter === 'pending' && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-primary"
                        title="Promote"
                        disabled={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: item.id, status: 'promoted' })}
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground"
                        title="Ignore"
                        disabled={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: item.id, status: 'ignored' })}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground"
                        title="Archive"
                        disabled={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: item.id, status: 'archived' })}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}

                  {filter !== 'pending' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-[10px] h-6"
                      disabled={updateStatus.isPending}
                      onClick={() => updateStatus.mutate({ id: item.id, status: 'pending' })}
                    >
                      ↩ Pending
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

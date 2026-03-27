import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIncomingQueue, useUpdateBrainStatus, useManualIngest } from '@/hooks/useIncomingQueue';
import type { BrainStatus } from '@/lib/salesBrain/ingestion';
import {
  CheckCircle, XCircle, Archive, ExternalLink,
  Plus, Inbox, Eye, EyeOff,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function IncomingQueue() {
  const [filter, setFilter] = useState<BrainStatus>('pending');
  const { data: items = [], isLoading } = useIncomingQueue(filter);
  const updateStatus = useUpdateBrainStatus();
  const manualIngest = useManualIngest();

  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addTitle, setAddTitle] = useState('');

  const handleManualAdd = () => {
    if (!addUrl.trim() || !addTitle.trim()) return;
    manualIngest.mutate({ url: addUrl.trim(), title: addTitle.trim() });
    setAddUrl('');
    setAddTitle('');
    setShowAdd(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Incoming Queue</h3>
          <p className="text-[11px] text-muted-foreground">{items.length} items</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add URL
        </Button>
      </div>

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

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
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
                  </div>

                  {filter === 'pending' && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-green-600"
                        title="Promote"
                        onClick={() => updateStatus.mutate({ id: item.id, status: 'promoted' })}
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground"
                        title="Ignore"
                        onClick={() => updateStatus.mutate({ id: item.id, status: 'ignored' })}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground"
                        title="Archive"
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

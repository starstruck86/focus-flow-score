import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSources, useAddSource, useDeleteSource, useToggleSourceStatus, type SourceType } from '@/hooks/useSources';
import { Plus, Trash2, Radio, RadioOff, Globe, Youtube, Podcast, FileText, Swords, StickyNote } from 'lucide-react';

const SOURCE_TYPES: { value: SourceType; label: string; icon: React.ReactNode }[] = [
  { value: 'youtube_playlist', label: 'YouTube Playlist', icon: <Youtube className="h-3.5 w-3.5" /> },
  { value: 'youtube_channel', label: 'YouTube Channel', icon: <Youtube className="h-3.5 w-3.5" /> },
  { value: 'podcast_rss', label: 'Podcast RSS', icon: <Podcast className="h-3.5 w-3.5" /> },
  { value: 'web_article', label: 'Web Article', icon: <Globe className="h-3.5 w-3.5" /> },
  { value: 'manual_note', label: 'Manual Note', icon: <StickyNote className="h-3.5 w-3.5" /> },
  { value: 'competitor_url', label: 'Competitor URL', icon: <Swords className="h-3.5 w-3.5" /> },
];

function getIcon(type: string) {
  return SOURCE_TYPES.find(s => s.value === type)?.icon || <FileText className="h-3.5 w-3.5" />;
}

export function SourceRegistryManager() {
  const { data: sources = [], isLoading } = useSources();
  const addSource = useAddSource();
  const deleteSource = useDeleteSource();
  const toggleStatus = useToggleSourceStatus();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('web_article');

  const handleAdd = () => {
    if (!name.trim()) return;
    addSource.mutate({
      name: name.trim(),
      url: url.trim() || null,
      source_type: sourceType,
      external_id: null,
      polling_enabled: false,
      poll_interval_hours: 24,
      trust_weight: 1.0,
      status: 'active',
      metadata: {},
    });
    setName('');
    setUrl('');
    setShowForm(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Source Registry</h3>
          <p className="text-[11px] text-muted-foreground">{sources.length} sources registered</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Source
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <Input
              placeholder="Source name (e.g. 'Sandler Training Channel')"
              value={name}
              onChange={e => setName(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              placeholder="URL (optional)"
              value={url}
              onChange={e => setUrl(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="flex items-center gap-2">
              <Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map(st => (
                    <SelectItem key={st.value} value={st.value} className="text-xs">
                      <span className="flex items-center gap-1.5">{st.icon} {st.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleAdd} disabled={!name.trim() || addSource.isPending}>
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-xs text-muted-foreground">No sources yet. Add your first source to start building your sales brain.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {sources.map(s => (
            <Card key={s.id} className="group">
              <CardContent className="p-2.5 flex items-center gap-2">
                <span className="text-muted-foreground">{getIcon(s.source_type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{s.name}</p>
                  {s.url && (
                    <p className="text-[10px] text-muted-foreground truncate">{s.url}</p>
                  )}
                </div>
                <Badge variant={s.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                  {s.status}
                </Badge>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => toggleStatus.mutate({
                      id: s.id,
                      status: s.status === 'active' ? 'paused' : 'active',
                    })}
                  >
                    {s.status === 'active' ? <RadioOff className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive"
                    onClick={() => deleteSource.mutate(s.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

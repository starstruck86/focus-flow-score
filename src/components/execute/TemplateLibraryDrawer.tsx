import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Star, Pin, Search, Trash2 } from 'lucide-react';
import { useExecutionTemplates, useUpdateTemplate } from '@/hooks/useExecutionTemplates';
import type { ExecutionTemplate } from '@/lib/executionTemplateTypes';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (t: ExecutionTemplate) => void;
}

export function TemplateLibraryDrawer({ open, onOpenChange, onSelect }: Props) {
  const { data: templates = [] } = useExecutionTemplates();
  const update = useUpdateTemplate();
  const [search, setSearch] = useState('');

  const filtered = templates.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.output_type.toLowerCase().includes(search.toLowerCase())
  );

  const favorites = filtered.filter(t => t.is_favorite);
  const recent = [...filtered].sort((a, b) =>
    new Date(b.last_used_at || b.created_at).getTime() - new Date(a.last_used_at || a.created_at).getTime()
  ).slice(0, 10);

  const toggleFav = (t: ExecutionTemplate) =>
    update.mutate({ id: t.id, is_favorite: !t.is_favorite });

  const togglePin = (t: ExecutionTemplate) =>
    update.mutate({ id: t.id, is_pinned: !t.is_pinned });

  const archive = (t: ExecutionTemplate) =>
    update.mutate({ id: t.id, status: 'archived' } as any);

  const renderList = (list: ExecutionTemplate[]) => (
    <div className="space-y-2">
      {list.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No templates found</p>}
      {list.map(t => (
        <div key={t.id} className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors group">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {t.is_pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
              <span className="text-xs font-medium truncate">{t.title}</span>
              <Badge variant="outline" className="text-[9px]">{t.output_type.replace(/_/g, ' ')}</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {t.template_origin} · Used {t.times_used}x · {t.stage || 'any stage'}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => toggleFav(t)}>
              <Star className={`h-3 w-3 ${t.is_favorite ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground'}`} />
            </Button>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => togglePin(t)}>
              <Pin className={`h-3 w-3 ${t.is_pinned ? 'text-primary' : 'text-muted-foreground'}`} />
            </Button>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100" onClick={() => archive(t)}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
            <Button size="sm" variant="default" className="h-6 text-[10px] px-2" onClick={() => { onSelect(t); onOpenChange(false); }}>
              Use
            </Button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[480px]">
        <SheetHeader>
          <SheetTitle>Template Library</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates…"
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Tabs defaultValue="all">
            <TabsList className="w-full">
              <TabsTrigger value="all" className="text-xs flex-1">All ({filtered.length})</TabsTrigger>
              <TabsTrigger value="favorites" className="text-xs flex-1">Favorites ({favorites.length})</TabsTrigger>
              <TabsTrigger value="recent" className="text-xs flex-1">Recent</TabsTrigger>
            </TabsList>
            <TabsContent value="all" className="mt-2 max-h-[60vh] overflow-y-auto">{renderList(filtered)}</TabsContent>
            <TabsContent value="favorites" className="mt-2 max-h-[60vh] overflow-y-auto">{renderList(favorites)}</TabsContent>
            <TabsContent value="recent" className="mt-2 max-h-[60vh] overflow-y-auto">{renderList(recent)}</TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ExternalLink, Search, Copy, FileText, BookOpen, Target, FolderOpen, File, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAllResourceLinks, detectUrlMeta, type ResourceCategory } from '@/hooks/useResourceLinks';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';

const CATEGORY_META: Record<ResourceCategory, { label: string; icon: React.ElementType; color: string }> = {
  template: { label: 'Template', icon: FileText, color: 'bg-primary/10 text-primary' },
  framework: { label: 'Framework', icon: Target, color: 'bg-status-yellow/10 text-status-yellow' },
  playbook: { label: 'Playbook', icon: BookOpen, color: 'bg-status-green/10 text-status-green' },
  reference: { label: 'Reference', icon: FolderOpen, color: 'bg-accent text-accent-foreground' },
  other: { label: 'Other', icon: File, color: 'bg-muted text-muted-foreground' },
};

interface ResourceLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResourceLibraryModal({ open, onOpenChange }: ResourceLibraryModalProps) {
  const { data: links = [], isLoading } = useAllResourceLinks();
  const { accounts, opportunities } = useStore();
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<ResourceCategory | 'all'>('all');

  const filtered = links.filter(l => {
    if (filterCategory !== 'all' && l.category !== filterCategory) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        l.label.toLowerCase().includes(q) ||
        l.url.toLowerCase().includes(q) ||
        (l.notes || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group by category
  const grouped = filtered.reduce((acc, link) => {
    const cat = link.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(link);
    return acc;
  }, {} as Record<string, typeof links>);

  const getRecordName = (link: typeof links[0]) => {
    if (link.account_id) {
      const acc = accounts.find(a => a.id === link.account_id);
      return acc ? acc.name : null;
    }
    if (link.opportunity_id) {
      const opp = opportunities.find(o => o.id === link.opportunity_id);
      return opp ? opp.name : null;
    }
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> Resource Library
          </DialogTitle>
          <DialogDescription>All your templates, frameworks, and reference links in one place.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search resources…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex gap-1 flex-wrap">
          <Badge
            variant={filterCategory === 'all' ? 'default' : 'outline'}
            className="cursor-pointer text-xs"
            onClick={() => setFilterCategory('all')}
          >
            All ({links.length})
          </Badge>
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const count = links.filter(l => l.category === key).length;
            if (count === 0) return null;
            return (
              <Badge
                key={key}
                variant={filterCategory === key ? 'default' : 'outline'}
                className={cn('cursor-pointer text-xs', filterCategory !== key && meta.color)}
                onClick={() => setFilterCategory(key as ResourceCategory)}
              >
                {meta.label} ({count})
              </Badge>
            );
          })}
        </div>

        <ScrollArea className="flex-1 -mx-2 px-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {links.length === 0 ? 'No resources saved yet. Add links from opportunity or account views.' : 'No results match your search.'}
            </p>
          ) : (
            <div className="space-y-4 py-2">
              {Object.entries(grouped).map(([cat, catLinks]) => {
                const meta = CATEGORY_META[cat as ResourceCategory] || CATEGORY_META.other;
                const CatIcon = meta.icon;
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <CatIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{meta.label}s</p>
                    </div>
                    <div className="space-y-1">
                      {catLinks.map(link => {
                        const recordName = getRecordName(link);
                        return (
                          <div
                            key={link.id}
                            className="group flex items-center gap-2 rounded-md border border-border/50 bg-card/50 px-3 py-2 hover:bg-accent/30 transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-foreground hover:underline truncate block"
                              >
                                {link.label || 'Untitled'}
                              </a>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                                {recordName && <span>📌 {recordName}</span>}
                                {link.notes && <span className="truncate">• {link.notes}</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <Button
                                variant="ghost" size="sm" className="h-6 w-6 p-0"
                                onClick={() => { navigator.clipboard.writeText(link.url); toast.success('Copied'); }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                              <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-6 w-6 items-center justify-center">
                                <ExternalLink className="h-3 w-3 text-muted-foreground" />
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

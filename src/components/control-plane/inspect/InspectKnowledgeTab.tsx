/**
 * Knowledge tab — KI list with status, contexts, source evidence, jump-to-content.
 */
import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2, XCircle, ChevronDown, ChevronRight,
  BookOpen, Tag, Search,
} from 'lucide-react';
import type { KnowledgeItemDetail } from '@/hooks/useResourceInspectData';
import { Input } from '@/components/ui/input';

interface Props {
  knowledgeItems: KnowledgeItemDetail[];
  loading: boolean;
  onJumpToContent?: (charRange: any) => void;
}

type FilterMode = 'all' | 'active' | 'inactive' | 'no_context';

export function InspectKnowledgeTab({ knowledgeItems, loading, onJumpToContent }: Props) {
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let items = knowledgeItems;
    if (filterMode === 'active') items = items.filter(ki => ki.active);
    if (filterMode === 'inactive') items = items.filter(ki => !ki.active);
    if (filterMode === 'no_context') items = items.filter(ki => ki.active && ki.applies_to_contexts.length === 0);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(ki =>
        ki.title.toLowerCase().includes(q) ||
        ki.tactic_summary?.toLowerCase().includes(q) ||
        ki.source_excerpt?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [knowledgeItems, filterMode, search]);

  const activeCount = knowledgeItems.filter(ki => ki.active).length;
  const withContextCount = knowledgeItems.filter(ki => ki.active && ki.applies_to_contexts.length > 0).length;

  if (loading) {
    return <p className="text-xs text-muted-foreground italic py-4">Loading knowledge items…</p>;
  }

  return (
    <div className="space-y-3">
      {/* ── Summary bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px]">{knowledgeItems.length} total</Badge>
        <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200">{activeCount} active</Badge>
        <Badge variant="outline" className="text-[10px]">{withContextCount} with contexts</Badge>
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(['all', 'active', 'inactive', 'no_context'] as FilterMode[]).map(mode => (
          <Button
            key={mode}
            variant={filterMode === mode ? 'default' : 'outline'}
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={() => setFilterMode(mode)}
          >
            {mode === 'all' ? 'All' : mode === 'active' ? 'Active' : mode === 'inactive' ? 'Inactive' : 'No Context'}
          </Button>
        ))}
        <div className="relative flex-1 min-w-[100px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search KIs…"
            className="h-6 text-[10px] pl-7"
          />
        </div>
      </div>

      {/* ── KI List ── */}
      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">
          {knowledgeItems.length === 0 ? 'No knowledge items generated for this resource' : 'No items match current filter'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(ki => (
            <KICard
              key={ki.id}
              ki={ki}
              expanded={expandedId === ki.id}
              onToggle={() => setExpandedId(expandedId === ki.id ? null : ki.id)}
              onJumpToContent={onJumpToContent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── KI Card ────────────────────────────────────────────

function KICard({ ki, expanded, onToggle, onJumpToContent }: {
  ki: KnowledgeItemDetail; expanded: boolean; onToggle: () => void;
  onJumpToContent?: (charRange: any) => void;
}) {
  return (
    <div className={cn(
      'rounded-md border px-2.5 py-2 transition-colors',
      ki.active ? 'bg-background' : 'bg-muted/30 opacity-70',
    )}>
      {/* Header */}
      <button onClick={onToggle} className="w-full flex items-start gap-2 text-left">
        {expanded
          ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
          : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate">{ki.title}</span>
            {ki.active
              ? <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
              : <XCircle className="h-3 w-3 text-muted-foreground shrink-0" />
            }
          </div>
          {!expanded && ki.tactic_summary && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{ki.tactic_summary}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="outline" className="text-[9px] px-1 py-0">{ki.knowledge_type}</Badge>
          <span className="text-[9px] text-muted-foreground tabular-nums">{Math.round(ki.confidence_score * 100)}%</span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-2 pl-5 space-y-2">
          {/* Summary */}
          {ki.tactic_summary && (
            <DetailBlock label="Summary">{ki.tactic_summary}</DetailBlock>
          )}

          {/* Why it matters */}
          {ki.why_it_matters && (
            <DetailBlock label="Why It Matters">{ki.why_it_matters}</DetailBlock>
          )}

          {/* When to use */}
          {ki.when_to_use && (
            <DetailBlock label="When to Use">{ki.when_to_use}</DetailBlock>
          )}

          {/* Example */}
          {ki.example_usage && (
            <DetailBlock label="Example">{ki.example_usage}</DetailBlock>
          )}

          {/* Contexts */}
          {ki.applies_to_contexts.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground">Contexts</span>
              <div className="flex flex-wrap gap-1">
                {ki.applies_to_contexts.map((ctx, i) => (
                  <Badge key={i} variant="secondary" className="text-[9px] px-1.5 py-0">{ctx}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Source Evidence */}
          {ki.source_excerpt && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground">Source Evidence</span>
                {ki.source_char_range && onJumpToContent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[9px] px-1.5 gap-1"
                    onClick={() => onJumpToContent(ki.source_char_range)}
                  >
                    <BookOpen className="h-2.5 w-2.5" /> Jump to content
                  </Button>
                )}
              </div>
              {ki.source_heading && (
                <p className="text-[10px] text-muted-foreground italic">§ {ki.source_heading}</p>
              )}
              <blockquote className="text-[10px] font-mono bg-muted/30 rounded px-2 py-1.5 border-l-2 border-primary/30 max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                {ki.source_excerpt}
              </blockquote>
            </div>
          )}

          {/* Meta */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t">
            <span>Method: {ki.extraction_method ?? '—'}</span>
            <span>Chapter: {ki.chapter}</span>
            <span>{new Date(ki.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      <p className="text-xs">{children}</p>
    </div>
  );
}

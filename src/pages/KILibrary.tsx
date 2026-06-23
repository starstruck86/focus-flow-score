import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

function AnnotationField({ kiId, userId, initialNote, onSaved }: { kiId: string; userId: string; initialNote: string; onSaved: () => void }) {
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setNote(initialNote); }, [initialNote]);

  const save = async () => {
    if (!userId) return;
    if (note === initialNote) return;
    setSaving(true);
    await (supabase as any).from('ki_annotations').upsert(
      { user_id: userId, ki_id: kiId, note, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,ki_id' }
    );
    setSaving(false);
    setSaved(true);
    onSaved();
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mt-3 pt-3 border-t border-border/40" onClick={(e) => e.stopPropagation()}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">📝 My Note</p>
      <textarea
        className="w-full text-xs bg-muted/30 border border-border/60 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/50"
        rows={2}
        placeholder="Add your own context, memory cue, or deal application..."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={save}
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-muted-foreground">Auto-saves on blur</span>
        {saving && <span className="text-[10px] text-muted-foreground">Saving…</span>}
        {saved && <span className="text-[10px] text-green-500">✓ Saved</span>}
      </div>
    </div>
  );
}

type KIResult = {
  id: string;
  title: string;
  spider_dimension: string | null;
  intelligence_type: string | null;
  tactic_summary: string | null;
  when_to_use: string | null;
  example_usage: string | null;
  why_it_matters: string | null;
};

const DIMENSIONS = [
  { value: 'all', label: 'All', count: 586 },
  { value: 'expansion_strategy', label: 'Expansion', count: 112 },
  { value: 'product_knowledge', label: 'Product', count: 335 },
  { value: 'discovery', label: 'Discovery', count: 57 },
  { value: 'deal_control', label: 'Deal Control', count: 40 },
  { value: 'competitive', label: 'Competitive', count: 37 },
  { value: 'stakeholder_navigation', label: 'Stakeholder', count: 5 },
];

const HEADS = [
  { value: 'all', label: 'All Heads', count: 586 },
  { value: 'sales', label: 'Sales Intel', count: 214 },
  { value: 'product', label: 'Product Intel', count: 335 },
  { value: 'competitive', label: 'Competitive Intel', count: 37 },
];

const DIM_COLORS: Record<string, string> = {
  product_knowledge: 'bg-green-500/15 text-green-600',
  expansion_strategy: 'bg-blue-500/15 text-blue-600',
  discovery: 'bg-amber-500/15 text-amber-600',
  deal_control: 'bg-red-500/15 text-red-600',
  competitive: 'bg-purple-500/15 text-purple-600',
  stakeholder_navigation: 'bg-indigo-500/15 text-indigo-600',
};

const DIM_LABELS: Record<string, string> = {
  product_knowledge: 'Product',
  expansion_strategy: 'Expansion',
  discovery: 'Discovery',
  deal_control: 'Deal Control',
  competitive: 'Competitive',
  stakeholder_navigation: 'Stakeholder',
};

function KICard({ ki, onDrill, userId, annotation, onAnnotationSaved }: { ki: KIResult; onDrill: (ki: KIResult) => void; userId: string; annotation?: string; onAnnotationSaved: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded-lg border border-border bg-card p-3 space-y-2 cursor-pointer hover:border-primary/30 transition-colors"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-snug line-clamp-2 flex-1">{ki.title}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          {annotation && <span className="text-[10px] text-amber-500" title="You have a note">📝</span>}
          <span
            className={cn(
              'text-[10px] font-bold px-2 py-0.5 rounded-full',
              DIM_COLORS[ki.spider_dimension ?? ''] ?? 'bg-muted text-muted-foreground',
            )}
          >
            {DIM_LABELS[ki.spider_dimension ?? ''] ?? ki.spider_dimension}
          </span>
        </div>
      </div>

      {ki.tactic_summary && (
        <p className={cn('text-xs text-muted-foreground leading-relaxed', !expanded && 'line-clamp-2')}>
          {ki.tactic_summary}
        </p>
      )}

      {expanded && ki.when_to_use && (
        <div className="pt-1 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">When to use</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{ki.when_to_use}</p>
        </div>
      )}

      {expanded && ki.example_usage && (
        <div className="pl-2 border-l-2 border-primary/30">
          <p className="text-[11px] italic text-muted-foreground">
            "{ki.example_usage.slice(0, 200)}
            {ki.example_usage.length > 200 ? '…' : ''}"
          </p>
        </div>
      )}

      {expanded && (
        <AnnotationField
          kiId={ki.id}
          userId={userId}
          initialNote={annotation ?? ''}
          onSaved={onAnnotationSaved}
        />
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-muted-foreground">
          {expanded ? 'Click to collapse ↑' : 'Click to expand ↓'}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDrill(ki);
          }}
          className="text-xs font-medium text-primary hover:text-primary/80 px-2 py-1 rounded-lg bg-primary/5 hover:bg-primary/10 transition-all"
        >
          Drill →
        </button>
      </div>
    </div>
  );
}

export default function KILibrary() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dimension, setDimension] = useState(params.get('dimension') ?? 'all');
  const [intelligenceType, setIntelligenceType] = useState('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 300);
  };

  const { data: results, isLoading } = useQuery({
    queryKey: ['ki-search', user?.id, search, dimension, intelligenceType],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      if (!user) return [];
      let q = supabase
        .from('knowledge_items')
        .select('id, title, spider_dimension, intelligence_type, tactic_summary, when_to_use, example_usage, why_it_matters')
        .eq('user_id', user.id)
        .eq('chapter', 'branch_io')
        .eq('active', true);

      const trimmed = search.trim();
      if (trimmed.length >= 2) {
        const safe = trimmed.replace(/[%,()]/g, ' ');
        q = q.or(`title.ilike.%${safe}%,tactic_summary.ilike.%${safe}%,example_usage.ilike.%${safe}%`);
      }
      if (dimension !== 'all') q = q.eq('spider_dimension', dimension);
      if (intelligenceType !== 'all') q = q.eq('intelligence_type', intelligenceType);

      const { data, error } = await q.order('spider_dimension').order('title').limit(50);
      if (error) {
        console.warn('[KILibrary] search error', error);
        return [];
      }
      return (data ?? []) as KIResult[];
    },
  });

  const { data: annotations, refetch: refetchAnnotations } = useQuery({
    queryKey: ['ki-annotations', user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      if (!user?.id) return {} as Record<string, string>;
      const { data } = await (supabase as any)
        .from('ki_annotations')
        .select('ki_id, note')
        .eq('user_id', user.id);
      const map: Record<string, string> = {};
      (data ?? []).forEach((a: any) => { map[a.ki_id] = a.note; });
      return map;
    },
  });

  const handleDrill = (ki: KIResult) => {
    navigate('/sharpen', {
      state: { branchMode: true, dimension: ki.spider_dimension, specificKIId: ki.id },
    });
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col z-40">
      {/* Header */}
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate('/dojo')}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" /> Dojo
        </button>
        <div className="flex items-center gap-2 ml-2">
          <h1 className="text-base font-bold">KI Library</h1>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
            586 KIs
          </span>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="border-b border-border bg-card/30 px-4 py-3 space-y-3 shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search plays... (deal control, CCPA, deep linking, QBR...)"
          className="w-full px-4 py-2.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
        />

        <div className="flex gap-1.5 flex-wrap">
          {DIMENSIONS.map((d) => (
            <button
              key={d.value}
              onClick={() => setDimension(d.value)}
              className={cn(
                'text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all',
                dimension === d.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted',
              )}
            >
              {d.label} <span className="opacity-60">({d.count})</span>
            </button>
          ))}
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {HEADS.map((h) => (
            <button
              key={h.value}
              onClick={() => setIntelligenceType(h.value)}
              className={cn(
                'text-[10px] font-medium px-2 py-0.5 rounded-md border transition-all',
                intelligenceType === h.value
                  ? 'bg-foreground/90 text-background border-foreground'
                  : 'bg-transparent border-border/60 text-muted-foreground hover:bg-muted/40',
              )}
            >
              {h.label} <span className="opacity-60">({h.count})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2 animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-2/3" />
            </div>
          ))
        ) : !results || results.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {search.trim().length >= 2
              ? `No plays match "${search}". Try a different keyword.`
              : 'No KIs available yet.'}
          </div>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground px-1">
              {results.length} result{results.length === 1 ? '' : 's'}
              {search.trim().length >= 2 ? ` for "${search}"` : ''}
            </p>
            {results.map((ki) => (
              <KICard
                key={ki.id}
                ki={ki}
                onDrill={handleDrill}
                userId={user?.id ?? ''}
                annotation={annotations?.[ki.id]}
                onAnnotationSaved={() => refetchAnnotations()}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

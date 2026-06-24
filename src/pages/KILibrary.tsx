import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
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
  chapter: string;
  spider_dimension: string | null;
  intelligence_type: string | null;
  tactic_summary: string | null;
  when_to_use: string | null;
  example_usage: string | null;
  why_it_matters: string | null;
};

const PAGE_SIZE = 25;

type DimMeta = { value: string; label: string; emoji: string; color: string };

const INTELLIGENCE_TYPES: DimMeta[] = [
  { value: 'all',                    label: 'All Intelligence', emoji: '🧠', color: 'bg-muted text-muted-foreground' },
  { value: 'discovery',              label: 'Discovery',        emoji: '🔍', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  { value: 'internal_prospecting',   label: 'Prospecting',      emoji: '📞', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  { value: 'stakeholder_navigation', label: 'Stakeholder',      emoji: '🏛️', color: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400' },
  { value: 'messaging',              label: 'Messaging',        emoji: '💬', color: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400' },
  { value: 'deal_control',           label: 'Deal Control',     emoji: '⚔️', color: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  { value: 'objection_handling',     label: 'Objections',       emoji: '🛑', color: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' },
  { value: 'expansion_strategy',     label: 'Expansion',        emoji: '📈', color: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  { value: 'product_knowledge',      label: 'Branch Product',   emoji: '🌿', color: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' },
  { value: 'competitive',            label: 'Competitive',      emoji: '🎯', color: 'bg-purple-500/15 text-purple-700 dark:text-purple-400' },
  { value: 'c_suite_engagement',     label: 'C-Suite',          emoji: '👔', color: 'bg-violet-500/15 text-violet-700 dark:text-violet-400' },
  { value: 'qualification',          label: 'Qualification',    emoji: '✅', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  { value: '__null__',               label: 'Leadership',       emoji: '🎓', color: 'bg-pink-500/15 text-pink-700 dark:text-pink-400' },
];

const DIM_BY_VALUE: Record<string, DimMeta> = Object.fromEntries(INTELLIGENCE_TYPES.map(d => [d.value, d]));

const DIMENSION_CHAPTERS: Record<string, string[]> = {
  discovery: ['discovery', 'branch_io'],
  internal_prospecting: ['cold_calling', 'social_selling'],
  stakeholder_navigation: ['stakeholder_navigation', 'personas', 'branch_io'],
  messaging: ['messaging', 'demo'],
  deal_control: ['closing', 'negotiation', 'follow_up', 'branch_io'],
  objection_handling: ['objection_handling'],
  expansion_strategy: ['expansion', 'branch_io'],
  product_knowledge: ['branch_io'],
  competitive: ['competitive', 'competitors', 'branch_io'],
  c_suite_engagement: ['personas'],
  qualification: ['qualification'],
  __null__: ['coaching', 'leadership', 'hiring', 'management', 'onboarding', 'general'],
};

function formatChapterLabel(chapter: string): string {
  if (chapter === 'branch_io') return '🌿 Branch';
  return chapter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function KICard({ ki, onDrill, userId, annotation, onAnnotationSaved }: { ki: KIResult; onDrill: (ki: KIResult) => void; userId: string; annotation?: string; onAnnotationSaved: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const dimKey = ki.spider_dimension ?? '__null__';
  const dimMeta = DIM_BY_VALUE[dimKey];
  return (
    <div
      className="rounded-lg border border-border bg-card p-3 space-y-2 cursor-pointer hover:border-primary/30 transition-colors"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-snug line-clamp-2 flex-1">{ki.title}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          {annotation && <span className="text-[10px] text-amber-500" title="You have a note">📝</span>}
          {dimMeta && (
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', dimMeta.color)}>
              {dimMeta.emoji} {dimMeta.label}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
          {formatChapterLabel(ki.chapter)}
        </span>
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

      {expanded && ki.why_it_matters && (
        <div className="pt-1 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Why it matters</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{ki.why_it_matters}</p>
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
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [dimension, setDimension] = useState<string>(params.get('dimension') ?? 'all');
  const [chapterFilter, setChapterFilter] = useState<string>('all');
  const [branchHead, setBranchHead] = useState<string>('all');
  const [page, setPage] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setPage(0); }, [search, dimension, chapterFilter, branchHead]);
  useEffect(() => { setChapterFilter('all'); setBranchHead('all'); }, [dimension]);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 300);
  };

  const { data: dimCounts } = useQuery({
    queryKey: ['ki-dim-counts-v2', user?.id],
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!user) return {} as Record<string, number>;
      const PAGE = 1000;
      let from = 0;
      const counts: Record<string, number> = { all: 0 };
      while (true) {
        const { data, error } = await supabase
          .from('knowledge_items')
          .select('spider_dimension')
          .eq('user_id', user.id)
          .eq('active', true)
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        for (const ki of data as any[]) {
          counts.all++;
          const dim = ki.spider_dimension ?? '__null__';
          counts[dim] = (counts[dim] || 0) + 1;
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return counts;
    },
  });

  const { data: results, isLoading, isFetching } = useQuery({
    queryKey: ['ki-search-v3', user?.id, search, dimension, chapterFilter, branchHead, page],
    enabled: !!user,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (!user) return [];
      let q = supabase
        .from('knowledge_items')
        .select('id, title, chapter, spider_dimension, intelligence_type, tactic_summary, when_to_use, example_usage, why_it_matters')
        .eq('user_id', user.id)
        .eq('active', true);

      if (dimension !== 'all') {
        if (dimension === '__null__') q = q.is('spider_dimension', null);
        else q = q.eq('spider_dimension', dimension);
      }
      if (chapterFilter !== 'all') q = q.eq('chapter', chapterFilter);
      if (chapterFilter === 'branch_io' && branchHead !== 'all') {
        q = q.eq('intelligence_type', branchHead);
      }

      const trimmed = search.trim();
      if (trimmed.length >= 2) {
        const safe = trimmed.replace(/[%,()]/g, ' ');
        q = q.or(`title.ilike.%${safe}%,tactic_summary.ilike.%${safe}%`);
      }

      const { data, error } = await q
        .order('confidence_score', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) { console.warn('[KILibrary] error', error); return []; }
      return (data ?? []) as KIResult[];
    },
  });

  const { data: totalCount } = useQuery({
    queryKey: ['ki-count-v3', user?.id, search, dimension, chapterFilter, branchHead],
    enabled: !!user,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (!user) return 0;
      let q = supabase
        .from('knowledge_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('active', true);
      if (dimension !== 'all') {
        if (dimension === '__null__') q = q.is('spider_dimension', null);
        else q = q.eq('spider_dimension', dimension);
      }
      if (chapterFilter !== 'all') q = q.eq('chapter', chapterFilter);
      if (chapterFilter === 'branch_io' && branchHead !== 'all') {
        q = q.eq('intelligence_type', branchHead);
      }
      const trimmed = search.trim();
      if (trimmed.length >= 2) {
        const safe = trimmed.replace(/[%,()]/g, ' ');
        q = q.or(`title.ilike.%${safe}%,tactic_summary.ilike.%${safe}%`);
      }
      const { count } = await q;
      return count ?? 0;
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

  const availableChapters = useMemo(() => {
    if (dimension === 'all') return [];
    const chapters = DIMENSION_CHAPTERS[dimension] ?? [];
    return chapters.length > 1 ? chapters : [];
  }, [dimension]);

  const handleDrill = (ki: KIResult) => {
    if (ki.chapter === 'branch_io') {
      navigate('/sharpen', {
        state: { branchMode: true, dimension: ki.spider_dimension, specificKIId: ki.id },
      });
    } else {
      navigate('/sharpen', {
        state: { chapter: ki.chapter, specificKIId: ki.id, dimension: ki.spider_dimension },
      });
    }
  };

  const total = totalCount ?? 0;
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="fixed inset-0 bg-background flex flex-col z-40">
      {/* Header */}
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="flex items-center gap-2 ml-2">
          <h1 className="text-base font-bold">Intelligence Library</h1>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
            {(dimCounts?.all ?? 0).toLocaleString()} KIs
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
          placeholder="Search intelligence... (cold call, objection, champion, pricing...)"
          className="w-full px-4 py-2.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
        />

        {/* Dimension (intelligence type) pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
          {INTELLIGENCE_TYPES.map((d) => {
            const cnt = dimCounts?.[d.value] ?? 0;
            const selected = dimension === d.value;
            return (
              <button
                key={d.value}
                onClick={() => setDimension(d.value)}
                className={cn(
                  'text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all whitespace-nowrap shrink-0',
                  selected
                    ? cn(d.color, 'border-current')
                    : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted',
                )}
              >
                <span className="mr-1">{d.emoji}</span>
                {d.label}
                <span className="opacity-60 ml-1">({cnt.toLocaleString()})</span>
              </button>
            );
          })}
        </div>

        {/* Chapter sub-filter (source within dimension) */}
        {availableChapters.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
            <button
              onClick={() => setChapterFilter('all')}
              className={cn(
                'text-[10px] font-medium px-2 py-0.5 rounded-md border transition-all whitespace-nowrap shrink-0',
                chapterFilter === 'all'
                  ? 'bg-foreground/90 text-background border-foreground'
                  : 'bg-transparent border-border/60 text-muted-foreground hover:bg-muted/40',
              )}
            >
              All sources
            </button>
            {availableChapters.map((ch) => (
              <button
                key={ch}
                onClick={() => setChapterFilter(ch)}
                className={cn(
                  'text-[10px] font-medium px-2 py-0.5 rounded-md border transition-all whitespace-nowrap shrink-0',
                  chapterFilter === ch
                    ? 'bg-foreground/90 text-background border-foreground'
                    : 'bg-transparent border-border/60 text-muted-foreground hover:bg-muted/40',
                )}
              >
                {formatChapterLabel(ch)}
              </button>
            ))}
          </div>
        )}

        {/* Branch intelligence_type filter — only when viewing branch_io */}
        {chapterFilter === 'branch_io' && (
          <div className="flex gap-1.5 flex-wrap">
            {[
              { value: 'all', label: 'All Branch' },
              { value: 'product', label: '🌿 Product' },
              { value: 'sales', label: '📊 Sales Plays' },
              { value: 'competitive', label: '🎯 Competitive' },
            ].map((h) => (
              <button
                key={h.value}
                onClick={() => setBranchHead(h.value)}
                className={cn(
                  'text-[10px] font-medium px-2 py-0.5 rounded-md border transition-all',
                  branchHead === h.value
                    ? 'bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/40'
                    : 'bg-transparent border-border/60 text-muted-foreground hover:bg-muted/40',
                )}
              >
                {h.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {isLoading && !results ? (
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
              ? `No intelligence matches "${search}". Try a different keyword.`
              : 'No KIs available in this filter.'}
          </div>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground px-1 flex items-center justify-between">
              <span>
                Showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()} results
                {search.trim().length >= 2 ? ` for "${search}"` : ''}
              </span>
              {isFetching && <span className="opacity-60">Loading…</span>}
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

            {/* Pagination */}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between pt-3 pb-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← Previous
                </button>
                <span className="text-[11px] text-muted-foreground">
                  Page {page + 1} of {totalPages.toLocaleString()}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={end >= total}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

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

const CATEGORY_CHAPTERS: Record<string, string[]> = {
  prospecting: ['cold_calling', 'messaging', 'follow_up', 'social_selling', 're_engagement', 'sequencing', 'running_sales_day', 'running_your_sales_day'],
  discovery: ['discovery', 'qualification', 'demo', 'personas', 'rapport', 'rapport_building', 'building_trust'],
  deal_control: ['closing', 'negotiation', 'objection_handling', 'pricing', 'expansion'],
  stakeholder: ['stakeholder_navigation', 'personas', 'c_suite_call', 'preparing_for_c_suite', 'executive_engagement', 'stakeholder navigation'],
  competitive: ['competitive', 'competitors'],
  branch: ['branch_io'],
  leadership: ['coaching', 'leadership', 'hiring', 'hiring top talent', 'hiring_top_talent', 'management', 'sales_leadership', 'team_management', 'sdr_management', 'onboarding', 'training', 'career_pathing', 'career_development', 'career_growth', 'mindset', 'personal_development', 'self_management', 'self_improvement', 'self_development', 'continuous_self_development', 'performance_management', 'developing_people', 'developing_your_people', 'people', 'motivation', 'skill_development', 'enablement', 'call_coaching', 'sales_management', 'sales_enablement'],
  general: ['general', 'sales_process', 'data_driven_sales', 'general_sales_skills', 'planning', 'strategy', 'productivity', 'time_management', 'ai_enablement', 'ai strategy', 'strategic_planning', 'networking', 'personal_branding', 'sales_career', 'professional_development', 'marketing', 'product', 'product_feedback'],
};

type CategoryMeta = { value: string; label: string; emoji: string; color: string };

const CATEGORIES: CategoryMeta[] = [
  { value: 'all', label: 'All Intelligence', emoji: '🧠', color: 'bg-muted text-muted-foreground' },
  { value: 'branch', label: 'Branch Intel', emoji: '🌿', color: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  { value: 'prospecting', label: 'Prospecting', emoji: '📞', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  { value: 'discovery', label: 'Discovery', emoji: '🔍', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  { value: 'deal_control', label: 'Deal Control', emoji: '⚔️', color: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  { value: 'stakeholder', label: 'Stakeholder', emoji: '🏛️', color: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400' },
  { value: 'competitive', label: 'Competitive', emoji: '🎯', color: 'bg-purple-500/15 text-purple-700 dark:text-purple-400' },
  { value: 'leadership', label: 'Leadership', emoji: '🎓', color: 'bg-pink-500/15 text-pink-700 dark:text-pink-400' },
  { value: 'general', label: 'General', emoji: '⚙️', color: 'bg-slate-500/15 text-slate-700 dark:text-slate-400' },
];

const CATEGORY_BY_VALUE: Record<string, CategoryMeta> = Object.fromEntries(CATEGORIES.map(c => [c.value, c]));

const DIMENSIONS = [
  { value: 'all', label: 'All Dimensions' },
  { value: 'expansion_strategy', label: 'Expansion' },
  { value: 'product_knowledge', label: 'Product' },
  { value: 'discovery', label: 'Discovery' },
  { value: 'deal_control', label: 'Deal Control' },
  { value: 'competitive', label: 'Competitive' },
  { value: 'stakeholder_navigation', label: 'Stakeholder' },
  { value: 'internal_prospecting', label: 'Prospecting' },
  { value: 'messaging', label: 'Messaging' },
  { value: 'objection_handling', label: 'Objections' },
  { value: 'c_suite_engagement', label: 'C-Suite' },
  { value: 'qualification', label: 'Qualification' },
];

const DIM_COLORS: Record<string, string> = {
  product_knowledge: 'bg-green-500/15 text-green-600',
  expansion_strategy: 'bg-blue-500/15 text-blue-600',
  discovery: 'bg-amber-500/15 text-amber-600',
  deal_control: 'bg-red-500/15 text-red-600',
  competitive: 'bg-purple-500/15 text-purple-600',
  stakeholder_navigation: 'bg-indigo-500/15 text-indigo-600',
  internal_prospecting: 'bg-blue-500/15 text-blue-600',
  messaging: 'bg-cyan-500/15 text-cyan-600',
  objection_handling: 'bg-orange-500/15 text-orange-600',
  c_suite_engagement: 'bg-indigo-500/15 text-indigo-600',
  qualification: 'bg-amber-500/15 text-amber-600',
};

const DIM_LABELS: Record<string, string> = {
  product_knowledge: 'Product',
  expansion_strategy: 'Expansion',
  discovery: 'Discovery',
  deal_control: 'Deal Control',
  competitive: 'Competitive',
  stakeholder_navigation: 'Stakeholder',
  internal_prospecting: 'Prospecting',
  messaging: 'Messaging',
  objection_handling: 'Objections',
  c_suite_engagement: 'C-Suite',
  qualification: 'Qualification',
};

const BRANCH_HEADS = [
  { value: 'all', label: 'All' },
  { value: 'product', label: 'Product' },
  { value: 'sales', label: 'Sales Plays' },
  { value: 'competitive', label: 'Competitive' },
];

function getChapterCategory(chapter: string): string {
  for (const [cat, chapters] of Object.entries(CATEGORY_CHAPTERS)) {
    if (chapters.includes(chapter)) return cat;
  }
  return 'all';
}

function formatChapterLabel(chapter: string): string {
  return chapter
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function KICard({ ki, onDrill, userId, annotation, onAnnotationSaved }: { ki: KIResult; onDrill: (ki: KIResult) => void; userId: string; annotation?: string; onAnnotationSaved: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const catKey = getChapterCategory(ki.chapter);
  const catMeta = CATEGORY_BY_VALUE[catKey] ?? CATEGORY_BY_VALUE.all;
  return (
    <div
      className="rounded-lg border border-border bg-card p-3 space-y-2 cursor-pointer hover:border-primary/30 transition-colors"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-snug line-clamp-2 flex-1">{ki.title}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          {annotation && <span className="text-[10px] text-amber-500" title="You have a note">📝</span>}
          {ki.spider_dimension && (
            <span
              className={cn(
                'text-[10px] font-bold px-2 py-0.5 rounded-full',
                DIM_COLORS[ki.spider_dimension] ?? 'bg-muted text-muted-foreground',
              )}
            >
              {DIM_LABELS[ki.spider_dimension] ?? ki.spider_dimension}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', catMeta.color)}>
          {catMeta.emoji} {formatChapterLabel(ki.chapter)}
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
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [chapter, setChapter] = useState<string>('all');
  const [dimension, setDimension] = useState<string>(params.get('dimension') ?? 'all');
  const [branchHead, setBranchHead] = useState<string>('all');
  const [page, setPage] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setPage(0); }, [search, category, chapter, dimension, branchHead]);
  useEffect(() => { setChapter('all'); }, [category]);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 300);
  };

  const { data: categoryCounts } = useQuery({
    queryKey: ['ki-category-counts', user?.id],
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!user) return {} as Record<string, number>;
      // Paginate to avoid PostgREST 1000-row default cap
      const PAGE = 1000;
      let from = 0;
      const allRows: { chapter: string }[] = [];
      while (true) {
        const { data, error } = await supabase
          .from('knowledge_items')
          .select('chapter')
          .eq('user_id', user.id)
          .eq('active', true)
          .range(from, from + PAGE - 1);
        if (error) break;
        if (!data || data.length === 0) break;
        allRows.push(...(data as { chapter: string }[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }
      const counts: Record<string, number> = { all: allRows.length };
      Object.entries(CATEGORY_CHAPTERS).forEach(([cat, chapters]) => {
        counts[cat] = allRows.filter(r => chapters.includes(r.chapter)).length;
      });
      return counts;
    },
  });

  const { data: results, isLoading, isFetching } = useQuery({
    queryKey: ['ki-search-v2', user?.id, search, category, chapter, dimension, branchHead, page],
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

      if (category !== 'all') {
        const chapters = CATEGORY_CHAPTERS[category] ?? [];
        if (chapters.length > 0) q = q.in('chapter', chapters);
      }
      if (chapter !== 'all') q = q.eq('chapter', chapter);
      if (dimension !== 'all') q = q.eq('spider_dimension', dimension);
      if (category === 'branch' && branchHead !== 'all') q = q.eq('intelligence_type', branchHead);

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
    queryKey: ['ki-count', user?.id, search, category, chapter, dimension, branchHead],
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
      if (category !== 'all') { const chapters = CATEGORY_CHAPTERS[category] ?? []; if (chapters.length > 0) q = q.in('chapter', chapters); }
      if (chapter !== 'all') q = q.eq('chapter', chapter);
      if (dimension !== 'all') q = q.eq('spider_dimension', dimension);
      if (category === 'branch' && branchHead !== 'all') q = q.eq('intelligence_type', branchHead);
      const trimmed = search.trim();
      if (trimmed.length >= 2) { const safe = trimmed.replace(/[%,()]/g, ' '); q = q.or(`title.ilike.%${safe}%,tactic_summary.ilike.%${safe}%`); }
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

  // Chapter sub-filter options for current category (only chapters with KIs)
  const availableChapters = useMemo(() => {
    if (category === 'all') return [];
    const chapters = CATEGORY_CHAPTERS[category] ?? [];
    if (chapters.length <= 1) return [];
    // We don't have per-chapter counts; just show all defined chapters for the category
    return chapters;
  }, [category]);

  const handleDrill = (ki: KIResult) => {
    if (category === 'branch' || ki.chapter === 'branch_io') {
      navigate('/sharpen', {
        state: { branchMode: true, dimension: ki.spider_dimension, specificKIId: ki.id },
      });
    } else {
      navigate('/sharpen', {
        state: { chapter: ki.chapter, specificKIId: ki.id },
      });
    }
  };

  const total = totalCount ?? 0;
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showDimensions = category !== 'leadership';

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
            {(categoryCounts?.all ?? 0).toLocaleString()} KIs
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

        {/* Category pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
          {CATEGORIES.map((c) => {
            const cnt = categoryCounts?.[c.value] ?? 0;
            const selected = category === c.value;
            return (
              <button
                key={c.value}
                onClick={() => setCategory(c.value)}
                className={cn(
                  'text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all whitespace-nowrap shrink-0',
                  selected
                    ? cn(c.color, 'border-current')
                    : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted',
                )}
              >
                <span className="mr-1">{c.emoji}</span>
                {c.label}
                <span className="opacity-60 ml-1">({cnt.toLocaleString()})</span>
              </button>
            );
          })}
        </div>

        {/* Chapter sub-filter */}
        {availableChapters.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
            <button
              onClick={() => setChapter('all')}
              className={cn(
                'text-[10px] font-medium px-2 py-0.5 rounded-md border transition-all whitespace-nowrap shrink-0',
                chapter === 'all'
                  ? 'bg-foreground/90 text-background border-foreground'
                  : 'bg-transparent border-border/60 text-muted-foreground hover:bg-muted/40',
              )}
            >
              All chapters
            </button>
            {availableChapters.map((ch) => (
              <button
                key={ch}
                onClick={() => setChapter(ch)}
                className={cn(
                  'text-[10px] font-medium px-2 py-0.5 rounded-md border transition-all whitespace-nowrap shrink-0',
                  chapter === ch
                    ? 'bg-foreground/90 text-background border-foreground'
                    : 'bg-transparent border-border/60 text-muted-foreground hover:bg-muted/40',
                )}
              >
                {formatChapterLabel(ch)}
              </button>
            ))}
          </div>
        )}

        {/* Branch intelligence_type filter */}
        {category === 'branch' && (
          <div className="flex gap-1.5 flex-wrap">
            {BRANCH_HEADS.map((h) => (
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

        {/* Dimension filter */}
        {showDimensions && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
            {DIMENSIONS.map((d) => (
              <button
                key={d.value}
                onClick={() => setDimension(d.value)}
                className={cn(
                  'text-[10px] font-medium px-2 py-0.5 rounded-md border transition-all whitespace-nowrap shrink-0',
                  dimension === d.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent border-border/60 text-muted-foreground hover:bg-muted/40',
                )}
              >
                {d.label}
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

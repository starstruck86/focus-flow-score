import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, FileText } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Row = {
  id: string;
  title: string | null;
  knowledge_type: string | null;
  chapter: string | null;
  sub_chapter: string | null;
  competitor_name: string | null;
  product_area: string | null;
  applies_to_contexts: string[] | null;
  tactic_summary: string | null;
  why_it_matters: string | null;
  when_to_use: string | null;
  when_not_to_use: string | null;
  example_usage: string | null;
  macro_situation: string | null;
  micro_strategy: string | null;
  how_to_execute: string | null;
  what_this_unlocks: string | null;
  confidence_score: number | null;
  status: string | null;
  active: boolean | null;
  tags: string[] | null;
  who: string | null;
  framework: string | null;
  source_title: string | null;
  source_location: string | null;
  source_excerpt: string | null;
  source_resource_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const COLS =
  'id,title,knowledge_type,chapter,sub_chapter,competitor_name,product_area,applies_to_contexts,tactic_summary,why_it_matters,when_to_use,when_not_to_use,example_usage,macro_situation,micro_strategy,how_to_execute,what_this_unlocks,confidence_score,status,active,tags,who,framework,source_title,source_location,source_excerpt,source_resource_id,created_at,updated_at';

type ExportMode = 'full' | 'since_last_full' | 'since_date' | 'chapters' | 'resources';

const LS_LAST_FULL = 'ki_export_last_full_at';

type Filter = {
  mode: ExportMode;
  sinceDate?: string;
  chapters?: string[];
  resourceIds?: string[];
};

async function fetchKIs(
  filter: Filter,
  onProgress: (n: number) => void,
): Promise<Row[]> {
  const PAGE = 1000;
  let from = 0;
  const all: Row[] = [];
  while (true) {
    let q = supabase
      .from('knowledge_items' as any)
      .select(COLS)
      .order('chapter', { ascending: true })
      .order('confidence_score', { ascending: false })
      .range(from, from + PAGE - 1);

    if (filter.mode === 'since_last_full' || filter.mode === 'since_date') {
      const since = filter.sinceDate;
      if (since) q = q.gte('created_at', since);
    } else if (filter.mode === 'chapters' && filter.chapters?.length) {
      q = q.in('chapter', filter.chapters);
    } else if (filter.mode === 'resources' && filter.resourceIds?.length) {
      q = q.in('source_resource_id', filter.resourceIds);
    }

    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    if (!rows.length) break;
    all.push(...rows);
    onProgress(all.length);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function titleCase(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function field(label: string, value: string | null | undefined) {
  const v = (value ?? '').trim();
  if (!v) return '';
  return `- **${label}:** ${v.replace(/\n+/g, ' ')}\n`;
}

function renderKI(ki: Row, idx: number): string {
  const lines: string[] = [];
  lines.push(`### ${idx}. ${ki.title || '(untitled)'}\n`);
  const meta: string[] = [];
  if (ki.knowledge_type) meta.push(`type: ${ki.knowledge_type}`);
  if (ki.sub_chapter) meta.push(`sub-chapter: ${ki.sub_chapter}`);
  if (ki.competitor_name) meta.push(`competitor: ${ki.competitor_name}`);
  if (ki.product_area) meta.push(`product: ${ki.product_area}`);
  if (ki.who) meta.push(`who: ${ki.who}`);
  if (ki.framework) meta.push(`framework: ${ki.framework}`);
  if (typeof ki.confidence_score === 'number') meta.push(`confidence: ${ki.confidence_score.toFixed(2)}`);
  if (ki.status) meta.push(`status: ${ki.status}`);
  if (meta.length) lines.push(`_${meta.join(' · ')}_\n`);
  if (ki.applies_to_contexts?.length) lines.push(`_contexts: ${ki.applies_to_contexts.join(', ')}_\n`);
  if (ki.tags?.length) lines.push(`_tags: ${ki.tags.join(', ')}_\n`);
  lines.push('');
  lines.push(field('Tactic', ki.tactic_summary));
  lines.push(field('Why it matters', ki.why_it_matters));
  lines.push(field('When to use', ki.when_to_use));
  lines.push(field('When NOT to use', ki.when_not_to_use));
  lines.push(field('Macro situation', ki.macro_situation));
  lines.push(field('Micro strategy', ki.micro_strategy));
  lines.push(field('How to execute', ki.how_to_execute));
  lines.push(field('What this unlocks', ki.what_this_unlocks));
  lines.push(field('Example', ki.example_usage));
  const src = [ki.source_title, ki.source_location].filter(Boolean).join(' — ');
  if (src) lines.push(field('Source', src));
  if (ki.source_excerpt) lines.push(field('Source excerpt', ki.source_excerpt));
  lines.push(`\n_KI ID: ${ki.id}_\n`);
  return lines.join('');
}

function buildHeader(rows: Row[], scopeLabel: string, byChapter: Map<string, Row[]>, partInfo?: { part: number; total: number }): string {
  const generatedAt = new Date().toISOString();
  const totalActive = rows.filter(r => r.active).length;
  const partSuffix = partInfo ? ` (Part ${partInfo.part} of ${partInfo.total})` : '';
  const partNote = partInfo
    ? `\n_This is **Part ${partInfo.part} of ${partInfo.total}**. Upload all parts together — they form one knowledge base. Chapters may be split across parts._\n`
    : '';

  return `# Sales Knowledge Base — ${scopeLabel}${partSuffix}

_Generated: ${generatedAt}_
_Scope: ${scopeLabel}_
_Total Knowledge Items (KIs) in this export: ${rows.length} (${totalActive} active)_
_Chapters: ${byChapter.size}_${partNote}

## How to use this document (instructions for the assistant)

You are a sales coaching assistant. This document is ${scopeLabel.toLowerCase().includes('full') ? 'the **complete, authoritative knowledge base**' : 'a **partial export** of the knowledge base'} the user has curated from books, podcasts, calls, courses, and frameworks. Every Knowledge Item (KI) below is a discrete tactic, principle, or talk track grounded in real source material.

Rules of engagement:
1. **Ground every answer in these KIs.** When a user asks a sales/coaching question, cite the specific KI(s) by title (and KI ID when useful).
2. **Quote the exact "Tactic" or "Example" verbatim** when giving a tactical answer — do not paraphrase the user's own words back to them.
3. Respect **When NOT to use** — never recommend a KI in a situation it explicitly excludes.
4. Prefer KIs with **higher confidence scores** and KIs whose **contexts** match the user's situation (e.g. "dave", "roleplay", "prep", "objection_handling").
5. If multiple KIs conflict, surface the conflict and let the user choose — do not silently average.
6. If no KI covers the question, say so plainly: _"There is no KI in your library covering this."_ Then offer a general principle, clearly labeled as outside the library.
7. ${scopeLabel.toLowerCase().includes('full') ? 'Group recommendations by **chapter**' : 'This is a partial/incremental export — treat it as an **append/update** to any prior full export you already have'}.

---

`;
}

/** Build per-chapter section strings (header + KIs). Each entry is one chapter block. */
function buildChapterSections(rows: Row[]): { chapter: string; section: string; kiCount: number }[] {
  const byChapter = new Map<string, Row[]>();
  for (const r of rows) {
    const ch = r.chapter || 'uncategorized';
    if (!byChapter.has(ch)) byChapter.set(ch, []);
    byChapter.get(ch)!.push(r);
  }
  return Array.from(byChapter.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ch, items]) => {
      const sorted = [...items].sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0));
      const kis = sorted.map((ki, i) => renderKI(ki, i + 1)).join('\n---\n\n');
      const section = `\n\n## ${titleCase(ch)}\n\n_${items.length} Knowledge Item${items.length === 1 ? '' : 's'} in this chapter._\n\n${kis}\n`;
      return { chapter: ch, section, kiCount: items.length };
    });
}

const MAX_BYTES = 28 * 1024 * 1024; // 28 MB safety margin under 29 MB cap
const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).length;

/** Split a single oversized chapter section into smaller chapter sections at KI boundaries. */
function splitOversizedChapter(chapter: string, rows: Row[], maxBodyBytes: number): { chapter: string; section: string; kiCount: number }[] {
  const sorted = [...rows].sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0));
  const parts: Row[][] = [];
  let current: Row[] = [];
  let currentBytes = 0;
  for (const ki of sorted) {
    const rendered = renderKI(ki, 1) + '\n---\n\n';
    const b = byteLen(rendered);
    if (currentBytes + b > maxBodyBytes && current.length) {
      parts.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(ki);
    currentBytes += b;
  }
  if (current.length) parts.push(current);

  return parts.map((items, idx) => {
    const kis = items.map((ki, i) => renderKI(ki, i + 1)).join('\n---\n\n');
    const label = `${titleCase(chapter)} (cont. ${idx + 1}/${parts.length})`;
    const section = `\n\n## ${label}\n\n_${items.length} Knowledge Item${items.length === 1 ? '' : 's'} in this chapter slice._\n\n${kis}\n`;
    return { chapter: `${chapter}__part${idx + 1}`, section, kiCount: items.length };
  });
}

/** Build one or more markdown files, each ≤ MAX_BYTES. */
function buildMarkdownParts(rows: Row[], scopeLabel: string): string[] {
  const byChapter = new Map<string, Row[]>();
  for (const r of rows) {
    const ch = r.chapter || 'uncategorized';
    if (!byChapter.has(ch)) byChapter.set(ch, []);
    byChapter.get(ch)!.push(r);
  }

  // Probe header size with a placeholder; recompute per-part once we know total count.
  const probeHeader = buildHeader(rows, scopeLabel, byChapter, { part: 1, total: 9 });
  const headerBudget = byteLen(probeHeader) + 4096; // padding for TOC + part label growth
  const bodyBudget = MAX_BYTES - headerBudget;

  // Build sections, splitting any chapter that alone exceeds bodyBudget.
  let sections = buildChapterSections(rows);
  const expanded: typeof sections = [];
  for (const sec of sections) {
    if (byteLen(sec.section) > bodyBudget) {
      const chapterRows = byChapter.get(sec.chapter) || [];
      expanded.push(...splitOversizedChapter(sec.chapter, chapterRows, bodyBudget));
    } else {
      expanded.push(sec);
    }
  }
  sections = expanded;

  // Greedy bin-pack chapter sections into parts.
  const partGroups: { sections: typeof sections; bytes: number }[] = [];
  let group: typeof sections = [];
  let groupBytes = 0;
  for (const sec of sections) {
    const b = byteLen(sec.section);
    if (groupBytes + b > bodyBudget && group.length) {
      partGroups.push({ sections: group, bytes: groupBytes });
      group = [];
      groupBytes = 0;
    }
    group.push(sec);
    groupBytes += b;
  }
  if (group.length) partGroups.push({ sections: group, bytes: groupBytes });

  const totalParts = partGroups.length;

  return partGroups.map((g, idx) => {
    const partRows = g.sections.flatMap(s => byChapter.get(s.chapter.replace(/__part\d+$/, '')) || []);
    const partByChapter = new Map<string, Row[]>();
    for (const s of g.sections) {
      const baseCh = s.chapter.replace(/__part\d+$/, '');
      if (!partByChapter.has(baseCh)) partByChapter.set(baseCh, []);
    }
    const header = buildHeader(
      partRows,
      scopeLabel,
      partByChapter,
      totalParts > 1 ? { part: idx + 1, total: totalParts } : undefined,
    );
    const toc = g.sections
      .map(s => {
        const label = s.chapter.includes('__part')
          ? `${titleCase(s.chapter.replace(/__part\d+$/, ''))} (cont.)`
          : titleCase(s.chapter);
        return `- **${label}** — ${s.kiCount} KI${s.kiCount === 1 ? '' : 's'}`;
      })
      .join('\n');
    const body = g.sections.map(s => s.section).join('\n');
    return header + '## Table of contents (this part)\n\n' + toc + '\n' + body + '\n';
  });
}

export function KnowledgeExport() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState<ExportMode>('full');
  const [sinceDate, setSinceDate] = useState<string>('');
  const [chapters, setChapters] = useState<string[]>([]);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [resourceFilter, setResourceFilter] = useState('');

  const [chapterOptions, setChapterOptions] = useState<{ chapter: string; count: number }[]>([]);
  const [resourceOptions, setResourceOptions] = useState<{ id: string; title: string; count: number }[]>([]);
  const [lastFullAt, setLastFullAt] = useState<string | null>(null);

  useEffect(() => {
    setLastFullAt(localStorage.getItem(LS_LAST_FULL));
  }, []);

  // Lazy-load chapter / resource options when needed.
  useEffect(() => {
    if (mode === 'chapters' && chapterOptions.length === 0) {
      (async () => {
        const PAGE = 1000;
        let from = 0;
        const tally = new Map<string, number>();
        while (true) {
          const { data, error } = await supabase
            .from('knowledge_items' as any)
            .select('chapter')
            .range(from, from + PAGE - 1);
          if (error) { toast.error(error.message); break; }
          const rows = (data ?? []) as unknown as { chapter: string | null }[];
          if (!rows.length) break;
          for (const r of rows) {
            const ch = r.chapter || 'uncategorized';
            tally.set(ch, (tally.get(ch) ?? 0) + 1);
          }
          if (rows.length < PAGE) break;
          from += PAGE;
        }
        setChapterOptions(
          Array.from(tally.entries())
            .map(([chapter, count]) => ({ chapter, count }))
            .sort((a, b) => a.chapter.localeCompare(b.chapter)),
        );
      })();
    }
    if (mode === 'resources' && resourceOptions.length === 0) {
      (async () => {
        const PAGE = 1000;
        let from = 0;
        const tally = new Map<string, number>();
        while (true) {
          const { data, error } = await supabase
            .from('knowledge_items' as any)
            .select('source_resource_id')
            .not('source_resource_id', 'is', null)
            .range(from, from + PAGE - 1);
          if (error) { toast.error(error.message); break; }
          const rows = (data ?? []) as unknown as { source_resource_id: string | null }[];
          if (!rows.length) break;
          for (const r of rows) {
            if (!r.source_resource_id) continue;
            tally.set(r.source_resource_id, (tally.get(r.source_resource_id) ?? 0) + 1);
          }
          if (rows.length < PAGE) break;
          from += PAGE;
        }
        const ids = Array.from(tally.keys());
        // Fetch titles in chunks of 200
        const titleMap = new Map<string, string>();
        for (let i = 0; i < ids.length; i += 200) {
          const slice = ids.slice(i, i + 200);
          const { data } = await supabase
            .from('resources' as any)
            .select('id,title')
            .in('id', slice);
          for (const r of (data ?? []) as unknown as { id: string; title: string | null }[]) {
            titleMap.set(r.id, r.title || '(untitled)');
          }
        }
        setResourceOptions(
          ids
            .map(id => ({ id, title: titleMap.get(id) || '(unknown)', count: tally.get(id) ?? 0 }))
            .sort((a, b) => a.title.localeCompare(b.title)),
        );
      })();
    }
  }, [mode, chapterOptions.length, resourceOptions.length]);

  const filteredResources = useMemo(() => {
    const q = resourceFilter.trim().toLowerCase();
    if (!q) return resourceOptions;
    return resourceOptions.filter(r => r.title.toLowerCase().includes(q));
  }, [resourceOptions, resourceFilter]);

  const scopeLabel = useMemo(() => {
    switch (mode) {
      case 'full': return 'Full Export';
      case 'since_last_full':
        return lastFullAt
          ? `Incremental since last full export (${new Date(lastFullAt).toLocaleDateString()})`
          : 'Incremental (no prior full export — will export all)';
      case 'since_date':
        return sinceDate ? `Created since ${sinceDate}` : 'Created since (date required)';
      case 'chapters':
        return `Chapters: ${chapters.length ? chapters.map(titleCase).join(', ') : '(none selected)'}`;
      case 'resources':
        return `Specific sources: ${resourceIds.length} resource${resourceIds.length === 1 ? '' : 's'}`;
    }
  }, [mode, lastFullAt, sinceDate, chapters, resourceIds]);

  const handleExport = async () => {
    // Validate
    if (mode === 'since_date' && !sinceDate) { toast.error('Pick a date.'); return; }
    if (mode === 'chapters' && chapters.length === 0) { toast.error('Pick at least one chapter.'); return; }
    if (mode === 'resources' && resourceIds.length === 0) { toast.error('Pick at least one source.'); return; }

    setBusy(true);
    setProgress(0);
    try {
      const filter: Filter = { mode };
      if (mode === 'since_last_full') filter.sinceDate = lastFullAt ?? undefined;
      if (mode === 'since_date') filter.sinceDate = new Date(sinceDate).toISOString();
      if (mode === 'chapters') filter.chapters = chapters;
      if (mode === 'resources') filter.resourceIds = resourceIds;

      toast.info('Fetching knowledge items…');
      const rows = await fetchKIs(filter, setProgress);
      if (!rows.length) {
        toast.error('No knowledge items matched this filter.');
        return;
      }
      toast.info(`Building markdown for ${rows.length} KIs…`);
      const parts = buildMarkdownParts(rows, scopeLabel);
      const stamp = new Date().toISOString().slice(0, 10);
      const tag =
        mode === 'full' ? 'full'
        : mode === 'since_last_full' ? 'incremental'
        : mode === 'since_date' ? `since-${sinceDate}`
        : mode === 'chapters' ? `chapters-${chapters.length}`
        : `sources-${resourceIds.length}`;

      let totalBytes = 0;
      for (let i = 0; i < parts.length; i++) {
        const md = parts[i];
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        totalBytes += blob.size;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const suffix = parts.length > 1 ? `_part-${String(i + 1).padStart(2, '0')}-of-${String(parts.length).padStart(2, '0')}` : '';
        a.href = url;
        a.download = `sales-knowledge-base_${tag}_${stamp}${suffix}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        // Small delay so browsers don't drop concurrent downloads
        if (i < parts.length - 1) await new Promise(r => setTimeout(r, 400));
      }

      if (mode === 'full') {
        const ts = new Date().toISOString();
        localStorage.setItem(LS_LAST_FULL, ts);
        setLastFullAt(ts);
      }

      const sizeMb = (totalBytes / (1024 * 1024)).toFixed(2);
      toast.success(
        parts.length > 1
          ? `Exported ${rows.length} KIs across ${parts.length} files (${sizeMb} MB total). Upload all parts to your CustomGPT.`
          : `Exported ${rows.length} KIs (${sizeMb} MB)`,
      );
    } catch (err: any) {
      console.error('KI export failed', err);
      toast.error(`Export failed: ${err?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const toggleChapter = (ch: string) =>
    setChapters(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);
  const toggleResource = (id: string) =>
    setResourceIds(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);

  return (
    <div className="metric-card">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FileText className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-4">
          <div>
            <h3 className="font-semibold">Export Knowledge Base (CustomGPT-ready)</h3>
            <p className="text-sm text-muted-foreground">
              Markdown export grouped by chapter with a built-in grounding prompt. Choose a full export
              or a partial slice — incremental exports remember your last full export timestamp.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Export mode</Label>
              <Select value={mode} onValueChange={v => setMode(v as ExportMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full export (all KIs)</SelectItem>
                  <SelectItem value="since_last_full">Incremental — since last full export</SelectItem>
                  <SelectItem value="since_date">Created since date</SelectItem>
                  <SelectItem value="chapters">Specific chapters</SelectItem>
                  <SelectItem value="resources">Specific source files / resources</SelectItem>
                </SelectContent>
              </Select>
              {mode === 'since_last_full' && (
                <p className="text-xs text-muted-foreground mt-1">
                  {lastFullAt
                    ? `Last full export: ${new Date(lastFullAt).toLocaleString()}`
                    : 'No prior full export recorded on this device — will behave like a full export.'}
                </p>
              )}
            </div>

            {mode === 'since_date' && (
              <div>
                <Label className="text-xs">Since (KIs created on or after)</Label>
                <Input type="date" value={sinceDate} onChange={e => setSinceDate(e.target.value)} />
              </div>
            )}
          </div>

          {mode === 'chapters' && (
            <div className="border rounded-md p-3 max-h-64 overflow-y-auto">
              {chapterOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">Loading chapters…</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {chapterOptions.map(({ chapter, count }) => (
                    <label key={chapter} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={chapters.includes(chapter)}
                        onCheckedChange={() => toggleChapter(chapter)}
                      />
                      <span className="flex-1">{titleCase(chapter)}</span>
                      <span className="text-xs text-muted-foreground">{count}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {mode === 'resources' && (
            <div className="border rounded-md p-3 space-y-2">
              <Input
                placeholder="Filter sources…"
                value={resourceFilter}
                onChange={e => setResourceFilter(e.target.value)}
                className="h-8"
              />
              <div className="max-h-64 overflow-y-auto space-y-1">
                {resourceOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Loading sources…</p>
                ) : filteredResources.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No sources match.</p>
                ) : (
                  filteredResources.map(({ id, title, count }) => (
                    <label key={id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={resourceIds.includes(id)}
                        onCheckedChange={() => toggleResource(id)}
                      />
                      <span className="flex-1 truncate" title={title}>{title}</span>
                      <span className="text-xs text-muted-foreground">{count} KI{count === 1 ? '' : 's'}</span>
                    </label>
                  ))
                )}
              </div>
              {resourceIds.length > 0 && (
                <p className="text-xs text-muted-foreground">{resourceIds.length} selected</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground truncate">{scopeLabel}</p>
            <Button onClick={handleExport} disabled={busy} size="sm">
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {progress ? `Fetched ${progress.toLocaleString()}…` : 'Preparing…'}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export (.md)
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default KnowledgeExport;

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, FileText } from 'lucide-react';
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
};

const COLS =
  'id,title,knowledge_type,chapter,sub_chapter,competitor_name,product_area,applies_to_contexts,tactic_summary,why_it_matters,when_to_use,when_not_to_use,example_usage,macro_situation,micro_strategy,how_to_execute,what_this_unlocks,confidence_score,status,active,tags,who,framework,source_title,source_location,source_excerpt';

async function fetchAllKIs(onProgress: (n: number) => void): Promise<Row[]> {
  const PAGE = 1000;
  let from = 0;
  const all: Row[] = [];
  while (true) {
    const { data, error } = await supabase
      .from('knowledge_items' as any)
      .select(COLS)
      .order('chapter', { ascending: true })
      .order('confidence_score', { ascending: false })
      .range(from, from + PAGE - 1);
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

function buildMarkdown(rows: Row[]): string {
  const activeRows = rows;
  const byChapter = new Map<string, Row[]>();
  for (const r of activeRows) {
    const ch = r.chapter || 'uncategorized';
    if (!byChapter.has(ch)) byChapter.set(ch, []);
    byChapter.get(ch)!.push(r);
  }

  const generatedAt = new Date().toISOString();
  const totalActive = activeRows.filter(r => r.active).length;

  const header = `# Sales Knowledge Base — Consolidated Export

_Generated: ${generatedAt}_
_Total Knowledge Items (KIs): ${activeRows.length} (${totalActive} active)_
_Chapters: ${byChapter.size}_

## How to use this document (instructions for the assistant)

You are a sales coaching assistant. This document is the **complete, authoritative knowledge base** the user has curated from books, podcasts, calls, courses, and frameworks. Every Knowledge Item (KI) below is a discrete tactic, principle, or talk track grounded in real source material.

Rules of engagement:
1. **Ground every answer in these KIs.** When a user asks a sales/coaching question, cite the specific KI(s) by title (and KI ID when useful).
2. **Quote the exact "Tactic" or "Example" verbatim** when giving a tactical answer — do not paraphrase the user's own words back to them.
3. Respect **When NOT to use** — never recommend a KI in a situation it explicitly excludes.
4. Prefer KIs with **higher confidence scores** and KIs whose **contexts** match the user's situation (e.g. "dave", "roleplay", "prep", "objection_handling").
5. If multiple KIs conflict, surface the conflict and let the user choose — do not silently average.
6. If no KI covers the question, say so plainly: _"There is no KI in your library covering this."_ Then offer a general principle, clearly labeled as outside the library.
7. Group recommendations by **chapter** (skill area) when giving a multi-part answer.

## Schema of each KI

Each KI has up to these fields:
- **Title** — short label
- **Chapter / Sub-chapter** — skill area (e.g. discovery, objection_handling, closing)
- **Type** — skill | product | competitive
- **Who / Framework** — attribution (e.g. Chris Orlob — MEDDIC)
- **Contexts** — where it applies (dave, roleplay, prep, coaching, playbooks)
- **Tactic** — the move itself (the "what to do")
- **Why it matters** — the principle behind it
- **When to use / When NOT to use** — the trigger and the guardrail
- **Macro situation → Micro strategy → How to execute → What this unlocks** — the full ladder for advanced moves
- **Example** — verbatim talk track or scripted line
- **Source** — book/podcast/call it came from
- **Confidence** — 0.0–1.0 quality score

---

## Table of contents

`;

  const toc = Array.from(byChapter.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ch, items]) => `- **${titleCase(ch)}** — ${items.length} KI${items.length === 1 ? '' : 's'}`)
    .join('\n');

  const body = Array.from(byChapter.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ch, items]) => {
      const sorted = [...items].sort(
        (a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0),
      );
      const section = sorted.map((ki, i) => renderKI(ki, i + 1)).join('\n---\n\n');
      return `\n\n## ${titleCase(ch)}\n\n_${items.length} Knowledge Item${items.length === 1 ? '' : 's'} in this chapter._\n\n${section}`;
    })
    .join('\n');

  return header + toc + '\n' + body + '\n';
}

export function KnowledgeExport() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleExport = async () => {
    setBusy(true);
    setProgress(0);
    try {
      toast.info('Fetching knowledge items…');
      const rows = await fetchAllKIs(setProgress);
      if (!rows.length) {
        toast.error('No knowledge items found.');
        return;
      }
      toast.info(`Building markdown for ${rows.length} KIs…`);
      const md = buildMarkdown(rows);
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `sales-knowledge-base_${stamp}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const sizeKb = Math.round(blob.size / 1024);
      toast.success(`Exported ${rows.length} KIs (${sizeKb} KB)`);
    } catch (err: any) {
      console.error('KI export failed', err);
      toast.error(`Export failed: ${err?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <div className="metric-card">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FileText className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold">Export Knowledge Base (CustomGPT-ready)</h3>
          <p className="text-sm text-muted-foreground mb-3">
            One consolidated Markdown file with every KI grouped by chapter, plus a built-in instruction block
            so a CustomGPT (or Claude Project) grounds answers in your library.
          </p>
          <Button onClick={handleExport} disabled={busy} size="sm">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {progress ? `Fetched ${progress.toLocaleString()}…` : 'Preparing…'}
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Export all KIs (.md)
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default KnowledgeExport;

/**
 * CommandOutput — premium strategy document renderer.
 *
 * Renders output as a polished, type-aware strategic document with:
 * - constrained reading width
 * - strong typography hierarchy
 * - callout blocks for risks/actions/takeaways
 * - per-section copy
 * - Clean/Edit view toggle
 * - quiet utility bar
 * - rich metadata row
 */
import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Copy, RotateCcw, BookmarkPlus, Check, ChevronDown, ChevronUp,
  Eye, Pencil, Building2, DollarSign, Brain, Clock, FileText,
  AlertTriangle, Target, HelpCircle, Users, ArrowRight, Mail, Lightbulb,
} from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import type { OutputBlock } from '@/lib/commandTypes';

/* ── Section semantics ── */

type SectionSemantic =
  | 'risk' | 'action' | 'takeaway' | 'question'
  | 'stakeholder' | 'next_step' | 'email_body' | 'summary'
  | 'idea' | 'default';

const SEMANTIC_MAP: Record<string, SectionSemantic> = {
  'risks': 'risk',
  'key risks': 'risk',
  'red flags': 'risk',
  'risk': 'risk',
  'recommended actions': 'action',
  'recommendations': 'action',
  'recommended angle': 'action',
  'recommended next steps': 'action',
  'quick wins': 'action',
  'bold moves': 'idea',
  'key angles': 'idea',
  'next steps': 'next_step',
  'action items': 'next_step',
  'cta': 'next_step',
  'key takeaways': 'takeaway',
  'takeaways': 'takeaway',
  'objectives': 'takeaway',
  'key questions': 'question',
  'discovery questions': 'question',
  'questions': 'question',
  'stakeholder hypotheses': 'stakeholder',
  'stakeholders': 'stakeholder',
  'our position': 'summary',
  'situation summary': 'summary',
  'strategic context': 'summary',
  'executive summary': 'summary',
  'problem statement': 'summary',
  'talking points': 'takeaway',
  'body': 'email_body',
  'subject': 'default',
};

function classifySectionHeading(heading: string): SectionSemantic {
  const key = heading.toLowerCase().trim();
  return SEMANTIC_MAP[key] || 'default';
}

const SEMANTIC_STYLES: Record<SectionSemantic, {
  border: string;
  accent: string;
  bg: string;
  Icon: React.ElementType;
}> = {
  risk: { border: 'border-l-amber-500/60', accent: 'text-amber-500', bg: 'bg-amber-500/5', Icon: AlertTriangle },
  action: { border: 'border-l-primary/60', accent: 'text-primary', bg: 'bg-primary/5', Icon: Target },
  takeaway: { border: 'border-l-emerald-500/60', accent: 'text-emerald-500', bg: 'bg-emerald-500/5', Icon: Lightbulb },
  question: { border: 'border-l-blue-400/60', accent: 'text-blue-400', bg: 'bg-blue-400/5', Icon: HelpCircle },
  stakeholder: { border: 'border-l-violet-400/60', accent: 'text-violet-400', bg: 'bg-violet-400/5', Icon: Users },
  next_step: { border: 'border-l-primary/60', accent: 'text-primary', bg: 'bg-primary/5', Icon: ArrowRight },
  email_body: { border: 'border-l-muted-foreground/30', accent: 'text-foreground', bg: 'bg-muted/20', Icon: Mail },
  summary: { border: 'border-l-muted-foreground/30', accent: 'text-foreground', bg: 'bg-transparent', Icon: FileText },
  idea: { border: 'border-l-amber-400/60', accent: 'text-amber-400', bg: 'bg-amber-400/5', Icon: Lightbulb },
  default: { border: 'border-l-border', accent: 'text-foreground', bg: 'bg-transparent', Icon: FileText },
};

/* ── Output type → document title ── */

const OUTPUT_TITLES: Record<string, string> = {
  'Discovery Prep': 'Discovery Preparation',
  'Executive Brief': 'Executive Brief',
  'Follow-Up Email': 'Follow-Up Email',
  'Brainstorm': 'Strategic Brainstorm',
};

/* ── Props ── */

interface Props {
  output: string;
  blocks: OutputBlock[];
  subjectLine?: string;
  sources: string[];
  kiCount: number;
  templateName?: string;
  accountName?: string;
  opportunityName?: string;
  outputType?: string;
  isGenerating: boolean;
  onRegenerate: () => void;
  onSaveAsTemplate: (name: string) => void;
}

export function CommandOutput({
  output, blocks, subjectLine, sources, kiCount, templateName,
  accountName, opportunityName, outputType,
  isGenerating, onRegenerate, onSaveAsTemplate,
}: Props) {
  const [viewMode, setViewMode] = useState<'clean' | 'edit'>('clean');
  const [editedOutput, setEditedOutput] = useState(output);
  const [copied, setCopied] = useState(false);
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSources, setShowSources] = useState(false);

  // Sync edited output when new output arrives
  if (output !== editedOutput && viewMode !== 'edit') {
    setEditedOutput(output);
  }

  const displayOutput = viewMode === 'edit' ? editedOutput : output;
  const docTitle = templateName ? (OUTPUT_TITLES[templateName] || templateName) : 'Strategy Output';
  const generatedAt = useMemo(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), [output]);

  const handleCopy = useCallback(() => {
    const text = subjectLine ? `Subject: ${subjectLine}\n\n${displayOutput}` : displayOutput;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }, [displayOutput, subjectLine]);

  const handleCopyBlock = useCallback((heading: string, content: string) => {
    const text = heading ? `${heading}\n\n${content}` : content;
    navigator.clipboard.writeText(text);
    setCopiedBlock(heading);
    toast.success(`Copied "${heading}"`);
    setTimeout(() => setCopiedBlock(null), 2000);
  }, []);

  const handleSave = useCallback(() => {
    if (!saveName.trim()) return;
    onSaveAsTemplate(saveName.trim());
    setShowSaveDialog(false);
    setSaveName('');
  }, [saveName, onSaveAsTemplate]);

  if (!output && !isGenerating) return null;

  const hasBlocks = blocks.length > 1;

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
      {/* ── Document container ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">

        {/* ── Document header ── */}
        <div className="px-6 pt-5 pb-4 border-b border-border/50">
          {/* Title row */}
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground tracking-tight">{docTitle}</h2>
              {accountName && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {accountName}{opportunityName ? ` · ${opportunityName}` : ''}
                </p>
              )}
            </div>
            {/* View mode toggle */}
            {!isGenerating && (
              <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 shrink-0">
                <button
                  onClick={() => setViewMode('clean')}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                    viewMode === 'clean'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Eye className="h-3 w-3" /> Clean
                </button>
                <button
                  onClick={() => setViewMode('edit')}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                    viewMode === 'edit'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              </div>
            )}
          </div>

          {/* Metadata row */}
          <div className="flex items-center gap-3 flex-wrap">
            {templateName && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <FileText className="h-3 w-3" /> {templateName}
              </span>
            )}
            {accountName && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Building2 className="h-3 w-3" /> {accountName}
              </span>
            )}
            {opportunityName && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <DollarSign className="h-3 w-3" /> {opportunityName}
              </span>
            )}
            {kiCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Brain className="h-3 w-3" /> {kiCount} KIs
              </span>
            )}
            {sources.length > 0 && (
              <button
                onClick={() => setShowSources(!showSources)}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showSources ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {sources.length} source{sources.length !== 1 ? 's' : ''}
              </button>
            )}
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 ml-auto">
              <Clock className="h-3 w-3" /> {generatedAt}
            </span>
          </div>

          {/* Expanded sources */}
          {showSources && sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {sources.map((s, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{s}</span>
              ))}
            </div>
          )}
        </div>

        {/* ── Document body ── */}
        {isGenerating ? (
          <div className="px-6 py-16">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:150ms]" />
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:300ms]" />
              </div>
              <span className="text-xs">Generating {docTitle.toLowerCase()}…</span>
            </div>
          </div>
        ) : viewMode === 'edit' ? (
          <div className="p-4">
            <Textarea
              value={editedOutput}
              onChange={e => setEditedOutput(e.target.value)}
              className="min-h-[400px] border-0 text-sm font-mono resize-y focus-visible:ring-0 bg-transparent"
            />
          </div>
        ) : (
          <div className="px-6 py-5">
            {/* Constrained reading column */}
            <div className="max-w-prose mx-auto">
              {/* Subject line for emails */}
              {subjectLine && (
                <div className="mb-5 px-4 py-3 rounded-lg bg-muted/40 border border-border/60">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Subject Line</span>
                  <p className="text-sm font-semibold text-foreground mt-1 leading-snug">{subjectLine}</p>
                </div>
              )}

              {/* Structured blocks */}
              {hasBlocks ? (
                <div className="space-y-6">
                  {blocks.map((block, i) => {
                    const semantic = classifySectionHeading(block.heading);
                    const style = SEMANTIC_STYLES[semantic];
                    const isCallout = semantic !== 'default' && semantic !== 'summary' && semantic !== 'email_body';

                    return (
                      <section
                        key={i}
                        className={cn(
                          'group relative',
                          isCallout && `rounded-lg border-l-[3px] ${style.border} ${style.bg} px-4 py-3`,
                        )}
                      >
                        {/* Section header */}
                        {block.heading && (
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-2">
                              {isCallout && (
                                <style.Icon className={cn('h-3.5 w-3.5 shrink-0', style.accent)} />
                              )}
                              <h3 className={cn(
                                'text-sm font-semibold tracking-tight',
                                isCallout ? style.accent : 'text-foreground',
                              )}>
                                {block.heading}
                              </h3>
                            </div>
                            <button
                              onClick={() => handleCopyBlock(block.heading, block.content)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                              title={`Copy "${block.heading}"`}
                            >
                              {copiedBlock === block.heading ? (
                                <Check className="h-3 w-3 text-emerald-500" />
                              ) : (
                                <Copy className="h-3 w-3 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                        )}

                        {/* Section content */}
                        <div className={cn(
                          'prose prose-sm dark:prose-invert max-w-none',
                          // Typography refinements
                          'prose-headings:text-foreground prose-headings:font-semibold prose-headings:tracking-tight',
                          'prose-p:text-foreground/85 prose-p:leading-relaxed',
                          'prose-li:text-foreground/85 prose-li:leading-relaxed',
                          'prose-strong:text-foreground prose-strong:font-semibold',
                          'prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5',
                          '[&_ul]:space-y-1 [&_ol]:space-y-1',
                        )}>
                          <ReactMarkdown>{block.content}</ReactMarkdown>
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                /* Single-block fallback */
                <div className={cn(
                  'prose prose-sm dark:prose-invert max-w-none',
                  'prose-headings:text-foreground prose-headings:font-semibold prose-headings:tracking-tight',
                  'prose-p:text-foreground/85 prose-p:leading-relaxed',
                  'prose-li:text-foreground/85 prose-li:leading-relaxed',
                  'prose-strong:text-foreground prose-strong:font-semibold',
                )}>
                  <ReactMarkdown>{displayOutput}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Quiet utility bar ── */}
        {!isGenerating && (
          <div className="flex items-center justify-between px-6 py-2.5 border-t border-border/40 bg-muted/20">
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy All'}
              </button>
              <button
                onClick={onRegenerate}
                disabled={isGenerating}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" /> Regenerate
              </button>
              <button
                onClick={() => setShowSaveDialog(true)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors"
              >
                <BookmarkPlus className="h-3 w-3" /> Save
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Save as template dialog */}
      {showSaveDialog && (
        <div className="flex items-center gap-2 p-3 mt-2 rounded-lg border border-primary/30 bg-primary/5">
          <Input
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            placeholder="Template name..."
            className="h-8 text-sm flex-1"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <Button size="sm" onClick={handleSave} disabled={!saveName.trim()} className="h-8">Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowSaveDialog(false)} className="h-8">Cancel</Button>
        </div>
      )}
    </div>
  );
}

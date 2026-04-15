/**
 * CommandOutput — premium strategy document renderer.
 * Mobile-first readability: scannable, chunked, professional.
 *
 * CONTRAST HIERARCHY (enforced):
 *   Primary:     text-foreground          (doc title, section headings)
 *   Secondary:   text-foreground/80       (body text, interactive actions)
 *   Tertiary:    text-muted-foreground    (metadata, timestamps)
 *   Disabled:    text-muted-foreground/50 (only for truly disabled states)
 */
import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Copy, RotateCcw, BookmarkPlus, Check, ChevronDown, ChevronUp,
  Eye, Pencil, Brain, Clock, FileText,
  AlertTriangle, Target, HelpCircle, Users, ArrowRight, Mail, Lightbulb, BookOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import type { OutputBlock } from '@/lib/commandTypes';

/* ── Post-process markdown for premium document scanability ── */

function enhanceReadability(md: string): string {
  const blocks = md.split('\n\n');
  const enhanced: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Don't touch headings, lists, blockquotes, code blocks, or HR
    if (/^[#\-*\d>|`]/.test(trimmed) || trimmed.startsWith('---')) {
      enhanced.push(trimmed);
      continue;
    }

    // Detect inline labeled patterns like "**Why it works:** ..." and promote to mini-blocks
    const labelMatch = trimmed.match(/^\*\*([^*]+):\*\*\s*(.+)/);
    if (labelMatch) {
      enhanced.push(`**${labelMatch[1]}**\n\n${labelMatch[2]}`);
      continue;
    }

    // Split long paragraphs (>220 chars) at sentence boundaries → 1-3 sentence chunks
    if (trimmed.length > 220) {
      const sentences = trimmed.match(/[^.!?]+[.!?]+\s*/g);
      if (sentences && sentences.length > 2) {
        const chunks: string[] = [];
        let current = '';
        for (const s of sentences) {
          if ((current + s).length > 180 && current.length > 0) {
            chunks.push(current.trim());
            current = s;
          } else {
            current += s;
          }
        }
        if (current.trim()) chunks.push(current.trim());
        enhanced.push(...chunks);
        continue;
      }
    }

    enhanced.push(trimmed);
  }

  return enhanced.join('\n\n');
}

/* ── Section semantics ── */

type SectionSemantic =
  | 'risk' | 'action' | 'takeaway' | 'question'
  | 'stakeholder' | 'next_step' | 'email_body' | 'summary'
  | 'idea' | 'default';

const SEMANTIC_MAP: Record<string, SectionSemantic> = {
  'risks': 'risk', 'key risks': 'risk', 'red flags': 'risk', 'risk': 'risk',
  'recommended actions': 'action', 'recommendations': 'action',
  'recommended angle': 'action', 'recommended next steps': 'action',
  'quick wins': 'action', 'bold moves': 'idea', 'key angles': 'idea',
  'next steps': 'next_step', 'action items': 'next_step', 'cta': 'next_step',
  'key takeaways': 'takeaway', 'takeaways': 'takeaway', 'objectives': 'takeaway',
  'key questions': 'question', 'discovery questions': 'question', 'questions': 'question',
  'stakeholder hypotheses': 'stakeholder', 'stakeholders': 'stakeholder',
  'our position': 'summary', 'situation summary': 'summary',
  'strategic context': 'summary', 'executive summary': 'summary',
  'problem statement': 'summary', 'talking points': 'takeaway',
  'body': 'email_body', 'subject': 'default',
};

function classifySectionHeading(heading: string): SectionSemantic {
  return SEMANTIC_MAP[heading.toLowerCase().trim()] || 'default';
}

const SEMANTIC_ACCENT: Record<SectionSemantic, { color: string; Icon: React.ElementType }> = {
  risk: { color: 'text-amber-500/70', Icon: AlertTriangle },
  action: { color: 'text-primary/70', Icon: Target },
  takeaway: { color: 'text-emerald-500/70', Icon: Lightbulb },
  question: { color: 'text-blue-400/70', Icon: HelpCircle },
  stakeholder: { color: 'text-violet-400/70', Icon: Users },
  next_step: { color: 'text-primary/70', Icon: ArrowRight },
  email_body: { color: 'text-foreground/60', Icon: Mail },
  summary: { color: 'text-foreground/60', Icon: FileText },
  idea: { color: 'text-amber-400/70', Icon: Lightbulb },
  default: { color: 'text-foreground/50', Icon: FileText },
};

const OUTPUT_TITLES: Record<string, string> = {
  'Discovery Prep': 'Discovery Preparation',
  'Executive Brief': 'Executive Brief',
  'Follow-Up Email': 'Follow-Up Email',
  'Brainstorm': 'Strategic Brainstorm',
};

/* ── Prose classes — premium document rendering ── */

const proseClasses = cn(
  'prose prose-sm sm:prose-base dark:prose-invert max-w-none',
  // Headings — strong, clear hierarchy
  'prose-headings:text-foreground prose-headings:font-semibold prose-headings:tracking-tight',
  'prose-h1:text-lg prose-h1:leading-snug prose-h1:mb-5 prose-h1:mt-0',
  'prose-h2:text-base prose-h2:leading-snug prose-h2:mb-4 prose-h2:mt-10',
  'prose-h3:text-[15px] prose-h3:leading-snug prose-h3:mb-3 prose-h3:mt-7',
  'prose-h4:text-[13px] prose-h4:font-semibold prose-h4:mb-2 prose-h4:mt-5 prose-h4:text-foreground/80',
  // Body — readable, not dim
  'prose-p:text-[14.5px] prose-p:text-foreground/75 prose-p:leading-[1.85] prose-p:mb-5',
  // Lists — generous spacing
  'prose-li:text-[14.5px] prose-li:text-foreground/75 prose-li:leading-[1.75] prose-li:mb-2.5',
  'prose-ul:my-5 prose-ol:my-5',
  '[&_ul]:space-y-2 [&_ol]:space-y-2',
  'prose-ul:pl-1 prose-ol:pl-1',
  // Strong labels — clearly visible inline sub-headings
  'prose-strong:text-foreground/90 prose-strong:font-semibold',
  'prose-em:text-foreground/60 prose-em:text-[13px]',
  // Quotes
  'prose-blockquote:border-l-2 prose-blockquote:border-primary/20 prose-blockquote:text-foreground/60 prose-blockquote:not-italic prose-blockquote:font-normal prose-blockquote:pl-4 prose-blockquote:my-6',
  // Code
  'prose-code:text-primary/70 prose-code:bg-primary/[0.06] prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[13px] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
  // HR — section dividers
  'prose-hr:border-border/15 prose-hr:my-8',
);

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
  playbookUsed?: string;
  isGenerating: boolean;
  onRegenerate: () => void;
  onSaveAsTemplate: (name: string) => void;
  onPromoteToTemplate?: () => void;
}

export function CommandOutput({
  output, blocks, subjectLine, sources, kiCount, templateName,
  accountName, opportunityName, playbookUsed,
  isGenerating, onRegenerate, onSaveAsTemplate, onPromoteToTemplate,
}: Props) {
  const [viewMode, setViewMode] = useState<'clean' | 'edit'>('clean');
  const [editedOutput, setEditedOutput] = useState(output);
  const [copied, setCopied] = useState(false);
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showPromoteDialog, setShowPromoteDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [promoteName, setPromoteName] = useState('');
  const [showSources, setShowSources] = useState(false);

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
    navigator.clipboard.writeText(heading ? `${heading}\n\n${content}` : content);
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

  const handlePromote = useCallback(() => {
    if (!promoteName.trim()) return;
    onSaveAsTemplate(promoteName.trim());
    setShowPromoteDialog(false);
    setPromoteName('');
    toast.success(`Framework "${promoteName.trim()}" saved — use it from +template`);
  }, [promoteName, onSaveAsTemplate]);

  if (!output && !isGenerating) return null;

  const hasBlocks = blocks.length > 1;

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      {/* Document canvas */}
      <div className="rounded-xl border border-border/20 bg-card/60 overflow-hidden">

        {/* Document header */}
        <div className="px-6 sm:px-8 pt-6 pb-4 sm:pt-7 sm:pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground tracking-tight leading-tight">{docTitle}</h2>
              {(accountName || opportunityName) && (
                <p className="text-[13px] text-muted-foreground mt-1.5 font-medium">
                  {accountName}{opportunityName ? ` · ${opportunityName}` : ''}
                </p>
              )}
            </div>
            {!isGenerating && (
              <div className="flex items-center gap-px rounded-lg bg-muted/25 p-0.5 shrink-0">
                <button
                  onClick={() => setViewMode('clean')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-100',
                    viewMode === 'clean' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground/80'
                  )}
                >
                  <Eye className="h-3 w-3" /> Read
                </button>
                <button
                  onClick={() => setViewMode('edit')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-100',
                    viewMode === 'edit' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground/80'
                  )}
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              </div>
            )}
          </div>

          {/* Metadata line */}
          <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground mt-3">
            {playbookUsed && (
              <span className="inline-flex items-center gap-1 text-primary/80">
                <BookOpen className="h-3 w-3" /> {playbookUsed}
              </span>
            )}
            {kiCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Brain className="h-3 w-3" /> {kiCount} KIs
              </span>
            )}
            {sources.length > 0 && (
              <button
                onClick={() => setShowSources(!showSources)}
                className="inline-flex items-center gap-0.5 hover:text-foreground/80 transition-colors duration-100"
              >
                {showSources ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {sources.length} source{sources.length !== 1 ? 's' : ''}
              </button>
            )}
            <span className="inline-flex items-center gap-1 ml-auto text-muted-foreground/70">
              <Clock className="h-3 w-3" /> {generatedAt}
            </span>
          </div>

          {showSources && sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {sources.map((s, i) => (
                <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-muted/25 text-muted-foreground">{s}</span>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="mx-6 sm:mx-8 border-t border-border/15" />

        {/* Document body */}
        {isGenerating ? (
          <div className="px-8 py-24">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse" />
                <div className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse [animation-delay:150ms]" />
                <div className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse [animation-delay:300ms]" />
              </div>
              <span className="text-sm">Generating…</span>
            </div>
          </div>
        ) : viewMode === 'edit' ? (
          <div className="p-6 sm:p-8">
            <Textarea
              value={editedOutput}
              onChange={e => setEditedOutput(e.target.value)}
              className="min-h-[400px] border-0 text-[15px] leading-relaxed font-mono resize-y focus-visible:ring-0 bg-transparent"
            />
          </div>
        ) : (
          <div className="px-6 sm:px-8 py-6 sm:py-8">
            <div className="max-w-[640px]">
              {subjectLine && (
                <div className="mb-7 pb-5 border-b border-border/15">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">Subject</span>
                  <p className="text-[15px] font-semibold text-foreground mt-1.5 leading-snug">{subjectLine}</p>
                </div>
              )}

              {hasBlocks ? (
                <div className="divide-y divide-border/10">
                  {blocks.map((block, i) => {
                    const semantic = classifySectionHeading(block.heading);
                    const accent = SEMANTIC_ACCENT[semantic];

                    return (
                      <section key={i} className={cn('group relative', i > 0 ? 'pt-8' : '', 'pb-7')}>
                        {block.heading && (
                          <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-2">
                              <accent.Icon className={cn('h-3.5 w-3.5 shrink-0', accent.color)} />
                              <h3 className="text-[13px] font-semibold text-foreground/80 tracking-[0.04em] uppercase">
                                {block.heading}
                              </h3>
                            </div>
                            <button
                              onClick={() => handleCopyBlock(block.heading, block.content)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-1.5 rounded-md hover:bg-muted/30"
                              title={`Copy "${block.heading}"`}
                            >
                              {copiedBlock === block.heading ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                        )}
                        <div className={proseClasses}>
                          <ReactMarkdown>{enhanceReadability(block.content)}</ReactMarkdown>
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className={proseClasses}>
                  <ReactMarkdown>{enhanceReadability(displayOutput)}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Utility bar */}
        {!isGenerating && (
          <div className="flex items-center justify-between px-6 sm:px-8 py-3 border-t border-border/15">
            <div className="flex items-center gap-1">
              {[
                { onClick: handleCopy, icon: copied ? Check : Copy, label: copied ? 'Copied' : 'Copy all', accent: copied },
                { onClick: onRegenerate, icon: RotateCcw, label: 'Regenerate' },
                { onClick: () => setShowSaveDialog(true), icon: BookmarkPlus, label: 'Save template' },
                ...(onPromoteToTemplate ? [{ onClick: () => { setPromoteName(templateName ? `${templateName} (custom)` : 'My Framework'); setShowPromoteDialog(true); }, icon: BookOpen, label: 'Use as framework' }] : []),
              ].map(action => (
                <button
                  key={action.label}
                  onClick={action.onClick}
                  className={cn(
                    'inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-md transition-all duration-100',
                    action.accent
                      ? 'text-emerald-500'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/25'
                  )}
                >
                  <action.icon className="h-3.5 w-3.5" /> {action.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save template dialog */}
      {showSaveDialog && (
        <div className="flex items-center gap-2 p-3 mt-2 rounded-lg border border-border/20 bg-card/50">
          <Input
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            placeholder="Template name…"
            className="h-8 text-sm flex-1 border-border/30"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <Button size="sm" onClick={handleSave} disabled={!saveName.trim()} className="h-8">Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowSaveDialog(false)} className="h-8">Cancel</Button>
        </div>
      )}

      {/* Promote to framework dialog */}
      {showPromoteDialog && (
        <div className="mt-2 rounded-lg border border-primary/15 bg-primary/[0.04] p-4 space-y-3">
          <div>
            <p className="text-[13px] font-medium text-foreground">Use as framework</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Save this output's structure as a reusable template. Access it anytime from <kbd className="px-1 py-px rounded bg-muted/40 text-[10px] font-mono">+</kbd> in the composer.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={promoteName}
              onChange={e => setPromoteName(e.target.value)}
              placeholder="e.g. Mid Market Discovery Prep Sheet"
              className="h-8 text-sm flex-1 border-border/30"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handlePromote()}
            />
            <Button size="sm" onClick={handlePromote} disabled={!promoteName.trim()} className="h-8">
              <BookOpen className="h-3 w-3 mr-1" /> Save framework
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowPromoteDialog(false)} className="h-8">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

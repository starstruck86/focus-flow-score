/**
 * CommandOutput — premium strategy document renderer.
 * Mobile-first readability: scannable, chunked, professional.
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

/* ── Post-process markdown for mobile scanability ── */

function enhanceReadability(md: string): string {
  return md
    .split('\n\n')
    .flatMap(para => {
      // Don't split headings, lists, blockquotes, code
      if (/^[#\-\*\d+\.\>```]/.test(para.trim())) return [para];
      // Split long paragraphs (>280 chars) at sentence boundaries
      if (para.length > 280) {
        const sentences = para.match(/[^.!?]+[.!?]+\s*/g);
        if (sentences && sentences.length > 2) {
          const chunks: string[] = [];
          let current = '';
          for (const s of sentences) {
            if ((current + s).length > 200 && current.length > 0) {
              chunks.push(current.trim());
              current = s;
            } else {
              current += s;
            }
          }
          if (current.trim()) chunks.push(current.trim());
          return chunks;
        }
      }
      return [para];
    })
    .join('\n\n');
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
  risk: { color: 'text-amber-500/50', Icon: AlertTriangle },
  action: { color: 'text-primary/50', Icon: Target },
  takeaway: { color: 'text-emerald-500/50', Icon: Lightbulb },
  question: { color: 'text-blue-400/50', Icon: HelpCircle },
  stakeholder: { color: 'text-violet-400/50', Icon: Users },
  next_step: { color: 'text-primary/50', Icon: ArrowRight },
  email_body: { color: 'text-foreground/40', Icon: Mail },
  summary: { color: 'text-foreground/40', Icon: FileText },
  idea: { color: 'text-amber-400/50', Icon: Lightbulb },
  default: { color: 'text-foreground/30', Icon: FileText },
};

const OUTPUT_TITLES: Record<string, string> = {
  'Discovery Prep': 'Discovery Preparation',
  'Executive Brief': 'Executive Brief',
  'Follow-Up Email': 'Follow-Up Email',
  'Brainstorm': 'Strategic Brainstorm',
};

/* ── Prose classes — mobile-first scannable document ── */

const proseClasses = cn(
  'prose prose-sm sm:prose-base dark:prose-invert max-w-none',
  // Headings — clear hierarchy, breathing room
  'prose-headings:text-foreground/80 prose-headings:font-semibold prose-headings:tracking-tight',
  'prose-h1:text-lg prose-h1:leading-snug prose-h1:mb-4 prose-h1:mt-0',
  'prose-h2:text-base prose-h2:leading-snug prose-h2:mb-3 prose-h2:mt-8',
  'prose-h3:text-[15px] prose-h3:leading-snug prose-h3:mb-2 prose-h3:mt-6',
  'prose-h4:text-[13px] prose-h4:font-semibold prose-h4:mb-2 prose-h4:mt-4 prose-h4:text-foreground/60',
  // Body — generous line-height, clear paragraph breaks
  'prose-p:text-[14.5px] prose-p:text-foreground/60 prose-p:leading-[1.85] prose-p:mb-4',
  // Lists — well-spaced, easy to scan
  'prose-li:text-[14.5px] prose-li:text-foreground/60 prose-li:leading-[1.75] prose-li:mb-2',
  'prose-ul:my-4 prose-ol:my-4',
  '[&_ul]:space-y-1.5 [&_ol]:space-y-1.5',
  'prose-ul:pl-0 prose-ol:pl-0',
  // Emphasis
  'prose-strong:text-foreground/75 prose-strong:font-semibold',
  'prose-em:text-foreground/55 prose-em:text-[13px]',
  // Quotes — subtle
  'prose-blockquote:border-l-2 prose-blockquote:border-primary/12 prose-blockquote:text-foreground/50 prose-blockquote:not-italic prose-blockquote:font-normal prose-blockquote:pl-4 prose-blockquote:my-5',
  // Code
  'prose-code:text-primary/60 prose-code:bg-primary/[0.04] prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[13px] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
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
      {/* Document canvas — minimal chrome, maximum readability */}
      <div className="rounded-xl border border-border/10 bg-card/40 overflow-hidden">

        {/* Document header — quiet and informational */}
        <div className="px-5 sm:px-8 pt-5 pb-3 sm:pt-6 sm:pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[18px] font-semibold text-foreground/85 tracking-tight leading-tight">{docTitle}</h2>
              {(accountName || opportunityName) && (
                <p className="text-[12px] text-muted-foreground/35 mt-1.5 font-medium">
                  {accountName}{opportunityName ? ` · ${opportunityName}` : ''}
                </p>
              )}
            </div>
            {!isGenerating && (
              <div className="flex items-center gap-px rounded-lg bg-muted/15 p-0.5 shrink-0">
                <button
                  onClick={() => setViewMode('clean')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-100',
                    viewMode === 'clean' ? 'bg-background text-foreground/70 shadow-sm' : 'text-muted-foreground/25 hover:text-foreground/50'
                  )}
                >
                  <Eye className="h-3 w-3" /> Read
                </button>
                <button
                  onClick={() => setViewMode('edit')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-100',
                    viewMode === 'edit' ? 'bg-background text-foreground/70 shadow-sm' : 'text-muted-foreground/25 hover:text-foreground/50'
                  )}
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              </div>
            )}
          </div>

          {/* Quiet metadata line */}
          <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground/25 mt-3">
            {playbookUsed && (
              <span className="inline-flex items-center gap-1 text-primary/40">
                <BookOpen className="h-2.5 w-2.5" /> {playbookUsed}
              </span>
            )}
            {kiCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Brain className="h-2.5 w-2.5" /> {kiCount} KIs
              </span>
            )}
            {sources.length > 0 && (
              <button
                onClick={() => setShowSources(!showSources)}
                className="inline-flex items-center gap-0.5 hover:text-foreground/40 transition-colors duration-100"
              >
                {showSources ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                {sources.length} source{sources.length !== 1 ? 's' : ''}
              </button>
            )}
            <span className="inline-flex items-center gap-1 ml-auto text-muted-foreground/18">
              <Clock className="h-2.5 w-2.5" /> {generatedAt}
            </span>
          </div>

          {showSources && sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {sources.map((s, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/15 text-muted-foreground/30">{s}</span>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="mx-5 sm:mx-8 border-t border-border/8" />

        {/* Document body */}
        {isGenerating ? (
          <div className="px-8 py-24">
            <div className="flex flex-col items-center gap-3 text-muted-foreground/25">
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-primary/30 animate-pulse" />
                <div className="h-1 w-1 rounded-full bg-primary/30 animate-pulse [animation-delay:150ms]" />
                <div className="h-1 w-1 rounded-full bg-primary/30 animate-pulse [animation-delay:300ms]" />
              </div>
              <span className="text-xs">Generating…</span>
            </div>
          </div>
        ) : viewMode === 'edit' ? (
          <div className="p-8">
            <Textarea
              value={editedOutput}
              onChange={e => setEditedOutput(e.target.value)}
              className="min-h-[400px] border-0 text-[15px] leading-relaxed font-mono resize-y focus-visible:ring-0 bg-transparent"
            />
          </div>
        ) : (
          <div className="px-5 sm:px-8 py-6 sm:py-8">
            <div className="max-w-[580px]">
              {subjectLine && (
                <div className="mb-6 pb-4 border-b border-border/8">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/25 font-medium">Subject</span>
                  <p className="text-[15px] font-semibold text-foreground/75 mt-1.5 leading-snug">{subjectLine}</p>
                </div>
              )}

              {hasBlocks ? (
                <div className="space-y-10">
                  {blocks.map((block, i) => {
                    const semantic = classifySectionHeading(block.heading);
                    const accent = SEMANTIC_ACCENT[semantic];

                    return (
                      <section key={i} className="group relative">
                        {block.heading && (
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <accent.Icon className={cn('h-3.5 w-3.5 shrink-0', accent.color)} />
                              <h3 className="text-[14px] font-semibold text-foreground/75 tracking-tight uppercase">
                                {block.heading}
                              </h3>
                            </div>
                            <button
                              onClick={() => handleCopyBlock(block.heading, block.content)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-1.5 rounded-md hover:bg-muted/20"
                              title={`Copy "${block.heading}"`}
                            >
                              {copiedBlock === block.heading ? (
                                <Check className="h-3 w-3 text-emerald-500/50" />
                              ) : (
                                <Copy className="h-3 w-3 text-muted-foreground/15" />
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

        {/* Utility bar — very quiet */}
        {!isGenerating && (
          <div className="flex items-center justify-between px-5 sm:px-8 py-2.5 border-t border-border/6">
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
                    'inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md transition-all duration-100',
                    action.accent
                      ? 'text-emerald-500/60'
                      : 'text-muted-foreground/20 hover:text-muted-foreground/50 hover:bg-muted/15'
                  )}
                >
                  <action.icon className="h-3 w-3" /> {action.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save template dialog */}
      {showSaveDialog && (
        <div className="flex items-center gap-2 p-3 mt-2 rounded-lg border border-border/10 bg-card/30">
          <Input
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            placeholder="Template name…"
            className="h-8 text-sm flex-1 border-border/20"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <Button size="sm" onClick={handleSave} disabled={!saveName.trim()} className="h-8">Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowSaveDialog(false)} className="h-8">Cancel</Button>
        </div>
      )}

      {/* Promote to framework dialog */}
      {showPromoteDialog && (
        <div className="mt-2 rounded-lg border border-primary/10 bg-primary/[0.02] p-4 space-y-3">
          <div>
            <p className="text-[13px] font-medium text-foreground/70">Use as framework</p>
            <p className="text-[11px] text-muted-foreground/40 mt-0.5">
              Save this output's structure as a reusable template. Access it anytime from <kbd className="px-1 py-px rounded bg-muted/30 text-[10px] font-mono">+</kbd> in the composer.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={promoteName}
              onChange={e => setPromoteName(e.target.value)}
              placeholder="e.g. Mid Market Discovery Prep Sheet"
              className="h-8 text-sm flex-1 border-border/20"
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

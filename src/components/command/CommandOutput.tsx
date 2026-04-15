/**
 * CommandOutput — premium strategy document renderer.
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

const SEMANTIC_STYLES: Record<SectionSemantic, {
  border: string; accent: string; bg: string; Icon: React.ElementType;
}> = {
  risk: { border: 'border-l-amber-500/40', accent: 'text-amber-500/80', bg: 'bg-amber-500/[0.03]', Icon: AlertTriangle },
  action: { border: 'border-l-primary/40', accent: 'text-primary/80', bg: 'bg-primary/[0.03]', Icon: Target },
  takeaway: { border: 'border-l-emerald-500/40', accent: 'text-emerald-500/80', bg: 'bg-emerald-500/[0.03]', Icon: Lightbulb },
  question: { border: 'border-l-blue-400/40', accent: 'text-blue-400/80', bg: 'bg-blue-400/[0.03]', Icon: HelpCircle },
  stakeholder: { border: 'border-l-violet-400/40', accent: 'text-violet-400/80', bg: 'bg-violet-400/[0.03]', Icon: Users },
  next_step: { border: 'border-l-primary/40', accent: 'text-primary/80', bg: 'bg-primary/[0.03]', Icon: ArrowRight },
  email_body: { border: 'border-l-border/40', accent: 'text-foreground/80', bg: 'bg-muted/[0.04]', Icon: Mail },
  summary: { border: 'border-l-border/30', accent: 'text-foreground/80', bg: 'bg-transparent', Icon: FileText },
  idea: { border: 'border-l-amber-400/40', accent: 'text-amber-400/80', bg: 'bg-amber-400/[0.03]', Icon: Lightbulb },
  default: { border: 'border-l-border/20', accent: 'text-foreground/70', bg: 'bg-transparent', Icon: FileText },
};

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

  if (!output && !isGenerating) return null;

  const hasBlocks = blocks.length > 1;

  const proseClasses = cn(
    'prose prose-sm dark:prose-invert max-w-none',
    'prose-headings:text-foreground/90 prose-headings:font-semibold prose-headings:tracking-tight',
    'prose-p:text-foreground/70 prose-p:leading-[1.7] prose-p:my-2.5',
    'prose-li:text-foreground/70 prose-li:leading-[1.7]',
    'prose-strong:text-foreground/90 prose-strong:font-semibold',
    'prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5',
    '[&_ul]:space-y-1 [&_ol]:space-y-1',
  );

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
      <div className="rounded-xl border border-border/20 bg-card/60 overflow-hidden">

        {/* Document header */}
        <div className="px-5 pt-3.5 pb-2.5 border-b border-border/15">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-foreground/85 tracking-tight">{docTitle}</h2>
              {accountName && (
                <p className="text-[10px] text-muted-foreground/35 mt-0.5">
                  {accountName}{opportunityName ? ` · ${opportunityName}` : ''}
                </p>
              )}
            </div>
            {!isGenerating && (
              <div className="flex items-center gap-px rounded-lg bg-muted/30 p-0.5 shrink-0">
                <button
                  onClick={() => setViewMode('clean')}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all duration-150',
                    viewMode === 'clean' ? 'bg-background text-foreground/80 shadow-sm' : 'text-muted-foreground/40 hover:text-foreground/60'
                  )}
                >
                  <Eye className="h-3 w-3" /> Clean
                </button>
                <button
                  onClick={() => setViewMode('edit')}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all duration-150',
                    viewMode === 'edit' ? 'bg-background text-foreground/80 shadow-sm' : 'text-muted-foreground/40 hover:text-foreground/60'
                  )}
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground/35">
            {templateName && (
              <span className="inline-flex items-center gap-1">
                <FileText className="h-2.5 w-2.5" /> {templateName}
              </span>
            )}
            {accountName && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-2.5 w-2.5" /> {accountName}
              </span>
            )}
            {opportunityName && (
              <span className="inline-flex items-center gap-1">
                <DollarSign className="h-2.5 w-2.5" /> {opportunityName}
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
                className="inline-flex items-center gap-0.5 hover:text-foreground/60 transition-colors duration-150"
              >
                {showSources ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                {sources.length} source{sources.length !== 1 ? 's' : ''}
              </button>
            )}
            <span className="inline-flex items-center gap-1 ml-auto text-muted-foreground/20">
              <Clock className="h-2.5 w-2.5" /> {generatedAt}
            </span>
          </div>

          {showSources && sources.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {sources.map((s, i) => (
                <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted/30 text-muted-foreground/35">{s}</span>
              ))}
            </div>
          )}
        </div>

        {/* Document body */}
        {isGenerating ? (
          <div className="px-5 py-16">
            <div className="flex flex-col items-center gap-3 text-muted-foreground/40">
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-primary/50 animate-pulse" />
                <div className="h-1 w-1 rounded-full bg-primary/50 animate-pulse [animation-delay:150ms]" />
                <div className="h-1 w-1 rounded-full bg-primary/50 animate-pulse [animation-delay:300ms]" />
              </div>
              <span className="text-[11px]">Generating {docTitle.toLowerCase()}…</span>
            </div>
          </div>
        ) : viewMode === 'edit' ? (
          <div className="p-5">
            <Textarea
              value={editedOutput}
              onChange={e => setEditedOutput(e.target.value)}
              className="min-h-[400px] border-0 text-sm font-mono resize-y focus-visible:ring-0 bg-transparent"
            />
          </div>
        ) : (
          <div className="px-5 py-5">
            <div className="max-w-prose mx-auto">
              {subjectLine && (
                <div className="mb-5 px-3.5 py-3 rounded-lg bg-muted/20 border border-border/20">
                  <span className="text-[9px] uppercase tracking-widest text-muted-foreground/35 font-medium">Subject</span>
                  <p className="text-sm font-semibold text-foreground/85 mt-0.5 leading-snug">{subjectLine}</p>
                </div>
              )}

              {hasBlocks ? (
                <div className="space-y-5">
                  {blocks.map((block, i) => {
                    const semantic = classifySectionHeading(block.heading);
                    const style = SEMANTIC_STYLES[semantic];
                    const showBorder = !['default', 'summary'].includes(semantic);

                    return (
                      <section
                        key={i}
                        className={cn(
                          'group relative',
                          showBorder && `rounded-lg border-l-2 ${style.border} ${style.bg} px-4 py-3.5`,
                        )}
                      >
                        {block.heading && (
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-1.5">
                              {showBorder && <style.Icon className={cn('h-3.5 w-3.5 shrink-0', style.accent)} />}
                              <h3 className={cn(
                                'text-[13px] font-semibold tracking-tight',
                                showBorder ? style.accent : 'text-foreground/80',
                              )}>
                                {block.heading}
                              </h3>
                            </div>
                            <button
                              onClick={() => handleCopyBlock(block.heading, block.content)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-1 rounded hover:bg-muted/40"
                              title={`Copy "${block.heading}"`}
                            >
                              {copiedBlock === block.heading ? (
                                <Check className="h-3 w-3 text-emerald-500/70" />
                              ) : (
                                <Copy className="h-3 w-3 text-muted-foreground/25" />
                              )}
                            </button>
                          </div>
                        )}
                        <div className={proseClasses}>
                          <ReactMarkdown>{block.content}</ReactMarkdown>
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className={proseClasses}>
                  <ReactMarkdown>{displayOutput}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Utility bar */}
        {!isGenerating && (
          <div className="flex items-center justify-between px-5 py-2 border-t border-border/10">
            <div className="flex items-center gap-1">
              {[
                { onClick: handleCopy, icon: copied ? Check : Copy, label: copied ? 'Copied' : 'Copy', accent: copied },
                { onClick: onRegenerate, icon: RotateCcw, label: 'Regenerate' },
                { onClick: () => setShowSaveDialog(true), icon: BookmarkPlus, label: 'Save' },
              ].map(action => (
                <button
                  key={action.label}
                  onClick={action.onClick}
                  className={cn(
                    'inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-all duration-150',
                    action.accent
                      ? 'text-emerald-500/70'
                      : 'text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-muted/30'
                  )}
                >
                  <action.icon className="h-3 w-3" /> {action.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save dialog */}
      {showSaveDialog && (
        <div className="flex items-center gap-2 p-3 mt-2 rounded-lg border border-primary/15 bg-primary/[0.03]">
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

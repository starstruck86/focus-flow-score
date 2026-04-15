/**
 * CommandOutput — premium strategy document renderer.
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
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
import { STRATEGY_UI } from '@/lib/strategy-ui';
import type { OutputBlock } from '@/lib/commandTypes';

function enhanceReadability(md: string): string {
  const blocks = md.split('\n\n');
  const enhanced: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^[#\-*\d>|`]/.test(trimmed) || trimmed.startsWith('---')) {
      enhanced.push(trimmed);
      continue;
    }
    const labelMatch = trimmed.match(/^\*\*([^*]+):\*\*\s*(.+)/);
    if (labelMatch) {
      enhanced.push(`**${labelMatch[1]}**\n\n${labelMatch[2]}`);
      continue;
    }
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

const proseClasses = cn(
  'prose prose-sm sm:prose-base dark:prose-invert max-w-none',
  'prose-headings:text-foreground prose-headings:font-semibold prose-headings:tracking-tight',
  'prose-h1:text-xl prose-h1:leading-snug prose-h1:mb-6 prose-h1:mt-0',
  'prose-h2:text-[1.05rem] prose-h2:leading-snug prose-h2:mb-5 prose-h2:mt-12',
  'prose-h3:text-[15px] prose-h3:leading-snug prose-h3:mb-3 prose-h3:mt-8',
  'prose-h4:text-[13px] prose-h4:font-semibold prose-h4:mb-2 prose-h4:mt-5 prose-h4:text-foreground/85',
  'prose-p:text-[15px] prose-p:text-foreground/85 prose-p:leading-[1.92] prose-p:mb-6',
  'prose-li:text-[15px] prose-li:text-foreground/85 prose-li:leading-[1.8] prose-li:mb-3',
  'prose-ul:my-6 prose-ol:my-6',
  '[&_ul]:space-y-2.5 [&_ol]:space-y-3',
  'prose-ul:pl-1 prose-ol:pl-1',
  'prose-strong:text-foreground prose-strong:font-semibold',
  'prose-em:text-muted-foreground prose-em:text-[13px]',
  'prose-blockquote:border-l-2 prose-blockquote:border-primary/20 prose-blockquote:text-foreground/75 prose-blockquote:not-italic prose-blockquote:font-normal prose-blockquote:pl-4 prose-blockquote:my-6',
  'prose-code:text-primary/70 prose-code:bg-primary/[0.06] prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[13px] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
  'prose-hr:border-border/20 prose-hr:my-9',
);

const MINI_BLOCK_LABELS = [
  'The Idea', 'Why it works', 'Key Risk', 'Approach', 'Problem Statement',
  'Key Angles', 'Stakeholder Hypotheses', 'Recommended Angle', 'Recommended Action',
  'Recommended Actions', 'Next Step', 'Next Steps', 'Takeaway', 'Key Takeaway',
  'Key Takeaways', 'Summary'
];

function normalizeDocumentMarkdown(md: string): string {
  let text = md.replace(/\r\n/g, '\n').replace(/([.!?])\s+(\d+\.\s+)/g, '$1\n\n$2').replace(/\n(\d+\.\s)/g, '\n\n$1');
  for (const label of MINI_BLOCK_LABELS) {
    const re = new RegExp(`(^|\\n)(?:\\*\\*)?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\*\\*)?:\\s*`, 'gi');
    text = text.replace(re, `$1**${label}**\n\n`);
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

interface DocumentSegment {
  type: 'body' | 'label';
  label?: string;
  content: string;
}

function splitIntoDocumentSegments(md: string): DocumentSegment[] {
  const normalized = normalizeDocumentMarkdown(md);
  const regex = /\*\*([^*]+)\*\*\n\n([\s\S]*?)(?=(\n\*\*[^*]+\*\*\n\n)|$)/g;
  const segments: DocumentSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    const label = match[1]?.trim();
    const before = normalized.slice(lastIndex, match.index).trim();
    if (before) segments.push({ type: 'body', content: before });
    if (label && MINI_BLOCK_LABELS.map(v => v.toLowerCase()).includes(label.toLowerCase())) {
      segments.push({ type: 'label', label, content: match[2].trim() });
    } else {
      segments.push({ type: 'body', content: match[0].trim() });
    }
    lastIndex = regex.lastIndex;
  }

  const trailing = normalized.slice(lastIndex).trim();
  if (trailing) segments.push({ type: 'body', content: trailing });
  return segments.length ? segments : [{ type: 'body', content: normalized }];
}

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
  isGenerating, onRegenerate, onSaveAsTemplate,
}: Props) {
  const [viewMode, setViewMode] = useState<'clean' | 'edit'>('clean');
  const [editedOutput, setEditedOutput] = useState(output);
  const [copied, setCopied] = useState(false);
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    if (viewMode !== 'edit') setEditedOutput(output);
  }, [output, viewMode]);

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

  const renderSegments = (content: string) => {
    const segments = splitIntoDocumentSegments(content);
    return (
      <div className="space-y-5 sm:space-y-6">
        {segments.map((segment, index) => segment.type === 'label' ? (
          <div key={`${segment.label}-${index}`} className={cn(STRATEGY_UI.surface.subBlock, 'px-4 py-4 sm:px-5')}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-2.5">{segment.label}</div>
            <div className={proseClasses}><ReactMarkdown>{enhanceReadability(segment.content)}</ReactMarkdown></div>
          </div>
        ) : (
          <div key={`body-${index}`} className={proseClasses}><ReactMarkdown>{enhanceReadability(segment.content)}</ReactMarkdown></div>
        ))}
      </div>
    );
  };

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      <div className={cn(STRATEGY_UI.surface.document, 'overflow-hidden')}>
        <div className="px-6 sm:px-8 lg:px-10 pt-6 sm:pt-7 pb-4 sm:pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-[1.6rem] font-semibold text-foreground tracking-tight leading-tight">{docTitle}</h2>
              {(accountName || opportunityName) && (
                <p className="text-[13px] text-muted-foreground mt-2 font-medium">{accountName}{opportunityName ? ` · ${opportunityName}` : ''}</p>
              )}
            </div>
            {!isGenerating && (
              <div className="flex items-center gap-px rounded-lg bg-muted/25 p-0.5 shrink-0">
                <button onClick={() => setViewMode('clean')} className={cn('flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-100', viewMode === 'clean' ? 'bg-background text-foreground shadow-sm' : 'text-foreground/75 hover:text-foreground')}><Eye className="h-3 w-3" /> Read</button>
                <button onClick={() => setViewMode('edit')} className={cn('flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-100', viewMode === 'edit' ? 'bg-background text-foreground shadow-sm' : 'text-foreground/75 hover:text-foreground')}><Pencil className="h-3 w-3" /> Edit</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-[12px] text-muted-foreground mt-3.5">
            {playbookUsed && <span className="inline-flex items-center gap-1 text-primary/80 font-medium"><BookOpen className="h-3 w-3" /> {playbookUsed}</span>}
            {kiCount > 0 && <span className="inline-flex items-center gap-1"><Brain className="h-3 w-3" /> {kiCount} KIs</span>}
            {sources.length > 0 && (
              <button onClick={() => setShowSources(!showSources)} className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors duration-100">
                {showSources ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {sources.length} source{sources.length !== 1 ? 's' : ''}
              </button>
            )}
            <span className="inline-flex items-center gap-1 ml-auto text-muted-foreground"><Clock className="h-3 w-3" /> {generatedAt}</span>
          </div>
          {showSources && sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {sources.map((s, i) => <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-muted/35 text-foreground/75">{s}</span>)}
            </div>
          )}
        </div>

        <div className="mx-6 sm:mx-8 lg:mx-10 border-t border-border/20" />

        {isGenerating ? (
          <div className="px-8 py-24"><div className="flex flex-col items-center gap-3 text-muted-foreground"><div className="flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse" /><div className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse [animation-delay:150ms]" /><div className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse [animation-delay:300ms]" /></div><span className="text-sm">Generating…</span></div></div>
        ) : viewMode === 'edit' ? (
          <div className="p-6 sm:p-8 lg:p-10">
            <Textarea value={editedOutput} onChange={e => setEditedOutput(e.target.value)} className="min-h-[400px] border-0 text-[15px] leading-relaxed font-mono resize-y focus-visible:ring-0 bg-transparent" />
          </div>
        ) : (
          <div className="px-6 sm:px-8 lg:px-10 py-6 sm:py-8 lg:py-9">
            <div className={STRATEGY_UI.layout.document}>
              {subjectLine && (
                <div className="mb-8 pb-6 border-b border-border/20">
                  <span className={STRATEGY_UI.labels.micro}>Subject</span>
                  <p className="text-[16px] font-semibold text-foreground mt-2 leading-snug">{subjectLine}</p>
                </div>
              )}
              {hasBlocks ? (
                <div className="divide-y divide-border/15">
                  {blocks.map((block, i) => {
                    const semantic = classifySectionHeading(block.heading);
                    const accent = SEMANTIC_ACCENT[semantic];
                    return (
                      <section key={i} className={cn('group relative', i > 0 ? 'pt-9' : '', 'pb-8')}>
                        {block.heading && (
                          <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-2">
                              <accent.Icon className={cn('h-3.5 w-3.5 shrink-0', accent.color)} />
                              <h3 className="text-[12px] font-semibold text-foreground/75 tracking-[0.08em] uppercase">{block.heading}</h3>
                            </div>
                            <button onClick={() => handleCopyBlock(block.heading, block.content)} className="opacity-60 group-hover:opacity-100 transition-opacity duration-150 p-1.5 rounded-md hover:bg-muted/30" title={`Copy "${block.heading}"`}>
                              {copiedBlock === block.heading ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                            </button>
                          </div>
                        )}
                        {renderSegments(block.content)}
                      </section>
                    );
                  })}
                </div>
              ) : renderSegments(displayOutput)}
            </div>
          </div>
        )}

        {!isGenerating && (
          <div className="flex items-center justify-between px-6 sm:px-8 lg:px-10 py-3.5 border-t border-border/20">
            <div className="flex items-center gap-1 flex-wrap">
              {[
                { onClick: handleCopy, icon: copied ? Check : Copy, label: copied ? 'Copied' : 'Copy all', accent: copied },
                { onClick: onRegenerate, icon: RotateCcw, label: 'Regenerate' },
                { onClick: () => setShowSaveDialog(true), icon: BookmarkPlus, label: 'Save template' },
              ].map(action => (
                <button key={action.label} onClick={action.onClick} className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-md transition-all duration-100', action.accent ? 'text-emerald-500' : 'text-foreground/80 hover:text-foreground hover:bg-muted/30')}>
                  <action.icon className="h-3.5 w-3.5" /> {action.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {showSaveDialog && (
        <div className="flex items-center gap-2 p-3 mt-2 rounded-lg border border-border/20 bg-card/50">
          <Input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Template name…" className="h-8 text-sm flex-1 border-border/30" autoFocus onKeyDown={e => e.key === 'Enter' && handleSave()} />
          <Button size="sm" onClick={handleSave} disabled={!saveName.trim()} className="h-8">Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowSaveDialog(false)} className="h-8">Cancel</Button>
        </div>
      )}
    </div>
  );
}

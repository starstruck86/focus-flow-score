/**
 * ExecRetryCoaching — Elite coaching UX for Executive Response skill only.
 * Shows: verdict, pattern tags, side-by-side comparison, constraint box.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Zap, AlertTriangle, CheckCircle2, Target } from 'lucide-react';
import type { DojoScoreResult } from '@/lib/dojo/types';

// ── Pattern tag detection from feedback/topMistake ──

const EXEC_PATTERN_TAGS: { key: string; label: string; match: (r: DojoScoreResult) => boolean }[] = [
  {
    key: 'setup_first',
    label: 'Setup first',
    match: (r) => /setup|context first|buried|opened with/i.test(r.feedback + r.topMistake),
  },
  {
    key: 'no_number',
    label: 'No number-led opening',
    match: (r) => /number|metric|quantif|no.*data|generic/i.test(r.feedback + r.topMistake),
  },
  {
    key: 'hedging',
    label: 'Hedging',
    match: (r) => /hedg|"I think"|"we believe"|tentative|uncertain|weasel/i.test(r.feedback + r.topMistake),
  },
  {
    key: 'not_priority',
    label: 'Not priority-anchored',
    match: (r) => /priority|strategic|misalign|exec.*care|relevant/i.test(r.feedback + r.topMistake),
  },
  {
    key: 'too_long',
    label: 'Too many sentences',
    match: (r) => /brev|verbose|long|sentence|concis|wordy/i.test(r.feedback + r.topMistake),
  },
];

function detectPatternTags(result: DojoScoreResult): string[] {
  return EXEC_PATTERN_TAGS.filter((t) => t.match(result)).map((t) => t.label).slice(0, 2);
}

// ── Extract a sharp verdict from feedback ──

function extractVerdict(result: DojoScoreResult): string {
  const first = result.feedback.split(/(?<=[.!?])\s+/)[0];
  if (first && first.length > 10 && first.length < 120) return first;
  if (result.score >= 80) return 'Strong answer — direct, quantified, executive-ready.';
  if (result.score >= 60) return 'Decent structure, but not sharp enough for an exec.';
  return 'Too much setup — you buried the value.';
}

// ── Extract retry constraint from practiceCue or feedback ──

function extractRetryConstraint(result: DojoScoreResult): string {
  if (result.practiceCue) return result.practiceCue;
  const tags = detectPatternTags(result);
  if (tags.includes('No number-led opening')) return 'First sentence must start with a number or dollar amount.';
  if (tags.includes('Setup first')) return 'No setup sentence allowed — lead with the outcome.';
  if (tags.includes('Hedging')) return "State outcomes as facts. No 'I think' or 'we believe'.";
  if (tags.includes('Too many sentences')) return 'Two sentences maximum. Delete everything else.';
  return 'Lead with the outcome in your first sentence.';
}

// ── Components ──

interface ExecVerdictBannerProps {
  result: DojoScoreResult;
}

/** Sharp top-line verdict — first thing the user sees after scoring */
export function ExecVerdictBanner({ result }: ExecVerdictBannerProps) {
  const verdict = extractVerdict(result);
  const tags = detectPatternTags(result);
  const isStrong = result.score >= 75;

  return (
    <div className={cn(
      'rounded-lg border-l-4 px-3.5 py-3',
      isStrong
        ? 'border-l-green-500 bg-green-500/5'
        : 'border-l-destructive bg-destructive/5',
    )}>
      <div className="flex items-start gap-2.5">
        {isStrong ? (
          <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
        )}
        <div className="min-w-0 space-y-1.5">
          <p className={cn(
            'text-[13px] font-bold leading-snug',
            isStrong ? 'text-green-700 dark:text-green-400' : 'text-destructive',
          )}>
            {verdict}
          </p>
          {tags.length > 0 && !isStrong && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-[9px] font-medium px-1.5 py-0 h-4 border-destructive/30 text-destructive"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Stacked comparison: weak answer (dimmed) then stronger version (prominent) */
interface ExecComparisonProps {
  userText: string;
  improvedVersion: string;
}

export function ExecSideBySide({ userText, improvedVersion }: ExecComparisonProps) {
  if (!userText || !improvedVersion) return null;

  return (
    <div className="space-y-2">
      {/* User's answer — secondary emphasis */}
      <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Your Answer</p>
        <p className="text-xs text-muted-foreground leading-relaxed">"{userText}"</p>
      </div>

      {/* Stronger version — primary emphasis */}
      <div className="rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400 mb-1">Stronger Version</p>
        <p className="text-[13px] font-medium text-foreground leading-relaxed">"{improvedVersion}"</p>
      </div>
    </div>
  );
}

/** Retry constraint box — shown above the retry textarea */
interface ExecRetryConstraintProps {
  result: DojoScoreResult;
  scenarioContext?: string;
}

export function ExecRetryConstraintBox({ result, scenarioContext }: ExecRetryConstraintProps) {
  const constraint = extractRetryConstraint(result);

  return (
    <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3.5 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <Target className="h-3.5 w-3.5 text-destructive shrink-0" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-destructive">
          Retry Rule
        </p>
      </div>
      <p className="text-sm font-semibold text-foreground leading-snug pl-[22px]">{constraint}</p>
      {scenarioContext && (
        <div className="flex items-center gap-1.5 pl-[22px] pt-1.5 border-t border-destructive/10">
          <Zap className="h-3 w-3 text-destructive/60 shrink-0" />
          <p className="text-[10px] text-muted-foreground italic">
            Same exec. Same pressure. Answer sharper.
          </p>
        </div>
      )}
    </div>
  );
}

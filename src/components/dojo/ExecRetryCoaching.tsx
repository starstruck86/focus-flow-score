/**
 * ExecRetryCoaching — Elite coaching UX for Executive Response skill only.
 * Shows: verdict, pattern tags, side-by-side comparison, constraint box.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Zap, AlertTriangle, Lightbulb, Target } from 'lucide-react';
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
  // Use the first sentence of feedback as the verdict — the edge function is trained to lead with it
  const first = result.feedback.split(/(?<=[.!?])\s+/)[0];
  if (first && first.length > 10 && first.length < 120) return first;
  // Fallback based on score
  if (result.score >= 80) return 'Strong answer — direct, quantified, executive-ready.';
  if (result.score >= 60) return 'Decent structure, but not sharp enough for an exec.';
  return 'Too much setup — you buried the value.';
}

// ── Extract retry constraint from practiceCue or feedback ──

function extractRetryConstraint(result: DojoScoreResult): string {
  if (result.practiceCue) return result.practiceCue;
  // Fallback
  const tags = detectPatternTags(result);
  if (tags.includes('No number-led opening')) return 'First sentence must start with a number or dollar amount.';
  if (tags.includes('Setup first')) return 'No setup sentence allowed — lead with the outcome.';
  if (tags.includes('Hedging')) return "State outcomes as facts. No 'I think' or 'we believe'.";
  if (tags.includes('Too many sentences')) return 'Two sentences maximum. Delete everything else.';
  return 'Lead with the outcome in your first sentence.';
}

// ── Component Props ──

interface ExecVerdictBannerProps {
  result: DojoScoreResult;
}

/** Sharp top-line verdict shown prominently in feedback */
export function ExecVerdictBanner({ result }: ExecVerdictBannerProps) {
  const verdict = extractVerdict(result);
  const tags = detectPatternTags(result);
  const isStrong = result.score >= 75;

  return (
    <Card className={cn(
      'border-l-4',
      isStrong ? 'border-l-green-500 bg-green-500/5' : 'border-l-red-500 bg-red-500/5',
    )}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-2">
          {isStrong ? (
            <Lightbulb className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          )}
          <p className={cn(
            'text-sm font-bold leading-snug',
            isStrong ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400',
          )}>
            {verdict}
          </p>
        </div>
        {tags.length > 0 && (
          <div className="flex gap-1.5 pl-6">
            {tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-[9px] font-semibold border-red-500/30 text-red-600 dark:text-red-400">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Side-by-side comparison: user's answer vs stronger version */
interface ExecComparisonProps {
  userText: string;
  improvedVersion: string;
}

export function ExecSideBySide({ userText, improvedVersion }: ExecComparisonProps) {
  if (!userText || !improvedVersion) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <Card className="border-red-500/20 bg-red-500/5">
        <CardContent className="p-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-500">Your Answer</p>
          <p className="text-xs text-foreground leading-relaxed">"{userText}"</p>
        </CardContent>
      </Card>
      <Card className="border-green-500/20 bg-green-500/5">
        <CardContent className="p-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-green-500">Stronger Version</p>
          <p className="text-xs text-foreground leading-relaxed">"{improvedVersion}"</p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Retry constraint box — shown above the retry CTA */
interface ExecRetryConstraintProps {
  result: DojoScoreResult;
  scenarioContext?: string;
}

export function ExecRetryConstraintBox({ result, scenarioContext }: ExecRetryConstraintProps) {
  const constraint = extractRetryConstraint(result);

  return (
    <Card className="border-red-500/30 bg-red-500/5">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Target className="h-3.5 w-3.5 text-red-500 shrink-0" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
            Retry Rule
          </p>
        </div>
        <p className="text-sm font-semibold text-foreground pl-5.5">{constraint}</p>
        {scenarioContext && (
          <div className="flex items-center gap-1.5 pl-5.5 pt-1 border-t border-red-500/10">
            <Zap className="h-3 w-3 text-red-400 shrink-0" />
            <p className="text-[10px] text-muted-foreground italic">
              Same exec. Same pressure. Answer sharper.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

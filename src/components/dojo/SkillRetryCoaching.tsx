/**
 * SkillRetryCoaching — Elite coaching UX for ALL skills.
 * Shows: verdict, pattern tags, side-by-side comparison, constraint box.
 * Executive Response uses ExecRetryCoaching (unchanged).
 */
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, Target, Zap } from 'lucide-react';
import type { DojoScoreResult } from '@/lib/dojo/types';
import type { SkillFocus } from '@/lib/dojo/scenarios';

// ── Skill-specific pattern tag detection ──

type PatternTagDef = { key: string; label: string; match: (r: DojoScoreResult) => boolean };

const SKILL_PATTERN_TAGS: Record<string, PatternTagDef[]> = {
  objection_handling: [
    { key: 'counter_punch', label: 'Counter-punching', match: (r) => /counter.?punch|answered.*before.*diagnos|jumped to|pitched.*into/i.test(r.feedback + r.topMistake) },
    { key: 'no_diagnosis', label: 'No diagnosis', match: (r) => /diagnos|isolat|real concern|never asked|surface/i.test(r.feedback + r.topMistake) },
    { key: 'weak_redirect', label: 'Weak redirect', match: (r) => /redirect|reframe|still owns.*frame|feature.*level|no.*business/i.test(r.feedback + r.topMistake) },
    { key: 'no_control', label: 'No control', match: (r) => /control|next step|weak.*close|let.*buyer/i.test(r.feedback + r.topMistake) },
    { key: 'no_proof', label: 'No proof', match: (r) => /proof|evidence|claim.*without|no.*example|no.*data|no.*metric/i.test(r.feedback + r.topMistake) },
  ],
  discovery: [
    { key: 'stacked', label: 'Stacked questions', match: (r) => /stack|multiple.*question|compound|three.*question|picked.*easiest/i.test(r.feedback + r.topMistake) },
    { key: 'surface', label: 'Stayed surface', match: (r) => /surface|shallow|face value|didn.*dig|accepted.*answer|moved on/i.test(r.feedback + r.topMistake) },
    { key: 'no_impact', label: 'No business impact', match: (r) => /business.*impact|revenue|cost|no.*number|quantif|what.*cost/i.test(r.feedback + r.topMistake) },
    { key: 'no_urgency', label: 'No urgency test', match: (r) => /urgency|timeline|trigger|consequence.*wait/i.test(r.feedback + r.topMistake) },
    { key: 'interrogation', label: 'Interrogation mode', match: (r) => /interrogat|rapid.*fire|felt like.*interview|script/i.test(r.feedback + r.topMistake) },
  ],
  deal_control: [
    { key: 'accepted_delay', label: 'Accepted the delay', match: (r) => /accepted.*delay|sounds good|circle back|let me.*think|gave away/i.test(r.feedback + r.topMistake) },
    { key: 'no_commitment', label: 'No commitment', match: (r) => /commit|accountab|mutual.*plan|what.*buyer.*do|no.*mutual/i.test(r.feedback + r.topMistake) },
    { key: 'vague_next', label: 'Vague next step', match: (r) => /vague.*next|reconnect.*soon|no.*date|no.*time|undefin/i.test(r.feedback + r.topMistake) },
    { key: 'too_passive', label: 'Too passive', match: (r) => /passive|asked.*what.*think|didn.*lead|didn.*propose/i.test(r.feedback + r.topMistake) },
    { key: 'unnamed_risk', label: 'Risk unnamed', match: (r) => /risk|drift|stall|didn.*name|didn.*call out/i.test(r.feedback + r.topMistake) },
  ],
  qualification: [
    { key: 'enthusiasm_trap', label: 'Enthusiasm ≠ qualified', match: (r) => /enthusiasm|love.*this|excited.*but|no.*budget|no.*authority/i.test(r.feedback + r.topMistake) },
    { key: 'weak_pain', label: 'Accepted weak pain', match: (r) => /weak.*pain|nice.to.have|vague.*pain|not.*real|casual/i.test(r.feedback + r.topMistake) },
    { key: 'no_stakeholders', label: 'No stakeholder map', match: (r) => /stakeholder|who.*else|decision.*maker|one.*person|never.*met/i.test(r.feedback + r.topMistake) },
    { key: 'no_urgency', label: 'No urgency test', match: (r) => /urgency|timeline|trigger|no.*deadline|consequence.*wait/i.test(r.feedback + r.topMistake) },
    { key: 'no_disqualify', label: 'Didn\'t disqualify', match: (r) => /disqualif|should.*have.*walked|hope.*not.*qualif|red.*flag.*ignored/i.test(r.feedback + r.topMistake) },
  ],
};

function detectPatternTags(result: DojoScoreResult, skill: string): string[] {
  const tags = SKILL_PATTERN_TAGS[skill];
  if (!tags) return [];
  return tags.filter((t) => t.match(result)).map((t) => t.label).slice(0, 2);
}

// ── Verdict extraction ──

function extractVerdict(result: DojoScoreResult): string {
  const first = result.feedback.split(/(?<=[.!?])\s+/)[0];
  if (first && first.length > 10 && first.length < 140) return first;
  if (result.score >= 80) return 'Strong execution — specific, controlled, commercially sharp.';
  if (result.score >= 60) return 'Competent, but you left an opening the buyer will exploit.';
  return 'You lost the thread — the buyer is still in control.';
}

// ── Constraint extraction ──

const SKILL_DEFAULT_CONSTRAINTS: Record<string, string> = {
  objection_handling: 'Ask one diagnostic question before responding to the objection.',
  discovery: 'Your next question must connect to revenue, cost, or risk.',
  deal_control: 'End with a specific date and a mutual commitment.',
  qualification: 'Ask one question that could disqualify this deal.',
};

function extractRetryConstraint(result: DojoScoreResult, skill: string): string {
  if (result.practiceCue && result.practiceCue.length > 10) return result.practiceCue;
  return SKILL_DEFAULT_CONSTRAINTS[skill] || 'Focus on the one thing that would change the outcome.';
}

// ── Pressure continuity labels ──
const PRESSURE_LABELS: Record<string, string> = {
  objection_handling: 'Same buyer. Same resistance. Handle it sharper.',
  discovery: 'Same conversation. Same surface answer. Go deeper.',
  deal_control: 'Same deal. Same stall. Take control.',
  qualification: 'Same buyer. Same enthusiasm. Qualify harder.',
};

// ── Components ──

interface SkillVerdictBannerProps {
  result: DojoScoreResult;
  skill: string;
}

export function SkillVerdictBanner({ result, skill }: SkillVerdictBannerProps) {
  const verdict = extractVerdict(result);
  const tags = detectPatternTags(result, skill);
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

interface SkillComparisonProps {
  userText: string;
  improvedVersion: string;
}

export function SkillSideBySide({ userText, improvedVersion }: SkillComparisonProps) {
  if (!userText || !improvedVersion) return null;

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Your Answer</p>
        <p className="text-xs text-muted-foreground leading-relaxed">"{userText}"</p>
      </div>
      <div className="rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400 mb-1">Stronger Version</p>
        <p className="text-[13px] font-medium text-foreground leading-relaxed">"{improvedVersion}"</p>
      </div>
    </div>
  );
}

interface SkillRetryConstraintProps {
  result: DojoScoreResult;
  skill: string;
  scenarioContext?: string;
}

export function SkillRetryConstraintBox({ result, skill, scenarioContext }: SkillRetryConstraintProps) {
  const constraint = extractRetryConstraint(result, skill);
  const pressureLabel = PRESSURE_LABELS[skill];

  return (
    <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3.5 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <Target className="h-3.5 w-3.5 text-destructive shrink-0" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-destructive">
          Retry Rule
        </p>
      </div>
      <p className="text-sm font-semibold text-foreground leading-snug pl-[22px]">{constraint}</p>
      {scenarioContext && pressureLabel && (
        <div className="flex items-center gap-1.5 pl-[22px] pt-1.5 border-t border-destructive/10">
          <Zap className="h-3 w-3 text-destructive/60 shrink-0" />
          <p className="text-[10px] text-muted-foreground italic">
            {pressureLabel}
          </p>
        </div>
      )}
    </div>
  );
}

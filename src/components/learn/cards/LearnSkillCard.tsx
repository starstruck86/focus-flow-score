/**
 * LearnSkillCard — Grid card for each skill.
 * Shows tier, progress, blockers, pattern contrast, and actionable CTAs.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowRight, AlertTriangle, Zap, Swords } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UserSkillLevel } from '@/lib/learning/learnLevelEvaluator';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { buildSkillSession, skillSessionToParams } from '@/lib/learning/skillSession';
import { getSkillTier } from '@/lib/learning/learnSkillLevels';

/** Pattern contrast examples per skill */
const PATTERN_CONTRASTS: Record<string, { wrong: string; right: string }> = {
  objection_handling: {
    wrong: '"I understand, but let me tell you why our product is better…"',
    right: '"That makes sense — can I ask what specifically about your current setup makes you feel locked in?"',
  },
  discovery: {
    wrong: '"What are your goals? And what\'s your timeline? And budget?"',
    right: '"When you say efficiency — what does that actually cost you each month?"',
  },
  executive_response: {
    wrong: '"So basically what we do is we have this platform that integrates with your existing tools and…"',
    right: '"You\'re losing $40K/month to manual segmentation. We fix that in 6 weeks."',
  },
  deal_control: {
    wrong: '"Let me know when you\'re ready to move forward."',
    right: '"Based on what you shared, here\'s what I\'d recommend for next steps — does Thursday work for a technical review?"',
  },
  qualification: {
    wrong: '"This sounds like a great fit! Let me send over a proposal."',
    right: '"Before we go further — you mentioned the CFO needs to sign off. Have they seen a case for this yet?"',
  },
};

interface Props {
  level: UserSkillLevel;
}

export function LearnSkillCard({ level }: Props) {
  const navigate = useNavigate();
  const label = SKILL_LABELS[level.skill];
  const session = buildSkillSession(level, label);
  const tierDef = getSkillTier(level.skill, level.currentTier);
  const contrast = PATTERN_CONTRASTS[level.skill];

  const isCloseToTierUp = level.progressWithinTier >= 75;
  const isMaxTier = !level.nextTier;

  const barColor = isMaxTier
    ? 'bg-green-500'
    : isCloseToTierUp
      ? 'bg-amber-500'
      : 'bg-primary';

  const handleTrain = () => {
    navigate(`/learn/skill-builder?${skillSessionToParams(session)}`, {
      state: { skillSession: session },
    });
  };

  const handlePractice = () => {
    navigate(`/dojo/session?${skillSessionToParams(session)}`, {
      state: { skillSession: session, skillFocus: session.skillId },
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3 hover:border-primary/20 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-foreground">{label}</p>
        <Badge
          variant="secondary"
          className="text-[10px] font-medium px-1.5 py-0"
        >
          Tier {level.currentTier} — L{level.overallLevel}
        </Badge>
      </div>

      {/* Progress bar */}
      {!isMaxTier && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              → Tier {level.currentTier + 1}
            </p>
            <p className={cn('text-[11px] font-medium', isCloseToTierUp ? 'text-amber-500' : 'text-muted-foreground')}>
              {level.progressWithinTier}%
            </p>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', barColor)}
              style={{ width: `${level.progressWithinTier}%` }}
            />
          </div>
        </div>
      )}

      {/* Blockers */}
      {level.gaps.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            <p className="text-[11px] font-medium text-muted-foreground">What's blocking you</p>
          </div>
          {level.gaps.slice(0, 2).map((gap) => (
            <div key={gap.metric} className="flex items-center justify-between px-2 py-1 rounded bg-muted/50">
              <p className="text-[11px] text-muted-foreground capitalize">
                {gap.label || gap.metric.replace(/([A-Z])/g, ' $1').trim()}
              </p>
              <p className="text-[11px] font-medium text-destructive">
                {gap.current ?? 0}/{gap.required}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Pattern contrast */}
      {contrast && (
        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-destructive/5 border border-destructive/10">
            <span className="shrink-0">❌</span>
            <p className="text-muted-foreground leading-relaxed italic">{contrast.wrong}</p>
          </div>
          <div className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-green-500/5 border border-green-500/10">
            <span className="shrink-0">✅</span>
            <p className="text-foreground leading-relaxed italic">{contrast.right}</p>
          </div>
        </div>
      )}

      {/* Elite behavior */}
      {tierDef?.eliteBehavior && (
        <p className="text-[10px] text-muted-foreground italic leading-relaxed border-l-2 border-primary/20 pl-2">
          Elite: {tierDef.eliteBehavior}
        </p>
      )}

      {/* CTAs */}
      <div className="flex gap-2">
        <Button onClick={handleTrain} variant="outline" size="sm" className="flex-1 gap-1 text-xs">
          <Zap className="h-3 w-3" />
          Train
        </Button>
        <Button onClick={handlePractice} variant="ghost" size="sm" className="flex-1 gap-1 text-xs">
          <Swords className="h-3 w-3" />
          Practice
        </Button>
      </div>
    </div>
  );
}

/**
 * SkillTierUpModal — Shown once when user advances to a new tier.
 */

import { useNavigate } from 'react-router-dom';
import type { UserSkillLevel } from '@/lib/learning/learnLevelEvaluator';
import { getSkillTier } from '@/lib/learning/learnSkillLevels';
import { getTierUnlocks } from '@/lib/learning/learnTierUnlocks';
import { dismissTierUp } from '@/lib/learning/levelEventStore';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ArrowRight, Sparkles, Unlock, Target } from 'lucide-react';

interface SkillTierUpModalProps {
  level: UserSkillLevel | null;
  open: boolean;
  onClose: () => void;
}

export function SkillTierUpModal({ level, open, onClose }: SkillTierUpModalProps) {
  const navigate = useNavigate();

  if (!level) return null;

  const tierDef = getSkillTier(level.skill, level.currentTier);
  const unlocks = getTierUnlocks(level.skill, level.currentTier);

  const handleDismiss = () => {
    dismissTierUp(level.skill, level.currentTier);
    onClose();
  };

  const handleTrainSkill = () => {
    dismissTierUp(level.skill, level.currentTier);
    onClose();
    navigate('/learn/skill-builder', {
      state: { skill: level.skill, duration: 30 },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleDismiss(); }}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="bg-primary/5 border-b border-primary/10 px-5 py-4 text-center space-y-1">
          <Sparkles className="h-8 w-8 text-primary mx-auto" />
          <p className="text-lg font-bold text-foreground">You Leveled Up</p>
          <p className="text-sm text-primary font-medium">
            Tier {level.currentTier}: {level.currentTierName}
          </p>
          <p className="text-xs text-muted-foreground">
            {SKILL_LABELS[level.skill]}
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* What Changed */}
          {tierDef?.whatChanges && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                What Changed
              </p>
              <p className="text-sm text-foreground leading-relaxed">
                {tierDef.whatChanges}
              </p>
            </div>
          )}

          {/* What This Unlocks */}
          {unlocks.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Unlock className="h-3 w-3 text-primary" />
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  What This Unlocks
                </p>
              </div>
              <div className="grid gap-1">
                {unlocks.map((u) => (
                  <div
                    key={u}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-primary/5 border border-primary/10"
                  >
                    <div className="h-1 w-1 rounded-full bg-primary shrink-0" />
                    <p className="text-xs text-foreground">{u}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next Tier Preview */}
          {level.nextTier && (
            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-muted/50 border border-border">
              <Target className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-[11px] font-medium text-foreground">
                  Next: Tier {level.nextTier.tier} — {level.nextTier.name}
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {level.nextTier.description}
                </p>
              </div>
            </div>
          )}

          {/* CTAs */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleTrainSkill}
              className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center justify-center gap-1.5"
            >
              Train This Skill
              <ArrowRight className="h-3 w-3" />
            </button>
            <button
              onClick={handleDismiss}
              className="h-9 px-3 rounded-md border border-border text-xs font-medium text-muted-foreground hover:bg-accent/50 transition-colors"
            >
              Later
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

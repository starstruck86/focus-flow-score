import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Play, Swords, MessageSquare, Eye, Compass, ShieldCheck, Target, Mic, Phone, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import type { SkillStat } from '@/lib/dojo/scenarios';
import { MockCallSimulator } from '@/components/coach/MockCallSimulator';
import { ObjectionDrillReps } from '@/components/coach/ObjectionDrillReps';

import type { RecommendedMode } from '@/lib/learning/practiceMapping';

type InlineMode = 'mock-call' | 'objection-reps' | null;

interface TrainingModesProps {
  skillStats: SkillStat[];
  onStartAutopilot: () => void;
  highlightMode?: RecommendedMode | null;
}

export function TrainingModes({ skillStats, onStartAutopilot, highlightMode }: TrainingModesProps) {
  const navigate = useNavigate();
  const [inlineMode, setInlineMode] = useState<InlineMode>(null);

  const toggleInline = (mode: InlineMode) => {
    setInlineMode(prev => prev === mode ? null : mode);
  };

  const startCustom = (skill: SkillFocus) => {
    navigate('/dojo/session', { state: { skillFocus: skill, mode: 'custom' } });
  };

  const startAudioSession = (skill: SkillFocus) => {
    navigate('/dojo/session', { state: { skillFocus: skill, mode: 'custom', sessionType: 'audio' } });
  };

  const startRoleplay = (skill: SkillFocus) => {
    navigate('/dojo/session', { state: { skillFocus: skill, mode: 'roleplay', sessionType: 'roleplay' } });
  };

  const startReview = (skill: SkillFocus) => {
    navigate('/dojo/session', { state: { skillFocus: skill, mode: 'review', sessionType: 'review' } });
  };

  return (
    <div className="space-y-4">
      {/* Mode cards */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Training Modes
        </p>
        <div className="grid grid-cols-3 gap-2">
          <ModeCard
            icon={Swords}
            title="Drill"
            description="Single scenario, coached"
            highlight={highlightMode === 'drill'}
            onClick={() => startCustom('objection_handling')}
          />
          <ModeCard
            icon={MessageSquare}
            title="Roleplay"
            description="Multi-turn buyer sim"
            highlight={highlightMode === 'roleplay'}
            onClick={() => startRoleplay('discovery')}
          />
          <ModeCard
            icon={Eye}
            title="Review"
            description="Critique weak responses"
            onClick={() => startReview('objection_handling')}
          />
          <ModeCard
            icon={Phone}
            title="Mock Call"
            description="Full call simulation"
            active={inlineMode === 'mock-call'}
            highlight={highlightMode === 'mock-call'}
            onClick={() => toggleInline('mock-call')}
          />
          <ModeCard
            icon={Shield}
            title="Objection Reps"
            description="Rapid-fire objections"
            active={inlineMode === 'objection-reps'}
            highlight={highlightMode === 'objection-reps'}
            onClick={() => toggleInline('objection-reps')}
          />
          <ModeCard
            icon={Mic}
            title="Audio Session"
            description="Voice-guided coaching"
            highlight={highlightMode === 'drill'}
            onClick={() => startAudioSession('objection_handling')}
          />
          <ModeCard
            icon={Compass}
            title="Autopilot"
            description="Dave picks your drill"
            onClick={onStartAutopilot}
          />
        </div>
      </div>

      {/* Inline practice panels */}
      {inlineMode === 'mock-call' && (
        <div className="rounded-lg border border-border/60 bg-card p-2">
          <MockCallSimulator />
        </div>
      )}
      {inlineMode === 'objection-reps' && (
        <div className="rounded-lg border border-border/60 bg-card p-2">
          <ObjectionDrillReps />
        </div>
      )}

      {/* Skill picker */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Pick a Skill
        </p>
        <div className="grid grid-cols-1 gap-2">
          {(['objection_handling', 'discovery', 'executive_response', 'deal_control', 'qualification'] as SkillFocus[]).map(skill => {
            const stat = skillStats.find(s => s.skill === skill);
            return (
              <button
                key={skill}
                onClick={() => startCustom(skill)}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-card hover:bg-accent/50 transition-colors text-left"
              >
                <SkillIcon skill={skill} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{SKILL_LABELS[skill]}</p>
                  <p className="text-xs text-muted-foreground">
                    {stat?.count ?? 0} reps · {stat?.avgFirstAttempt ?? '—'} avg
                  </p>
                </div>
                <Play className="h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SkillIcon({ skill }: { skill: SkillFocus }) {
  const icons: Record<SkillFocus, React.ElementType> = {
    objection_handling: Swords,
    discovery: Target,
    executive_response: MessageSquare,
    deal_control: Compass,
    qualification: ShieldCheck,
  };
  const Icon = icons[skill];
  return (
    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
      <Icon className="h-4 w-4 text-primary" />
    </div>
  );
}

function ModeCard({ icon: Icon, title, description, onClick, active, highlight }: {
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
  active?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors text-center",
        active ? "border-primary bg-primary/5" :
        highlight ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" :
        "border-border/60 bg-card hover:bg-accent/50"
      )}
    >
      <Icon className={cn("h-5 w-5", active || highlight ? "text-primary" : "text-primary")} />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-[10px] text-muted-foreground">{description}</p>
    </button>
  );
}

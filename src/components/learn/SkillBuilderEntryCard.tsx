/**
 * Skill Builder Selection Card — Entry point on Learn page
 *
 * Lets user choose a skill + duration to start a Skill Builder session.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SkillFocus } from '@/lib/dojo/scenarios';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { Dumbbell, Clock, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const SKILLS: SkillFocus[] = ['discovery', 'objection_handling', 'executive_response', 'deal_control', 'qualification'];
const DURATIONS = [15, 30, 60] as const;

export function SkillBuilderEntryCard() {
  const navigate = useNavigate();
  const [selectedSkill, setSelectedSkill] = useState<SkillFocus | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number>(30);
  const [expanded, setExpanded] = useState(false);

  const startSession = useCallback(() => {
    if (!selectedSkill) return;
    navigate('/learn/skill-builder', {
      state: { skill: selectedSkill, duration: selectedDuration },
    });
  }, [navigate, selectedSkill, selectedDuration]);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full rounded-lg border border-border bg-card p-4 flex items-center gap-3 hover:bg-accent/50 transition-colors text-left"
      >
        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Dumbbell className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Build a Skill</p>
          <p className="text-xs text-muted-foreground">Choose a skill and duration for structured practice</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Dumbbell className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium text-foreground">Build a Skill</p>
      </div>

      {/* Skill selection */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Skill</p>
        <div className="flex flex-wrap gap-1.5">
          {SKILLS.map(skill => (
            <button
              key={skill}
              onClick={() => setSelectedSkill(skill)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                selectedSkill === skill
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              {SKILL_LABELS[skill]}
            </button>
          ))}
        </div>
      </div>

      {/* Duration selection */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Duration</p>
        <div className="flex gap-2">
          {DURATIONS.map(d => (
            <button
              key={d}
              onClick={() => setSelectedDuration(d)}
              className={`flex-1 h-9 rounded-md text-xs font-medium border flex items-center justify-center gap-1 transition-colors ${
                selectedDuration === d
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              <Clock className="h-3 w-3" />
              {d} min
            </button>
          ))}
        </div>
      </div>

      {/* Start button */}
      <button
        onClick={startSession}
        disabled={!selectedSkill}
        className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        Start Training <ChevronRight className="h-3.5 w-3.5" />
      </button>

      <button
        onClick={() => setExpanded(false)}
        className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

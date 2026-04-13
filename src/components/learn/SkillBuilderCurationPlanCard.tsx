/**
 * Skill Builder Curation Plan Card — Internal audit surface
 */

import { Badge } from '@/components/ui/badge';
import { Wrench, ArrowUp, Target } from 'lucide-react';
import type { SkillBuilderCurationPlan, CurationTask } from '@/lib/learning/skillBuilderCurationPlan';

interface Props {
  plan: SkillBuilderCurationPlan;
}

const TYPE_LABELS: Record<string, string> = {
  fill_pattern_gap: 'Fill gap',
  add_pressure_variants: 'Add pressure',
  add_multi_thread_variants: 'Add multi-thread',
  reduce_redundancy: 'Reduce redundancy',
  improve_sequencing: 'Fix sequencing',
};

export function SkillBuilderCurationPlanCard({ plan }: Props) {
  const topTasks = plan.tasks.slice(0, 8);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">Curation Plan</p>
        <Badge variant="secondary" className="text-[9px]">{plan.tasks.length} tasks</Badge>
      </div>

      {/* Top Priority Skills */}
      {plan.topPrioritySkills.length > 0 && (
        <div className="rounded-md bg-destructive/5 border border-destructive/20 px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5">
            <ArrowUp className="h-3 w-3 text-destructive" />
            <p className="text-[10px] font-semibold text-foreground">Most Urgent Skills</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {plan.topPrioritySkills.map(s => (
              <Badge key={s} variant="destructive" className="text-[9px] capitalize">
                {s.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Top Priority Patterns */}
      {plan.topPriorityPatterns.length > 0 && (
        <div className="rounded-md bg-amber-500/5 border border-amber-500/20 px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5">
            <Target className="h-3 w-3 text-amber-600" />
            <p className="text-[10px] font-semibold text-foreground">Most Urgent Patterns</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {plan.topPriorityPatterns.slice(0, 6).map(p => (
              <Badge key={p} variant="outline" className="text-[9px] border-amber-500/40 text-amber-700">
                {p.replace(/_/g, ' ')}
              </Badge>
            ))}
            {plan.topPriorityPatterns.length > 6 && (
              <span className="text-[9px] text-muted-foreground">+{plan.topPriorityPatterns.length - 6} more</span>
            )}
          </div>
        </div>
      )}

      {/* Top Fixes */}
      <div className="space-y-2">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Top Fixes</p>
        {topTasks.map((t, i) => (
          <TaskRow key={i} task={t} index={i} />
        ))}
        {plan.tasks.length > 8 && (
          <p className="text-[9px] text-muted-foreground">+{plan.tasks.length - 8} more tasks</p>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, index }: { task: CurationTask; index: number }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/50 last:border-0">
      <span className="text-[9px] text-muted-foreground font-mono mt-0.5 w-4 shrink-0">{index + 1}</span>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            variant={task.priority === 'high' ? 'destructive' : task.priority === 'medium' ? 'secondary' : 'outline'}
            className="text-[8px]"
          >
            {task.priority}
          </Badge>
          <Badge variant="outline" className="text-[8px]">
            {TYPE_LABELS[task.type] ?? task.type}
          </Badge>
          <span className="text-[9px] capitalize text-muted-foreground">{task.skill.replace(/_/g, ' ')}</span>
        </div>
        <p className="text-[10px] text-foreground">{task.action}</p>
        <p className="text-[9px] text-muted-foreground">{task.reason}</p>
      </div>
    </div>
  );
}

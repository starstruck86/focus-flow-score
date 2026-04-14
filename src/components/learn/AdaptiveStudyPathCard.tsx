import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Compass, BookOpen, Target, Zap, Users, Wrench, Shield, Flame } from 'lucide-react';
import type { AdaptiveStudyPath, StudyMode } from '@/lib/learning/learnPathEngine';
import { RecommendedKIListCard } from './RecommendedKIListCard';
import { RecommendedLessonListCard } from './RecommendedLessonListCard';

const MODE_CONFIG: Record<StudyMode, { icon: typeof Compass; badge: string; color: string }> = {
  active_lane: { icon: Flame, badge: 'Active Lane', color: 'bg-primary/10 text-primary' },
  today_rep: { icon: Target, badge: 'Today\'s Rep', color: 'bg-primary/10 text-primary' },
  friday_prep: { icon: Zap, badge: 'Friday Prep', color: 'bg-amber-500/10 text-amber-600' },
  block_remediation: { icon: Wrench, badge: 'Remediation', color: 'bg-red-500/10 text-red-600' },
  pressure_gap: { icon: Shield, badge: 'Pressure', color: 'bg-orange-500/10 text-orange-600' },
  multi_thread: { icon: Users, badge: 'Multi-Thread', color: 'bg-violet-500/10 text-violet-600' },
  weak_anchor: { icon: Target, badge: 'Weak Anchor', color: 'bg-amber-500/10 text-amber-600' },
  maintenance: { icon: BookOpen, badge: 'Maintenance', color: 'bg-muted text-muted-foreground' },
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'Strong signal',
  medium: 'Moderate signal',
  low: 'Light signal',
};

interface Props {
  path: AdaptiveStudyPath;
}

export function AdaptiveStudyPathCard({ path }: Props) {
  const config = MODE_CONFIG[path.mode];
  const Icon = config.icon;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
              <Compass className="h-3.5 w-3.5 text-primary" />
            </div>
            <CardTitle className="text-sm">What to Study Next</CardTitle>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.color}`}>
              <Icon className="h-2.5 w-2.5 mr-0.5" />
              {config.badge}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {/* Headline + Rationale */}
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{path.headline}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{path.rationale}</p>
        </div>

        {/* Primary Focus */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/50 border border-border/50">
          <Target className="h-3 w-3 text-primary shrink-0" />
          <p className="text-xs">
            <span className="text-muted-foreground">Focus:</span>{' '}
            <span className="font-medium text-foreground">{path.primaryFocus.label}</span>
          </p>
        </div>

        {/* KI + Lesson recommendations */}
        {path.recommendedKIs.length > 0 && (
          <RecommendedKIListCard kis={path.recommendedKIs} />
        )}
        {path.recommendedLessons.length > 0 && (
          <RecommendedLessonListCard lessons={path.recommendedLessons} />
        )}

        {/* Confidence */}
        <p className="text-[10px] text-muted-foreground/70 text-right">
          {CONFIDENCE_LABEL[path.confidence]}
        </p>
      </CardContent>
    </Card>
  );
}

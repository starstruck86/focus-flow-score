import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Zap, BookOpen, TrendingUp, Target, CheckCircle2 } from 'lucide-react';

interface ProactiveDaveCardProps {
  onMicroDrill?: () => void;
  hasCompletedRepsToday?: boolean;
  streak?: number;
  hasBenchmark?: boolean;
}

function getContext(hour: number, hasCompletedRepsToday: boolean, streak: number, hasBenchmark: boolean) {
  if (!hasBenchmark && hour >= 9 && hour <= 21) {
    return {
      icon: <Target className="h-4 w-4" />,
      headline: 'Set your baseline today',
      subline: '10 scenarios · seeds your spider chart · takes 15 min',
      cta: 'Start Benchmark',
      route: '/benchmark',
      color: 'border-primary/30 bg-primary/5',
    };
  }

  if (hasCompletedRepsToday) {
    if (hour >= 9 && hour < 17) {
      return {
        icon: <Target className="h-4 w-4" />,
        headline: 'Reps done. Now apply them.',
        subline: 'Brief yourself before your next call',
        cta: 'Open Pre-Call Brief',
        route: '/brief',
        color: 'border-green-500/20 bg-green-500/5',
      };
    }
    if (hour >= 17) {
      return {
        icon: <TrendingUp className="h-4 w-4" />,
        headline: 'End of day — grade a call',
        subline: 'The pattern is fresh. One grade updates your drill queue.',
        cta: 'Grade a Call',
        route: '/coach',
        color: 'border-blue-500/20 bg-blue-500/5',
      };
    }
  }

  if (hour >= 5 && hour < 9) {
    return {
      icon: <Zap className="h-4 w-4" />,
      headline: streak === 0 ? 'Start your streak today' : `Day ${streak + 1} — protect it`,
      subline: '5 reps in the car. Enter to submit. No excuses.',
      cta: 'Start Quick Drill',
      route: '__micro__',
      color: 'border-primary/20 bg-primary/5',
    };
  }
  if (hour >= 9 && hour < 12) {
    return {
      icon: <Target className="h-4 w-4" />,
      headline: 'Brief yourself before calls',
      subline: 'Top plays for your call type. One warm-up rep.',
      cta: 'Open Pre-Call Brief',
      route: '/brief',
      color: 'border-amber-500/20 bg-amber-500/5',
    };
  }
  if (hour >= 12 && hour < 14) {
    return {
      icon: <BookOpen className="h-4 w-4" />,
      headline: 'Midday: one lesson',
      subline: 'Five minutes now. Compounds over 90 days.',
      cta: 'Open Courses',
      route: '/learn',
      color: 'border-green-500/20 bg-green-500/5',
    };
  }
  if (hour >= 14 && hour < 17) {
    return {
      icon: <TrendingUp className="h-4 w-4" />,
      headline: 'Afternoon — drill your weakest',
      subline: 'Open Skills to see your real call scores. Pick the lowest.',
      cta: 'Open Skills',
      route: '/skills',
      color: 'border-purple-500/20 bg-purple-500/5',
    };
  }
  if (hour >= 17 && hour < 20) {
    return {
      icon: <Zap className="h-4 w-4" />,
      headline: 'Grade a call tonight',
      subline: "The pattern is fresh. Tomorrow's drill queue updates from it.",
      cta: 'Open Coach',
      route: '/coach',
      color: 'border-blue-500/20 bg-blue-500/5',
    };
  }
  return {
    icon: <Target className="h-4 w-4" />,
    headline: 'Take your baseline benchmark',
    subline: '10 scenarios across all dimensions — seeds your spider chart',
    cta: 'Start Benchmark',
    route: '/benchmark',
    color: 'border-border',
  };
}

export function ProactiveDaveCard({ onMicroDrill, hasCompletedRepsToday = false, streak = 0, hasBenchmark = true }: ProactiveDaveCardProps) {
  const navigate = useNavigate();
  const hour = new Date().getHours();
  const ctx = useMemo(() => getContext(hour, hasCompletedRepsToday, streak, hasBenchmark), [hour, hasCompletedRepsToday, streak, hasBenchmark]);

  const handleCTA = () => {
    if (ctx.route === '__micro__') {
      onMicroDrill?.();
    } else {
      navigate(ctx.route);
    }
  };

  return (
    <Card className={ctx.color}>
      <CardContent className="p-3">
        <button onClick={handleCTA} className="w-full text-left">
          <div className="flex items-start gap-2.5">
            <div className="shrink-0 mt-0.5 text-foreground">{ctx.icon}</div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{ctx.headline}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{ctx.subline}</p>
              <p className="text-xs text-primary font-medium mt-1.5">{ctx.cta} →</p>
            </div>
          </div>
        </button>
      </CardContent>
    </Card>
  );
}

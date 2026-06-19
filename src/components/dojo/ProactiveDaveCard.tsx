import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Zap, BookOpen, TrendingUp, Target } from 'lucide-react';

interface TimeContext {
  icon: React.ReactNode;
  headline: string;
  subline: string;
  cta: string;
  route: string;
  color: string;
}

function getTimeContext(hour: number): TimeContext {
  if (hour >= 5 && hour < 9) {
    return {
      icon: <Zap className="h-4 w-4" />,
      headline: 'Morning warm-up time',
      subline: 'Start with 5 quick reps before your first call',
      cta: 'Start Quick Drill',
      route: '__micro__',
      color: 'border-primary/20 bg-primary/5',
    };
  }
  if (hour >= 9 && hour < 12) {
    return {
      icon: <Target className="h-4 w-4" />,
      headline: 'Brief yourself before calls',
      subline: 'Pull top plays for your call type before heading in',
      cta: 'Open Pre-Call Brief',
      route: '/brief',
      color: 'border-amber-500/20 bg-amber-500/5',
    };
  }
  if (hour >= 12 && hour < 14) {
    return {
      icon: <BookOpen className="h-4 w-4" />,
      headline: 'Midday: 5 minutes of learning',
      subline: 'One lesson now compounds over 90 days',
      cta: 'Open Courses',
      route: '/learn',
      color: 'border-green-500/20 bg-green-500/5',
    };
  }
  if (hour >= 14 && hour < 17) {
    return {
      icon: <TrendingUp className="h-4 w-4" />,
      headline: 'Afternoon review',
      subline: 'Check your coaching trends and drill your weakest category',
      cta: 'Open Coach',
      route: '/coach',
      color: 'border-purple-500/20 bg-purple-500/5',
    };
  }
  if (hour >= 17 && hour < 20) {
    return {
      icon: <Zap className="h-4 w-4" />,
      headline: 'End-of-day debrief',
      subline: 'Grade a call before tomorrow — the pattern is fresh now',
      cta: 'Open Coach',
      route: '/coach',
      color: 'border-blue-500/20 bg-blue-500/5',
    };
  }
  // Off hours
  return {
    icon: <Target className="h-4 w-4" />,
    headline: 'Take your baseline benchmark',
    subline: '10 scenarios across all dimensions — seeds your spider chart',
    cta: 'Start Benchmark',
    route: '/benchmark',
    color: 'border-border',
  };
}

interface ProactiveDaveCardProps {
  onMicroDrill?: () => void;
}

export function ProactiveDaveCard({ onMicroDrill }: ProactiveDaveCardProps) {
  const navigate = useNavigate();
  const hour = new Date().getHours();
  const ctx = useMemo(() => getTimeContext(hour), [hour]);

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

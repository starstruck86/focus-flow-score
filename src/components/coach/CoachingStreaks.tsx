import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flame, TrendingUp, Award, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAllTranscriptGrades } from '@/hooks/useTranscriptGrades';

const CATEGORY_LABELS: Record<string, string> = {
  structure: 'Structure',
  cotm: 'Command of Message',
  meddicc: 'MEDDICC',
  discovery: 'Discovery',
  presence: 'Presence',
  commercial: 'Commercial',
  next_step: 'Next Step',
};

interface CategoryStreak {
  category: string;
  label: string;
  currentStreak: number;
  bestStreak: number;
  improving: boolean;
  latestScore: number;
}

export function CoachingStreaks() {
  const { data: allGrades } = useAllTranscriptGrades();

  const streaks = useMemo(() => {
    if (!allGrades || allGrades.length < 2) return [];

    // Sort chronologically
    const sorted = [...allGrades].sort((a: any, b: any) => {
      const dA = a.call_transcripts?.call_date || a.created_at;
      const dB = b.call_transcripts?.call_date || b.created_at;
      return dA.localeCompare(dB);
    });

    const categories = ['structure', 'cotm', 'meddicc', 'discovery', 'presence', 'commercial', 'next_step'];

    return categories.map(cat => {
      const scores = sorted.map((g: any) => (g as any)[`${cat}_score`] || 0);

      // Calculate current improvement streak with tolerance for minor regression (1 point)
      const TOLERANCE = 1;
      let currentStreak = 0;
      for (let i = scores.length - 1; i > 0; i--) {
        if (scores[i] >= scores[i - 1] - TOLERANCE) {
          currentStreak++;
        } else {
          break;
        }
      }

      // Calculate best streak with same tolerance
      let bestStreak = 0;
      let streak = 0;
      for (let i = 1; i < scores.length; i++) {
        if (scores[i] >= scores[i - 1] - TOLERANCE) {
          streak++;
          bestStreak = Math.max(bestStreak, streak);
        } else {
          streak = 0;
        }
      }

      const improving = scores.length >= 2 && scores[scores.length - 1] > scores[scores.length - 2];

      return {
        category: cat,
        label: CATEGORY_LABELS[cat] || cat,
        currentStreak,
        bestStreak,
        improving,
        latestScore: scores[scores.length - 1],
      } as CategoryStreak;
    }).sort((a, b) => b.currentStreak - a.currentStreak);
  }, [allGrades]);

  const overallStreak = useMemo(() => {
    if (!allGrades || allGrades.length < 2) return 0;
    const sorted = [...allGrades].sort((a: any, b: any) => {
      const dA = a.call_transcripts?.call_date || a.created_at;
      const dB = b.call_transcripts?.call_date || b.created_at;
      return dA.localeCompare(dB);
    });
    let streak = 0;
    const TOLERANCE = 2; // Overall score tolerance slightly higher (out of 100)
    for (let i = sorted.length - 1; i > 0; i--) {
      if (sorted[i].overall_score >= sorted[i - 1].overall_score - TOLERANCE) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }, [allGrades]);

  if (streaks.length === 0) return null;

  const hasActiveStreaks = streaks.some(s => s.currentStreak >= 2);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flame className="h-4 w-4 text-grade-average" />
          Coaching Streaks
          {overallStreak >= 2 && (
            <Badge className="bg-grade-excellent/10 text-grade-excellent border-grade-excellent/20 text-[10px] gap-0.5">
              <Flame className="h-2.5 w-2.5" /> {overallStreak} call overall streak
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {streaks.map(s => (
          <div key={s.category} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{s.latestScore}/5</span>
            </div>
            <div className="flex items-center gap-2">
              {s.currentStreak >= 2 ? (
                <Badge variant="outline" className="text-[10px] gap-0.5 border-grade-excellent/30 text-grade-excellent">
                  <Flame className="h-2.5 w-2.5" /> {s.currentStreak}
                </Badge>
              ) : s.improving ? (
                <Badge variant="outline" className="text-[10px] gap-0.5 border-grade-good/30 text-grade-good">
                  <TrendingUp className="h-2.5 w-2.5" /> +1
                </Badge>
              ) : (
                <span className="text-[10px] text-muted-foreground">—</span>
              )}
              {s.bestStreak >= 3 && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Award className="h-2.5 w-2.5" /> best: {s.bestStreak}
                </span>
              )}
            </div>
          </div>
        ))}

        {!hasActiveStreaks && (
          <p className="text-[10px] text-muted-foreground italic pt-1">
            Maintain or improve a score across consecutive calls to build streaks
          </p>
        )}
      </CardContent>
    </Card>
  );
}

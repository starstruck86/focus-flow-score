/**
 * TRAIN v2 — Phase 1.5 A1 daily card.
 *
 * Read-only render of next-due curriculum picks. Each pick routes into
 * the existing TRAIN v2 atom or band-gate page, which already advances
 * user_competency via recordCompetencyRep. No writes here.
 */

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getNextDueCurriculum, type DailyLadderPick } from '@/lib/train/dailyLadder';
import { BAND_NAMES } from '@/types/train';
import { FocusSpokesChips } from './FocusSpokesChips';
import { ChevronRight, Flame, Sparkles, Target } from 'lucide-react';

const DAILY_GOAL = 3;

function Ring({ progress }: { progress: number }) {
  const size = 40;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, progress)));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold">
        {Math.round(progress * 100)}%
      </div>
    </div>
  );
}

function pretty(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function routeFor(p: DailyLadderPick): string {
  if (p.kind === 'drill' && p.conceptId) {
    return `/train/${p.spoke}/${p.topic}/atom/${p.conceptId}`;
  }
  return `/train/${p.spoke}/${p.topic}/gate/${p.band}`;
}

export function DailyLadderCard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: picks, isLoading } = useQuery<DailyLadderPick[]>({
    queryKey: ['train', 'daily-ladder', user?.id],
    enabled: !!user?.id,
    queryFn: () => getNextDueCurriculum(user!.id, 5),
    staleTime: 2 * 60 * 1000,
  });

  const list = picks ?? [];

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold uppercase tracking-wider">Today · Curriculum</h3>
          </div>
          <span className="text-[11px] text-muted-foreground">
            Goal: {DAILY_GOAL} drills
          </span>
        </div>

        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Focus</div>
          <FocusSpokesChips />
        </div>


        {isLoading && (
          <p className="text-xs text-muted-foreground">Loading next-due…</p>
        )}

        {!isLoading && list.length === 0 && (
          <div className="text-center py-4 space-y-2">
            <Sparkles className="h-6 w-6 mx-auto text-muted-foreground opacity-60" />
            <p className="text-sm text-muted-foreground">You're caught up — pick any spoke.</p>
            <Button size="sm" variant="outline" onClick={() => navigate('/train')}>
              Browse Train
            </Button>
          </div>
        )}

        {!isLoading && list.length > 0 && (
          <div className="space-y-2">
            {list.map((p) => (
              <button
                key={`${p.spoke}|${p.topic}|${p.subLevel}|${p.kind}|${p.conceptId ?? p.band}`}
                onClick={() => navigate(routeFor(p))}
                className="w-full text-left p-3 rounded-md border bg-card hover:border-primary/40 hover:shadow-sm transition-all flex items-center gap-3 group"
              >
                <Ring progress={p.progress} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                    <span>{pretty(p.spoke)}</span>
                    <span>·</span>
                    <span>{pretty(p.topic)}</span>
                    <span>·</span>
                    <span>B{p.band} · {p.subLevel}</span>
                    {p.kind !== 'drill' && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        {p.kind === 'retest' ? 'Retest' : 'Gate'}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-medium truncate">
                    {p.kind === 'drill' ? p.title : `${BAND_NAMES[p.band]} gate`}
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Target className="h-3 w-3" />
                    {p.reason}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

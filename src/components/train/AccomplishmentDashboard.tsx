/**
 * TRAIN v2 — Phase 2a accomplishment dashboard (READ-ONLY).
 *
 * Reads user_competency via useUserCompetencySummary() and renders a compact
 * mobile-first dashboard at the top of the Dojo home. No writes, no migrations.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { useUserCompetencySummary } from '@/lib/train/competencyRead';
import {
  SPOKE_DISPLAY_NAMES,
  SPOKE_DISPLAY_ORDER,
  spokeLabel,
} from '@/lib/train/catalog';

const DAILY_GOAL = 3;

function localDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Local-date key (YYYY-MM-DD in user's local TZ)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function Ring({ value, goal }: { value: number; goal: number }) {
  const size = 52;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, goal > 0 ? value / goal : 0));
  const off = c * (1 - pct);
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
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[11px] font-bold">{value}</span>
        <span className="text-[8px] text-muted-foreground">/ {goal}</span>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-md border bg-card px-2 py-2 text-center">
      <div className="text-base font-bold leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

export function AccomplishmentDashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useUserCompetencySummary();

  const rows = data?.rows ?? [];
  const totalReps = data?.totalReps ?? 0;
  const totalGatesPassed = data?.totalGatesPassed ?? 0;

  // (i) Active days = # of DISTINCT local-date values of updated_at across rows.
  const activeDays = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const k = localDateKey(r.updated_at);
      if (k) s.add(k);
    }
    return s.size;
  }, [rows]);

  // (ii) drillsToday = count of rows whose updated_at local date === today's local date.
  const drillsToday = useMemo(() => {
    const today = localDateKey(new Date().toISOString());
    if (!today) return 0;
    let n = 0;
    for (const r of rows) {
      if (localDateKey(r.updated_at) === today) n += 1;
    }
    return n;
  }, [rows]);

  // Topics in progress = DISTINCT (spoke|topic) where reps>0 OR (0<progress<1).
  const topicsInProgress = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const inProg = (Number(r.reps) || 0) > 0 || (Number(r.progress) > 0 && Number(r.progress) < 1);
      if (inProg) s.add(`${r.spoke}|${r.topic}`);
    }
    return s.size;
  }, [rows]);

  // (iii) Per-spoke pct = Math.round(avg(progress) * 100) over that spoke's rows.
  const perSpoke = useMemo(() => {
    const bySpoke = new Map<string, number[]>();
    for (const r of rows) {
      if (!bySpoke.has(r.spoke)) bySpoke.set(r.spoke, []);
      bySpoke.get(r.spoke)!.push(Number(r.progress) || 0);
    }
    const allSpokes = Array.from(
      new Set<string>([...SPOKE_DISPLAY_ORDER, ...Object.keys(SPOKE_DISPLAY_NAMES)])
    );
    // Preserve SPOKE_DISPLAY_ORDER; unknowns appended alphabetically.
    allSpokes.sort((a, b) => {
      const ai = SPOKE_DISPLAY_ORDER.indexOf(a);
      const bi = SPOKE_DISPLAY_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return allSpokes.map((spoke) => {
      const arr = bySpoke.get(spoke) ?? [];
      const pct = arr.length
        ? Math.round((arr.reduce((a, c) => a + c, 0) / arr.length) * 100)
        : 0;
      return { spoke, pct };
    });
  }, [rows]);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider">Your Training</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Active days: {activeDays}
            </p>
          </div>
          <Ring value={drillsToday} goal={DAILY_GOAL} />
        </div>

        <div className="flex gap-2">
          <StatTile label="Drills" value={totalReps} />
          <StatTile label="Gates passed" value={totalGatesPassed} />
          <StatTile label="Topics in progress" value={topicsInProgress} />
        </div>

        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground pt-1">
          <span>Spokes</span>
          <span>{drillsToday} / {DAILY_GOAL} today</span>
        </div>

        <div className="space-y-1.5">
          {perSpoke.map(({ spoke, pct }) => (
            <button
              key={spoke}
              onClick={() => navigate(`/train/${spoke}`)}
              className="w-full text-left flex items-center gap-2 group"
            >
              <span className="text-[11px] font-medium w-32 truncate group-hover:text-primary transition-colors">
                {spokeLabel(spoke)}
              </span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
                {pct}%
              </span>
            </button>
          ))}
        </div>

        {!isLoading && totalReps === 0 && (
          <div className="pt-1">
            <button
              onClick={() => navigate('/train')}
              className="text-[11px] text-primary hover:underline"
            >
              Run a drill to start filling your map →
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

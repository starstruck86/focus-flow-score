/**
 * Corpus Coverage — honest factory-backlog readout on the Train / Skills tab.
 *
 * Reads live from the same tables that back the curriculum:
 *   knowledge_items · curriculum_concepts · ki_curriculum
 *   flashcards · flashcard_decks · curriculum_gates · user_band_gate
 *
 * Design register (§8): quiet, list-like, jade/train accent, no shame-UI.
 * Where a denominator is unknowable (KIs → concepts), we show raw counts,
 * NOT invented percentages.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Layers } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const JADE = 'hsl(var(--brand-train))';

interface Counts {
  kis: number;
  concepts: number;
  teachScripts: number;
  drillRefs: number;
  decks: number;
  flashcards: number;
  gatesDefined: number;
  gatesPassed: number;
}

async function loadCounts(userId: string | undefined): Promise<Counts> {
  const head = { count: 'exact' as const, head: true };
  const [kis, concepts, teach, drills, decks, cards, gates, passed] = await Promise.all([
    (supabase as any).from('knowledge_items').select('*', head),
    (supabase as any).from('curriculum_concepts').select('*', head),
    (supabase as any).from('curriculum_concepts').select('*', head).not('teach_beat_md', 'is', null),
    (supabase as any).from('ki_curriculum').select('*', head).eq('role', 'drill'),
    (supabase as any).from('flashcard_decks').select('*', head),
    (supabase as any).from('flashcards').select('*', head),
    (supabase as any).from('curriculum_gates').select('*', head),
    userId
      ? (supabase as any).from('user_band_gate').select('*', head).eq('user_id', userId).eq('status', 'passed')
      : Promise.resolve({ count: 0 }),
  ]);
  return {
    kis: kis.count ?? 0,
    concepts: concepts.count ?? 0,
    teachScripts: teach.count ?? 0,
    drillRefs: drills.count ?? 0,
    decks: decks.count ?? 0,
    flashcards: cards.count ?? 0,
    gatesDefined: gates.count ?? 0,
    gatesPassed: passed.count ?? 0,
  };
}

function Row({
  label,
  value,
  sub,
  pct,
}: {
  label: string;
  value: string;
  sub?: string;
  pct?: number;
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium tabular-nums">{value}</span>
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      {pct != null && (
        <div className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: JADE }}
          />
        </div>
      )}
    </div>
  );
}

export function CorpusCoverageCard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['corpus-coverage', user?.id ?? 'anon'],
    queryFn: () => loadCounts(user?.id),
    staleTime: 5 * 60_000,
  });

  return (
    <section className="max-w-2xl mx-auto px-4 pb-4">
      <Card className="p-4" style={{ borderColor: `${JADE}33` }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5" style={{ color: JADE }} />
            <h3 className="text-sm font-semibold">Corpus coverage</h3>
          </div>
          <Link
            to="/ki-library"
            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
          >
            Library <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <p className="text-[11px] text-muted-foreground mb-2">
          Growing spine. KIs become concepts; concepts get teach scripts, drills, decks, gates.
        </p>

        {isLoading || !data ? (
          <div className="text-xs text-muted-foreground py-2">Loading counts…</div>
        ) : (
          <div className="divide-y divide-border">
            <Row label="KIs in library" value={data.kis.toLocaleString()} sub="Raw knowledge items — no fixed target" />
            <Row label="Concepts in curriculum" value={data.concepts.toLocaleString()} sub="Mapped from KIs into teach/drill/gate roles" />
            <Row
              label="Teach scripts authored"
              value={`${data.teachScripts} / ${data.concepts}`}
              pct={data.concepts ? (data.teachScripts / data.concepts) * 100 : 0}
            />
            <Row label="Drill references" value={data.drillRefs.toLocaleString()} sub="ki_curriculum rows in drill role" />
            <Row
              label="Flash decks built"
              value={`${data.decks}`}
              sub={`${data.flashcards.toLocaleString()} cards across all decks`}
            />
            <Row
              label="Gates passed"
              value={`${data.gatesPassed} / ${data.gatesDefined}`}
              pct={data.gatesDefined ? (data.gatesPassed / data.gatesDefined) * 100 : 0}
            />
          </div>
        )}
      </Card>
    </section>
  );
}

export default CorpusCoverageCard;

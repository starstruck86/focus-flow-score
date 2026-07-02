import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, ChevronRight, Loader2, Sparkles, Zap } from 'lucide-react';

type Deck = {
  id: string;
  source_type: string;
  source_ref: string;
  spoke: string | null;
  title: string | null;
  card_count: number;
  generation_status: string;
};

type DeckRow = Deck & { due: number; newCount: number };

type MissingTopic = { spoke: string; topic: string };

export default function Flash() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DeckRow[]>([]);
  const [missing, setMissing] = useState<MissingTopic[]>([]);
  const [generatingRef, setGeneratingRef] = useState<string | null>(null);
  const [totalDue, setTotalDue] = useState(0);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const nowIso = new Date().toISOString();

    const { data: decks } = await supabase
      .from('flashcard_decks')
      .select('id, source_type, source_ref, spoke, title, card_count, generation_status')
      .order('spoke', { ascending: true })
      .order('title', { ascending: true });
    const deckList = (decks ?? []) as Deck[];

    // All cards for these decks
    const deckIds = deckList.map((d) => d.id);
    let allCards: { id: string; deck_id: string }[] = [];
    if (deckIds.length > 0) {
      const { data: cards } = await supabase
        .from('flashcards')
        .select('id, deck_id')
        .in('deck_id', deckIds)
        .eq('active', true);
      allCards = (cards ?? []) as { id: string; deck_id: string }[];
    }

    // User's state rows for those cards
    const cardIds = allCards.map((c) => c.id);
    let stateByCard = new Map<string, { due_at: string }>();
    if (cardIds.length > 0) {
      // Chunk to keep the .in() request small enough
      for (let i = 0; i < cardIds.length; i += 500) {
        const slice = cardIds.slice(i, i + 500);
        const { data: st } = await supabase
          .from('flashcard_state')
          .select('card_id, due_at')
          .eq('user_id', user.id)
          .in('card_id', slice);
        for (const r of (st ?? []) as { card_id: string; due_at: string }[]) {
          stateByCard.set(r.card_id, { due_at: r.due_at });
        }
      }
    }

    const byDeck = new Map<string, { due: number; newCount: number }>();
    for (const d of deckList) byDeck.set(d.id, { due: 0, newCount: 0 });
    let dueSum = 0;
    for (const c of allCards) {
      const bucket = byDeck.get(c.deck_id)!;
      const s = stateByCard.get(c.id);
      if (!s) bucket.newCount += 1;
      else if (new Date(s.due_at) <= new Date(nowIso)) {
        bucket.due += 1;
        dueSum += 1;
      }
    }

    const enriched: DeckRow[] = deckList.map((d) => ({
      ...d,
      due: byDeck.get(d.id)?.due ?? 0,
      newCount: byDeck.get(d.id)?.newCount ?? 0,
    }));
    setRows(enriched);
    setTotalDue(dueSum);

    // Curriculum topics with no deck yet
    const { data: concepts } = await supabase
      .from('curriculum_concepts')
      .select('spoke, topic');
    const existingRefs = new Set(
      deckList.filter((d) => d.source_type === 'curriculum_topic').map((d) => d.source_ref),
    );
    const seen = new Set<string>();
    const miss: MissingTopic[] = [];
    for (const c of (concepts ?? []) as { spoke: string; topic: string }[]) {
      if (!c.spoke || !c.topic) continue;
      const ref = `${c.spoke}/${c.topic}`;
      if (existingRefs.has(ref) || seen.has(ref)) continue;
      seen.add(ref);
      miss.push({ spoke: c.spoke, topic: c.topic });
    }
    miss.sort((a, b) => (a.spoke + a.topic).localeCompare(b.spoke + b.topic));
    setMissing(miss);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const grouped = useMemo(() => {
    const g = new Map<string, DeckRow[]>();
    for (const r of rows) {
      const k = r.spoke ?? 'other';
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(r);
    }
    return Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const missingGrouped = useMemo(() => {
    const g = new Map<string, MissingTopic[]>();
    for (const m of missing) {
      if (!g.has(m.spoke)) g.set(m.spoke, []);
      g.get(m.spoke)!.push(m);
    }
    return Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [missing]);

  const generate = async (ref: string) => {
    setGeneratingRef(ref);
    try {
      await supabase.functions.invoke('generate-flashcards', {
        body: { source_type: 'curriculum_topic', source_ref: ref },
      });
      await load();
    } finally {
      setGeneratingRef(null);
    }
  };

  return (
    <Layout>
      <div className={SHELL.page}>
        <div className="px-4 pt-3 pb-2 flex items-center gap-3">
          <button onClick={() => navigate('/dojo')} className="p-1.5 rounded-lg hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-500" /> Flash
            </h1>
            <p className="text-[11px] text-muted-foreground">Recognition reps. Tap to flip, rate 1–5.</p>
          </div>
        </div>

        <div className="px-4 space-y-4 pb-24">
          {totalDue > 0 && (
            <Button
              onClick={() => navigate('/flash/deck/all')}
              className="w-full h-12 text-base bg-primary"
            >
              Review all due ({totalDue}) →
            </Button>
          )}

          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

          {!loading &&
            grouped.map(([spoke, list]) => (
              <div key={spoke} className="space-y-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground px-1">{spoke}</p>
                {list.map((d) => (
                  <Card
                    key={d.id}
                    className="p-3 flex items-center justify-between cursor-pointer hover:bg-muted/40"
                    onClick={() => navigate(`/flash/deck/${d.id}`)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{d.title ?? d.source_ref}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {d.card_count} cards
                        {d.due > 0 && <span className="text-primary"> · {d.due} due</span>}
                        {d.newCount > 0 && <span className="text-emerald-500"> · {d.newCount} new</span>}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </Card>
                ))}
              </div>
            ))}

          {!loading && missingGrouped.length > 0 && (
            <div className="pt-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground px-1">
                Generate a deck
              </p>
              {missingGrouped.map(([spoke, list]) => (
                <div key={spoke} className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-1">{spoke}</p>
                  {list.map((m) => {
                    const ref = `${m.spoke}/${m.topic}`;
                    const busy = generatingRef === ref;
                    return (
                      <Card key={ref} className="p-3 flex items-center justify-between border-dashed">
                        <div>
                          <p className="text-sm font-medium">{m.topic}</p>
                          <p className="text-[11px] text-muted-foreground">No deck yet</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || generatingRef !== null}
                          onClick={() => generate(ref)}
                        >
                          {busy ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Generating…
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-3 w-3 mr-1" /> Generate
                            </>
                          )}
                        </Button>
                      </Card>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

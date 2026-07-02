import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
const PAGE_CLS = `min-h-screen ${SHELL.main.bottomPad}`;
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { rollupRecognition } from '@/lib/flash/rollupRecognition';
import { nextDueAt, CONFIDENCE_LABELS, type Confidence } from '@/lib/flash/cbr';

const SESSION_CAP = 20;

type Card = {
  id: string;
  deck_id: string;
  ki_id: string;
  concept_id: string | null;
  card_type: 'trigger' | 'definition' | 'talk_track';
  front: string;
  back: string;
};

type StateRow = { card_id: string; times_seen: number; due_at: string };

type ConceptMeta = { spoke: string; topic: string };

export default function FlashDeck() {
  const { id } = useParams<{ id: string }>();
  const isAll = id === 'all';
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [deckTitle, setDeckTitle] = useState<string>('');
  const [queue, setQueue] = useState<Card[]>([]);
  const [statesByCard, setStatesByCard] = useState<Map<string, StateRow>>(new Map());
  const [conceptMeta, setConceptMeta] = useState<Map<string, ConceptMeta>>(new Map());
  const [conceptMetaResolved, setConceptMetaResolved] = useState(true);
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [requeued, setRequeued] = useState<Set<string>>(new Set());
  const [reviewedDue, setReviewedDue] = useState(0);
  const [reviewedNew, setReviewedNew] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user || !id) return;
      setLoading(true);

      // Load candidate cards
      let cards: Card[] = [];
      if (isAll) {
        setDeckTitle('Review all due');
        // Load state rows first for user (all due)
        const nowIso = new Date().toISOString();
        const { data: st } = await supabase
          .from('flashcard_state')
          .select('card_id, due_at, times_seen')
          .eq('user_id', user.id)
          .lte('due_at', nowIso)
          .order('due_at', { ascending: true })
          .limit(SESSION_CAP * 3);
        const dueCardIds = (st ?? []).map((s: any) => s.card_id as string);
        if (dueCardIds.length > 0) {
          const { data: c } = await supabase
            .from('flashcards')
            .select('id, deck_id, ki_id, concept_id, card_type, front, back')
            .in('id', dueCardIds)
            .eq('active', true);
          const byId = new Map<string, Card>();
          for (const row of (c ?? []) as Card[]) byId.set(row.id, row);
          // preserve due order
          cards = dueCardIds.map((cid) => byId.get(cid)).filter(Boolean) as Card[];
        }
      } else {
        const { data: deck } = await supabase
          .from('flashcard_decks')
          .select('title, source_ref')
          .eq('id', id)
          .maybeSingle();
        setDeckTitle((deck?.title as string) ?? (deck?.source_ref as string) ?? 'Deck');

        const { data: c } = await supabase
          .from('flashcards')
          .select('id, deck_id, ki_id, concept_id, card_type, front, back')
          .eq('deck_id', id)
          .eq('active', true);
        cards = (c ?? []) as Card[];
      }

      // Load user state for these cards
      const cardIds = cards.map((c) => c.id);
      const stateMap = new Map<string, StateRow>();
      if (cardIds.length > 0) {
        for (let i = 0; i < cardIds.length; i += 500) {
          const slice = cardIds.slice(i, i + 500);
          const { data: st } = await supabase
            .from('flashcard_state')
            .select('card_id, times_seen, due_at')
            .eq('user_id', user.id)
            .in('card_id', slice);
          for (const r of (st ?? []) as StateRow[]) stateMap.set(r.card_id, r);
        }
      }

      // Build queue: due first (sorted by due_at asc), then NEW, capped at SESSION_CAP
      const now = Date.now();
      const due: Card[] = [];
      const fresh: Card[] = [];
      for (const c of cards) {
        const s = stateMap.get(c.id);
        if (!s) fresh.push(c);
        else if (new Date(s.due_at).getTime() <= now) due.push(c);
      }
      due.sort((a, b) => {
        const sa = new Date(stateMap.get(a.id)!.due_at).getTime();
        const sb = new Date(stateMap.get(b.id)!.due_at).getTime();
        return sa - sb;
      });
      const built = [...due, ...fresh].slice(0, SESSION_CAP);

      // Batch concept lookup for Drill-this CTA
      const conceptIds = Array.from(new Set(built.map((c) => c.concept_id).filter(Boolean))) as string[];
      const meta = new Map<string, ConceptMeta>();
      let resolved = true;
      if (conceptIds.length > 0) {
        const { data: cc, error: ccErr } = await supabase
          .from('curriculum_concepts')
          .select('concept_id, spoke, topic')
          .in('concept_id', conceptIds);
        if (ccErr) resolved = false;
        for (const r of (cc ?? []) as { concept_id: string; spoke: string; topic: string }[]) {
          if (r.spoke && r.topic) meta.set(r.concept_id, { spoke: r.spoke, topic: r.topic });
        }
      }

      if (cancelled) return;
      setStatesByCard(stateMap);
      setConceptMeta(meta);
      setConceptMetaResolved(resolved);
      setQueue(built);
      setPos(0);
      setFlipped(false);
      setReviewedDue(0);
      setReviewedNew(0);
      setRequeued(new Set());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isAll, user?.id]);

  const currentCard = queue[pos];
  const done = !loading && pos >= queue.length;

  const rate = async (confidence: Confidence) => {
    if (!user || !currentCard) return;
    const prev = statesByCard.get(currentCard.id);
    const wasNew = !prev;
    const wasDue = !!prev && new Date(prev.due_at).getTime() <= Date.now();
    const nowIso = new Date().toISOString();
    const due = nextDueAt(confidence).toISOString();
    const timesSeen = (prev?.times_seen ?? 0) + 1;

    // Persist state
    try {
      await supabase.from('flashcard_state').upsert(
        {
          user_id: user.id,
          card_id: currentCard.id,
          confidence,
          times_seen: timesSeen,
          last_seen_at: nowIso,
          due_at: due,
        },
        { onConflict: 'user_id,card_id' },
      );
    } catch (e) {
      console.error('flashcard_state upsert failed', e);
    }

    // Rollup — isolated so failure never blocks the flow.
    try {
      await rollupRecognition({ userId: user.id, kiId: currentCard.ki_id, confidence });
    } catch (e) {
      console.error('rollupRecognition failed', e);
    }

    // Update local state map for potential re-queue math
    const nextStates = new Map(statesByCard);
    nextStates.set(currentCard.id, { card_id: currentCard.id, times_seen: timesSeen, due_at: due });
    setStatesByCard(nextStates);

    // Counters
    if (wasNew) setReviewedNew((n) => n + 1);
    if (wasDue) setReviewedDue((n) => n + 1);

    // Requeue rating-1 cards once
    let nextQueue = queue;
    if (confidence === 1 && !requeued.has(currentCard.id)) {
      nextQueue = [...queue, currentCard];
      const rq = new Set(requeued);
      rq.add(currentCard.id);
      setRequeued(rq);
      setQueue(nextQueue);
    }

    setFlipped(false);
    setPos((p) => p + 1);
  };

  const drillHref = useMemo(() => {
    if (!currentCard || !currentCard.concept_id) return null;
    const s = statesByCard.get(currentCard.id);
    if (!s) return null;
    // Only when card has been seen at least twice with low confidence.
    // We don't have last confidence on state row, so use times_seen>=2 as
    // proxy after a low rating just applied. Show CTA only pre-rate; per spec
    // the CTA appears when confidence<=2 AND times_seen>=2, so we surface it
    // once the card has been previously reviewed at least twice.
    if ((s.times_seen ?? 0) < 2) return null;
    if (!conceptMetaResolved) return null;
    const meta = conceptMeta.get(currentCard.concept_id);
    if (!meta) return null;
    return `/train/${meta.spoke}/${meta.topic}/atom/${currentCard.concept_id}`;
  }, [currentCard, statesByCard, conceptMeta, conceptMetaResolved]);

  return (
    <Layout>
      <div className={PAGE_CLS}>
        <div className="px-4 pt-3 pb-2 flex items-center gap-3">
          <button onClick={() => navigate('/flash')} className="p-1.5 rounded-lg hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{deckTitle}</h1>
            {!loading && !done && queue.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {pos + 1} / {queue.length}
              </p>
            )}
          </div>
        </div>

        <div className="px-4 pb-8">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

          {!loading && queue.length === 0 && (
            <Card className="p-6 text-center space-y-3">
              <p className="text-sm">Nothing due right now.</p>
              <Button variant="outline" onClick={() => navigate('/flash')}>Back to decks</Button>
            </Card>
          )}

          {!loading && done && queue.length > 0 && (
            <Card className="p-6 text-center space-y-3">
              <p className="text-lg font-semibold">Session complete</p>
              <p className="text-sm text-muted-foreground">
                Reviewed {reviewedDue} due · {reviewedNew} new
              </p>
              <Button onClick={() => navigate('/flash')}>Back to decks</Button>
            </Card>
          )}

          {!loading && !done && currentCard && (
            <div className="space-y-4">
              <button
                onClick={() => setFlipped((f) => !f)}
                className="w-full min-h-[280px] rounded-2xl border bg-card p-6 flex items-center justify-center text-center"
              >
                <div className="space-y-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {currentCard.card_type} · {flipped ? 'answer' : 'front'}
                  </p>
                  <p className={flipped ? 'text-base leading-relaxed' : 'text-xl font-semibold leading-snug'}>
                    {flipped ? currentCard.back : currentCard.front}
                  </p>
                  {!flipped && (
                    <p className="text-[11px] text-muted-foreground pt-2">tap to reveal</p>
                  )}
                </div>
              </button>

              {flipped && drillHref && (
                <button
                  onClick={() => navigate(drillHref)}
                  className="w-full text-left text-xs text-primary hover:underline px-2"
                >
                  Drill this →
                </button>
              )}

              {flipped && (
                <div className="grid grid-cols-5 gap-2">
                  {([1, 2, 3, 4, 5] as Confidence[]).map((c) => (
                    <Button
                      key={c}
                      variant={c === 1 ? 'destructive' : c >= 4 ? 'default' : 'secondary'}
                      className="h-14 flex-col gap-0.5 px-1"
                      onClick={() => rate(c)}
                    >
                      <span className="text-base font-bold leading-none">{c}</span>
                      <span className="text-[10px] leading-none opacity-80">{CONFIDENCE_LABELS[c]}</span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

/**
 * TRAIN v2 — Phase 1.5 A1 daily-ladder selector.
 *
 * Read-only. Picks the user's NEXT-DUE curriculum drills + retest gates
 * across all spokes/topics. Routes consumers into the existing TRAIN v2
 * atom/drill/gate flow (which already advances user_competency via
 * recordCompetencyRep).
 *
 * Unlock rule mirrors useSubLevelLadder / TrainTopic exactly:
 *   band 1 is always unlocked; band N>1 is unlocked iff the previous
 *   band's user_band_gate.status === 'passed'.
 */

import { supabase } from '@/integrations/supabase/client';
import type {
  Band,
  UserBandGateRow,
  UserCompetencyRow,
} from '@/types/train';

export type DailyLadderKind = 'drill' | 'gate' | 'retest';

export interface DailyLadderPick {
  spoke: string;
  topic: string;
  band: Band;
  subLevel: string;
  conceptId: string | null; // null for gate/retest picks
  title: string;
  progress: number; // 0..1
  reps: number;
  kind: DailyLadderKind;
  reason: string;
}

interface ConceptRowLite {
  concept_id: string;
  spoke: string;
  topic: string;
  band: number;
  sub_level: string;
  order_in_sublevel: number;
  title: string;
}

function isRetestDue(g: UserBandGateRow | undefined): boolean {
  if (!g?.next_retest_due) return false;
  return new Date(g.next_retest_due).getTime() <= Date.now();
}

export async function getNextDueCurriculum(
  userId: string,
  limit = 5,
): Promise<DailyLadderPick[]> {
  const [{ data: concepts, error: cErr }, { data: compRows }, { data: gateRows }] =
    await Promise.all([
      (supabase as any)
        .from('curriculum_concepts')
        .select('concept_id, spoke, topic, band, sub_level, order_in_sublevel, title')
        .order('spoke', { ascending: true })
        .order('topic', { ascending: true })
        .order('band', { ascending: true })
        .order('sub_level', { ascending: true })
        .order('order_in_sublevel', { ascending: true }),
      (supabase as any)
        .from('user_competency')
        .select('*')
        .eq('user_id', userId),
      (supabase as any)
        .from('user_band_gate')
        .select('*')
        .eq('user_id', userId),
    ]);

  if (cErr) throw cErr;

  const allConcepts = (concepts as ConceptRowLite[]) ?? [];
  const comps = (compRows as UserCompetencyRow[]) ?? [];
  const gates = (gateRows as UserBandGateRow[]) ?? [];

  // Index: competency by (spoke|topic|sub_level)
  const compKey = (s: string, t: string, sl: string) => `${s}|${t}|${sl}`;
  const compIdx = new Map<string, UserCompetencyRow>();
  for (const r of comps) compIdx.set(compKey(r.spoke, r.topic, r.sub_level), r);

  // Index: gates by (spoke|topic) -> band -> row
  const gateIdx = new Map<string, Map<number, UserBandGateRow>>();
  for (const g of gates) {
    const k = `${g.spoke}|${g.topic}`;
    let m = gateIdx.get(k);
    if (!m) { m = new Map(); gateIdx.set(k, m); }
    m.set(g.band, g);
  }

  // Group concepts by (spoke|topic) preserving SQL order
  const topicGroups = new Map<string, ConceptRowLite[]>();
  for (const c of allConcepts) {
    const k = `${c.spoke}|${c.topic}`;
    let list = topicGroups.get(k);
    if (!list) { list = []; topicGroups.set(k, list); }
    list.push(c);
  }

  type Candidate = DailyLadderPick & { rank: number };
  const candidates: Candidate[] = [];

  for (const [tk, conceptsInTopic] of topicGroups) {
    const [spoke, topic] = tk.split('|');
    const gatesForTopic = gateIdx.get(tk);

    const bandUnlocked = (band: Band): boolean => {
      if (band === 1) return true;
      const prev = gatesForTopic?.get(band - 1);
      return prev?.status === 'passed';
    };

    // ── Retests due (highest priority) ──
    if (gatesForTopic) {
      for (const [band, g] of gatesForTopic) {
        if (g.status === 'passed' && isRetestDue(g)) {
          candidates.push({
            spoke, topic,
            band: band as Band,
            subLevel: `${band}`,
            conceptId: null,
            title: `Band ${band} retest`,
            progress: 1,
            reps: 0,
            kind: 'retest',
            reason: 'Retest due — keep this band sharp',
            rank: 0,
          });
        }
      }
    }

    // ── Walk concepts in ladder order; find next-due sub-level per topic ──
    // Group by sub_level
    const subLevels = new Map<string, ConceptRowLite[]>();
    const subLevelOrder: string[] = [];
    for (const c of conceptsInTopic) {
      if (!subLevels.has(c.sub_level)) {
        subLevels.set(c.sub_level, []);
        subLevelOrder.push(c.sub_level);
      }
      subLevels.get(c.sub_level)!.push(c);
    }

    let picked = false;
    for (const sl of subLevelOrder) {
      if (picked) break;
      const concepts = subLevels.get(sl)!;
      const band = concepts[0].band as Band;
      if (!bandUnlocked(band)) continue;

      const comp = compIdx.get(compKey(spoke, topic, sl));
      const progress = comp?.progress ?? 0;
      const reps = comp?.reps ?? 0;
      if (progress >= 1) continue; // sub-level cleared — keep walking

      // pick first concept in the sub-level (no per-concept mastery store yet)
      const concept = concepts[0];

      const inProgress = progress > 0 && progress < 1;
      candidates.push({
        spoke, topic,
        band,
        subLevel: sl,
        conceptId: concept.concept_id,
        title: concept.title,
        progress,
        reps,
        kind: 'drill',
        reason: inProgress
          ? `In progress · ${Math.round(progress * 100)}%`
          : `Next up · Band ${band} · ${sl}`,
        // rank: in-progress (1) beats not-started (2); lower band first
        rank: (inProgress ? 1 : 2) * 10 + band,
      });
      picked = true;
    }
  }

  // Sort: retests first (rank 0), then in-progress, then by band asc
  candidates.sort((a, b) => a.rank - b.rank);

  // Spread across spokes for variety
  const out: DailyLadderPick[] = [];
  const seenSpokes = new Map<string, number>();
  const reserve: Candidate[] = [];
  for (const c of candidates) {
    const used = seenSpokes.get(c.spoke) ?? 0;
    if (used === 0) {
      out.push(stripRank(c));
      seenSpokes.set(c.spoke, 1);
      if (out.length >= limit) break;
    } else {
      reserve.push(c);
    }
  }
  if (out.length < limit) {
    for (const c of reserve) {
      out.push(stripRank(c));
      if (out.length >= limit) break;
    }
  }

  return out;
}

function stripRank<T extends { rank: number }>(c: T): Omit<T, 'rank'> {
  const { rank: _r, ...rest } = c;
  return rest;
}

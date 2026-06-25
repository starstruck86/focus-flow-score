/**
 * TRAIN v2 — Stage D curriculum reads.
 * Source of truth: ki_curriculum_full (ordered view) + curriculum_concepts + curriculum_gates.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  TRAIN_TUNABLES,
  type Band,
  type BandGateRow,
  type ConceptRow,
  type ConceptWithItems,
  type CurriculumKi,
  type SubLevelGroup,
} from '@/types/train';

type AnyRow = Record<string, unknown>;

const KI_COLS =
  'id, title, tactic_summary, example_usage, when_to_use, when_not_to_use, why_it_matters, spider_dimension, chapter';

function asBand(n: unknown): Band {
  const v = Number(n);
  if (v >= 1 && v <= 5) return v as Band;
  return 1;
}

function hydrateKi(
  ref: { ki_id: string; role: string; is_exemplar: boolean; order_in_concept: number; active?: boolean },
  ki: AnyRow | undefined,
): CurriculumKi | null {
  if (!ki) return null;
  return {
    ki_id: ref.ki_id,
    role: (ref.role as CurriculumKi['role']) ?? 'drill',
    is_exemplar: !!ref.is_exemplar,
    order_in_concept: Number(ref.order_in_concept) || 0,
    active: ref.active !== false,
    title: String(ki.title ?? ''),
    tactic_summary: (ki.tactic_summary as string | null) ?? null,
    example_usage: (ki.example_usage as string | null) ?? null,
    when_to_use: (ki.when_to_use as string | null) ?? null,
    when_not_to_use: (ki.when_not_to_use as string | null) ?? null,
    why_it_matters: (ki.why_it_matters as string | null) ?? null,
    spider_dimension: (ki.spider_dimension as string | null) ?? null,
    chapter: (ki.chapter as string | null) ?? null,
  };
}

/** All sub-levels for a topic, grouped, in ladder order. */
export async function getSubLevels(spoke: string, topic: string): Promise<SubLevelGroup[]> {
  const { data, error } = await (supabase as any)
    .from('curriculum_concepts')
    .select('*')
    .eq('spoke', spoke)
    .eq('topic', topic)
    .order('band', { ascending: true })
    .order('sub_level', { ascending: true })
    .order('order_in_sublevel', { ascending: true });

  if (error) throw error;

  const groups = new Map<string, SubLevelGroup>();
  for (const raw of (data as AnyRow[]) ?? []) {
    const c: ConceptRow = {
      concept_id: String(raw.concept_id),
      spoke: String(raw.spoke),
      topic: String(raw.topic),
      band: asBand(raw.band),
      sub_level: String(raw.sub_level),
      order_in_sublevel: Number(raw.order_in_sublevel) || 0,
      title: String(raw.title ?? ''),
      teach_kind: (raw.teach_kind as ConceptRow['teach_kind']) ?? 'ki_exemplar',
      exemplar_ki_id: (raw.exemplar_ki_id as string | null) ?? null,
      teach_beat_status: (raw.teach_beat_status as ConceptRow['teach_beat_status']) ?? 'pending',
      teach_beat_ref: (raw.teach_beat_ref as string | null) ?? null,
      notes: (raw.notes as string | null) ?? null,
    };
    const key = `${c.band}::${c.sub_level}`;
    if (!groups.has(key)) {
      groups.set(key, { sub_level: c.sub_level, band: c.band, concepts: [] });
    }
    groups.get(key)!.concepts.push(c);
  }
  return Array.from(groups.values());
}

/** One concept hydrated with its teach surface + capped drills. */
export async function getConceptWithItems(
  conceptId: string,
  opts: { drillCap?: number } = {},
): Promise<ConceptWithItems | null> {
  const cap = opts.drillCap ?? TRAIN_TUNABLES.drillsPerRepCap;

  const [{ data: conceptData, error: cErr }, { data: linkData, error: lErr }] = await Promise.all([
    (supabase as any).from('curriculum_concepts').select('*').eq('concept_id', conceptId).maybeSingle(),
    (supabase as any)
      .from('ki_curriculum')
      .select('ki_id, role, is_exemplar, order_in_concept, active')
      .eq('concept_id', conceptId)
      .eq('active', true)
      .order('order_in_concept', { ascending: true }),
  ]);
  if (cErr) throw cErr;
  if (lErr) throw lErr;
  if (!conceptData) return null;

  const concept: ConceptRow = {
    concept_id: String(conceptData.concept_id),
    spoke: String(conceptData.spoke),
    topic: String(conceptData.topic),
    band: asBand(conceptData.band),
    sub_level: String(conceptData.sub_level),
    order_in_sublevel: Number(conceptData.order_in_sublevel) || 0,
    title: String(conceptData.title ?? ''),
    teach_kind: (conceptData.teach_kind as ConceptRow['teach_kind']) ?? 'ki_exemplar',
    exemplar_ki_id: (conceptData.exemplar_ki_id as string | null) ?? null,
    teach_beat_status: (conceptData.teach_beat_status as ConceptRow['teach_beat_status']) ?? 'pending',
    teach_beat_ref: (conceptData.teach_beat_ref as string | null) ?? null,
    notes: (conceptData.notes as string | null) ?? null,
  };

  const links = (linkData as AnyRow[]) ?? [];
  const kiIds = links.map((l) => String(l.ki_id));

  let kiMap = new Map<string, AnyRow>();
  if (kiIds.length) {
    const { data: kiRows, error: kErr } = await (supabase as any)
      .from('knowledge_items')
      .select(KI_COLS)
      .in('id', kiIds);
    if (kErr) throw kErr;
    kiMap = new Map((kiRows ?? []).map((r: AnyRow) => [String(r.id), r]));
  }

  const hydrated: CurriculumKi[] = links
    .map((l) =>
      hydrateKi(
        {
          ki_id: String(l.ki_id),
          role: String(l.role ?? 'drill'),
          is_exemplar: !!l.is_exemplar,
          order_in_concept: Number(l.order_in_concept) || 0,
          active: l.active !== false,
        },
        kiMap.get(String(l.ki_id)),
      ),
    )
    .filter((x): x is CurriculumKi => !!x);

  const exemplarKi = hydrated.find((k) => k.is_exemplar) ?? null;
  const drillsAll = hydrated.filter((k) => !k.is_exemplar);
  const drills = drillsAll.slice(0, cap);

  let teach: ConceptWithItems['teach'];
  if (concept.teach_kind === 'authored' && concept.teach_beat_status === 'ready' && concept.teach_beat_ref) {
    teach = { kind: 'authored', ref: concept.teach_beat_ref };
  } else if (concept.teach_kind === 'ki_exemplar' && exemplarKi) {
    teach = { kind: 'ki_exemplar', exemplar: exemplarKi };
  } else {
    // Pending beat or missing exemplar — provisional fallback per Plan §D.7
    teach = { kind: 'pending', provisional: drillsAll[0] };
  }

  return { concept, teach, drills, drillsAvailable: drillsAll.length };
}

/** Gate metadata for a band. */
export async function getBandGate(spoke: string, topic: string, band: Band): Promise<BandGateRow | null> {
  const { data, error } = await (supabase as any)
    .from('curriculum_gates')
    .select('*')
    .eq('spoke', spoke)
    .eq('topic', topic)
    .eq('band', band)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: String(data.id),
    spoke: String(data.spoke),
    topic: String(data.topic),
    band: asBand(data.band),
    gate_prompt: String(data.gate_prompt ?? ''),
    pass_threshold: Number(data.pass_threshold ?? TRAIN_TUNABLES.bandGatePassThreshold),
    item_strategy: 'band_exemplars',
    promotes_to: data.promotes_to == null ? null : (asBand(data.promotes_to) as Band),
  };
}

/** Cold item pool for a band gate (exemplar KIs of every concept in the band). */
export async function getBandExemplarPool(
  spoke: string,
  topic: string,
  band: Band,
): Promise<CurriculumKi[]> {
  const { data: concepts, error: cErr } = await (supabase as any)
    .from('curriculum_concepts')
    .select('concept_id, exemplar_ki_id')
    .eq('spoke', spoke)
    .eq('topic', topic)
    .eq('band', band);
  if (cErr) throw cErr;

  const conceptIds = ((concepts as AnyRow[]) ?? []).map((c) => String(c.concept_id));
  if (!conceptIds.length) return [];

  const { data: links, error: lErr } = await (supabase as any)
    .from('ki_curriculum')
    .select('ki_id, role, is_exemplar, order_in_concept, active, concept_id')
    .in('concept_id', conceptIds)
    .eq('is_exemplar', true)
    .eq('active', true);
  if (lErr) throw lErr;

  const kiIds = ((links as AnyRow[]) ?? []).map((l) => String(l.ki_id));
  if (!kiIds.length) return [];

  const { data: kiRows, error: kErr } = await (supabase as any)
    .from('knowledge_items')
    .select(KI_COLS)
    .in('id', kiIds);
  if (kErr) throw kErr;

  const kiMap = new Map(((kiRows as AnyRow[]) ?? []).map((r) => [String(r.id), r]));
  return ((links as AnyRow[]) ?? [])
    .map((l) =>
      hydrateKi(
        {
          ki_id: String(l.ki_id),
          role: String(l.role ?? 'teach'),
          is_exemplar: true,
          order_in_concept: Number(l.order_in_concept) || 0,
          active: true,
        },
        kiMap.get(String(l.ki_id)),
      ),
    )
    .filter((x): x is CurriculumKi => !!x);
}

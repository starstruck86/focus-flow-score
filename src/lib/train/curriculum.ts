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
  ref: {
    ki_id: string;
    role: string;
    is_exemplar: boolean;
    order_in_concept: number;
    active?: boolean;
    scenario?: string | null;
    drillRubric?: Array<{ c: string; must?: boolean }> | null;
    drillTeachScript?: string | null;
    drillModelAnswer?: string | null;
  },
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
    scenario: ref.scenario ?? null,
    drillRubric: ref.drillRubric ?? null,
    drillTeachScript: ref.drillTeachScript ?? null,
    drillModelAnswer: ref.drillModelAnswer ?? null,
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
      teach_beat_md: (raw.teach_beat_md as string | null) ?? null,
      drill_prompt: (raw.drill_prompt as string | null) ?? null,
      model_line_plain: (raw.model_line_plain as string | null) ?? null,
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

  const [{ data: conceptData, error: cErr }, { data: linkData, error: lErr }, { data: rubricData, error: rErr }] = await Promise.all([
    (supabase as any).from('curriculum_concepts').select('*').eq('concept_id', conceptId).maybeSingle(),
    (supabase as any)
      .from('ki_curriculum_full')
      .select('ki_id, role, is_exemplar, order_in_concept, active, drill_scenario')
      .eq('concept_id', conceptId)
      .eq('active', true)
      .order('order_in_concept', { ascending: true }),
    (supabase as any)
      .from('ki_curriculum')
      .select('ki_id, drill_rubric, drill_teach_script, drill_model_answer')
      .eq('concept_id', conceptId),
  ]);
  if (cErr) throw cErr;
  if (lErr) throw lErr;
  if (rErr) throw rErr;
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
    teach_beat_md: (conceptData.teach_beat_md as string | null) ?? null,
    drill_prompt: (conceptData.drill_prompt as string | null) ?? null,
    model_line_plain: (conceptData.model_line_plain as string | null) ?? null,
    notes: (conceptData.notes as string | null) ?? null,

    lesson_md: ((conceptData as any).lesson_md as string | null) ?? null,
  };

  const links = (linkData as AnyRow[]) ?? [];
  const kiIds = links.map((l) => String(l.ki_id));

  const rubricMap = new Map<string, Array<{ c: string; must?: boolean }>>();
  const scriptMap = new Map<string, string>();
  for (const r of (rubricData as AnyRow[]) ?? []) {
    const kiId = String(r.ki_id);
    if (Array.isArray(r.drill_rubric)) {
      rubricMap.set(kiId, r.drill_rubric as Array<{ c: string; must?: boolean }>);
    }
    const s = (r.drill_teach_script as string | null) ?? null;
    if (s && s.trim().length > 0) scriptMap.set(kiId, s);
  }

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
          scenario: (l.drill_scenario as string | null) ?? null,
          drillRubric: rubricMap.get(String(l.ki_id)) ?? null,
          drillTeachScript: scriptMap.get(String(l.ki_id)) ?? null,
        },
        kiMap.get(String(l.ki_id)),
      ),
    )
    .filter((x): x is CurriculumKi => !!x);
  // Attach concept's model_line_plain to every hydrated KI (drills + exemplar)
  // so the grader can receive it as gold.
  for (const h of hydrated) {
    h.modelLinePlain = concept.model_line_plain ?? null;
  }

  const exemplarKi = hydrated.find((k) => k.is_exemplar) ?? null;
  const drillsAll = hydrated.filter((k) => !k.is_exemplar);
  let drills = drillsAll.slice(0, cap);
  let drillsAvailable = drillsAll.length;

  // Synthesize a single practice drill for teach-only concepts so the
  // ladder never dead-ends. Order: warm (off exemplar) → cold (prompt only).
  if (drillsAvailable === 0) {
    if (exemplarKi) {
      // WARM: clone exemplar as drill, keep its real when_to_use untouched.
      // Situation lives only on `scenario`.
      const situation =
        (concept.drill_prompt && concept.drill_prompt.trim()) ||
        exemplarKi.when_to_use ||
        'Respond to this buyer situation.';
      drills = [{
        ...exemplarKi,
        role: 'drill',
        is_exemplar: false,
        order_in_concept: 0,
        scenario: situation,
      }];
      drillsAvailable = 1;
    } else if (concept.drill_prompt && concept.drill_prompt.trim()) {
      // COLD prompt-only: no real KI behind it.
      drills = [{
        ki_id: '',
        role: 'drill',
        is_exemplar: false,
        order_in_concept: 0,
        active: true,
        title: concept.title,
        tactic_summary: null,
        example_usage: null,
        when_to_use: null,
        when_not_to_use: null,
        why_it_matters: null,
        spider_dimension: null,
        chapter: null,
        promptOnly: true,
        scenario: concept.drill_prompt,
      }];
      drillsAvailable = 1;
    }
  }

  // Teach-opener resolution (Plan §D ruling + correction):
  //   pending status         → provisional first-drill (never hard-skip)
  //   authored + teach_beat_md → render inline markdown (PREFERRED for authored)
  //   authored + teach_beat_ref → external ref handle (legacy)
  //   ki_exemplar            → exemplar KI
  //   fallback               → provisional first-drill
  let teach: ConceptWithItems['teach'];
  if (concept.teach_beat_status === 'pending') {
    teach = { kind: 'pending', provisional: drills[0] };
  } else if (concept.teach_kind === 'authored' && concept.teach_beat_md) {
    teach = { kind: 'authored_md', markdown: concept.teach_beat_md };
  } else if (concept.teach_kind === 'authored' && concept.teach_beat_ref) {
    teach = { kind: 'authored', ref: concept.teach_beat_ref };
  } else if (concept.teach_kind === 'ki_exemplar' && exemplarKi) {
    teach = {
      kind: 'ki_exemplar',
      exemplar: exemplarKi,
      modelLine: concept.model_line_plain ?? exemplarKi.example_usage,
    };

  } else {
    teach = { kind: 'pending', provisional: drills[0] };
  }

  return { concept, teach, drills, drillsAvailable };
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

/** Cold item pool for a band gate: exemplar KIs + prompt-only authored concepts. */
export async function getBandExemplarPool(
  spoke: string,
  topic: string,
  band: Band,
): Promise<CurriculumKi[]> {
  const { data: concepts, error: cErr } = await (supabase as any)
    .from('curriculum_concepts')
    .select('concept_id, exemplar_ki_id, teach_kind, drill_prompt, title, order_in_sublevel, model_line_plain, gate_elite')
    .eq('spoke', spoke)
    .eq('topic', topic)
    .eq('band', band)
    .order('order_in_sublevel', { ascending: true });
  if (cErr) throw cErr;

  const conceptRows = (concepts as AnyRow[]) ?? [];
  const conceptIds = conceptRows.map((c) => String(c.concept_id));
  const conceptById = new Map(conceptRows.map((c) => [String(c.concept_id), c]));

  // Pool A — real exemplar KIs (hydrated from ki_curriculum_full so scenario flows through)
  const exemplarItems: CurriculumKi[] = [];
  if (conceptIds.length) {
    const { data: links, error: lErr } = await (supabase as any)
      .from('ki_curriculum_full')
      .select('ki_id, role, is_exemplar, order_in_concept, active, concept_id, drill_scenario')
      .in('concept_id', conceptIds)
      .eq('is_exemplar', true)
      .eq('active', true);
    if (lErr) throw lErr;

    const linkRows = (links as AnyRow[]) ?? [];
    const kiIds = linkRows.map((l) => String(l.ki_id));
    if (kiIds.length) {
      const { data: kiRows, error: kErr } = await (supabase as any)
        .from('knowledge_items')
        .select(KI_COLS)
        .in('id', kiIds);
      if (kErr) throw kErr;
      const kiMap = new Map(((kiRows as AnyRow[]) ?? []).map((r) => [String(r.id), r]));
      for (const l of linkRows) {
        const hk = hydrateKi(
          {
            ki_id: String(l.ki_id),
            role: String(l.role ?? 'teach'),
            is_exemplar: true,
            order_in_concept: Number(l.order_in_concept) || 0,
            active: true,
            scenario: (l.drill_scenario as string | null) ?? null,
          },
          kiMap.get(String(l.ki_id)),
        );
        if (hk) {
          const concept = conceptById.get(String(l.concept_id));
          hk.modelLinePlain = (concept?.model_line_plain as string | null) ?? null;
          exemplarItems.push(hk);
        }
      }
    }
  }

  // Pool B — authored concepts with a drill_prompt: synthesize prompt-only cold items
  const promptOnlyItems: CurriculumKi[] = conceptRows
    .filter((c) => c.teach_kind === 'authored' && typeof c.drill_prompt === 'string' && (c.drill_prompt as string).trim().length > 0)
    .map((c) => ({
      ki_id: '',
      role: 'drill' as const,
      is_exemplar: false,
      order_in_concept: Number(c.order_in_sublevel) || 0,
      active: true,
      title: String(c.title ?? ''),
      tactic_summary: (c.gate_elite as string | null) ?? null,
      example_usage: null,
      when_to_use: null,
      when_not_to_use: null,
      why_it_matters: null,
      spider_dimension: null,
      chapter: null,
      promptOnly: true,
      scenario: String(c.drill_prompt),
      modelLinePlain: null,
    }));

  // Prompt-only authored items lead (they're typically early-concept value-story prompts),
  // followed by exemplar KIs in their natural ki_curriculum order.
  return [...promptOnlyItems, ...exemplarItems];
}



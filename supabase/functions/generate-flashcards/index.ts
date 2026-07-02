import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-2.5-flash";

type Card = {
  ki_id: string;
  concept_id?: string | null;
  card_type: "trigger" | "definition" | "talk_track";
  front: string;
  back: string;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You are building spaced-repetition flashcards for an elite enterprise sales AE.

CARD TYPES & FRONT-QUALITY BAR (non-negotiable):

- "trigger": FRONT = a concrete mini-scenario, 15–40 words, containing (a) a specific persona at a specific company type AND (b) either a quoted line they say OR a specific observable behavior. Never a category description. BACK = the tactic name + the one-line move.
  GOOD trigger front: "The newly promoted CFO at a 400-person retail brand opens your exec review with: 'Convince me this isn't just a nice-to-have we cut next quarter.'"
  BAD trigger front (NEVER produce anything like this): "You're dealing with a CRO or CFO who is new to their role or new to purchasing solutions like yours."

- "definition": FRONT = one specific, answerable question about the term/feature/concept (e.g. "What single metric does an economic buyer weigh a purchase against in their first 90 days?"). NEVER open-ended prompts like "What do you know about X" or "Explain X". BACK = a crisp 1–2 sentence answer.

- "talk_track": FRONT = a vivid situation prompt naming a specific persona and company type, same 15–40 word concreteness bar as trigger — the AE must respond out loud. BACK = the elite model line (use model_line_plain VERBATIM when provided).

HARD RULES:
- FRONT must NEVER contain or paraphrase the answer. A learner should not be able to guess the back from the front alone.
- BACK must be <= 40 words.
- Do NOT invent product facts. If model_line_plain is missing, derive the back only from teach_beat_md or the KI content given.
- Produce 1–2 cards per input item. Prefer 1 unless a second card of a clearly different type adds real value.

SOURCE-MATERIAL RULE:
- When teach_beat_md is present, use its concrete details as the source of the cue.
- When teach_beat_md is absent, synthesize the cue from when_to_use PLUS the provided drill_scenarios and ki_example — favor concrete personas, quoted lines, and observable behaviors from those scenarios. Do not fall back to abstract category framings.
- If the source for an item is genuinely too thin to build a concrete card that meets the bar above, SKIP that item entirely (return NO cards for it). Fewer, better cards is the goal.

Return STRICT JSON: {"cards": [{ki_id, concept_id, card_type, front, back}, ...]}. concept_id may be null when not applicable. Items you skip simply produce no cards; do not include placeholder entries.`;

async function callAI(lovableApiKey: string, userPrompt: string): Promise<Card[]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableApiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`AI ${res.status}: ${txt.slice(0, 400)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty AI response");
  const parsed = JSON.parse(content);
  const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
  return cards.filter((c: any) =>
    c && typeof c.ki_id === "string" && typeof c.front === "string" && typeof c.back === "string" &&
    ["trigger", "definition", "talk_track"].includes(c.card_type)
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) return json(500, { error: "LOVABLE_API_KEY missing" });

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    let { deck_id, source_type, source_ref } = body as {
      deck_id?: string; source_type?: string; source_ref?: string;
    };

    // ── Resolve or create deck ──
    let deck: any = null;
    if (deck_id) {
      const { data } = await admin.from("flashcard_decks").select("*").eq("id", deck_id).maybeSingle();
      deck = data;
      if (!deck) return json(404, { error: "deck not found" });
      source_type = deck.source_type; source_ref = deck.source_ref;
    } else {
      if (!source_type || !source_ref) return json(400, { error: "source_type + source_ref required" });
      const { data: existing } = await admin.from("flashcard_decks")
        .select("*").eq("source_type", source_type).eq("source_ref", source_ref).maybeSingle();
      if (existing) {
        deck = existing;
      } else {
        const spoke = source_type === "curriculum_topic" ? source_ref.split("/")[0] : null;
        const title = source_type === "curriculum_topic" ? source_ref : source_ref;
        const { data: created, error: cErr } = await admin.from("flashcard_decks")
          .insert({ source_type, source_ref, spoke, title, generation_status: "empty" })
          .select().single();
        if (cErr) return json(500, { error: "deck create failed", detail: cErr.message });
        deck = created;
      }
    }

    await admin.from("flashcard_decks").update({ generation_status: "generating" }).eq("id", deck.id);

    // ── Assemble source items ──
    type SourceItem = { ki_id: string; concept_id: string | null; prompt_block: string };
    const items: SourceItem[] = [];

    if (source_type === "curriculum_topic") {
      const [spoke, topic] = String(source_ref).split("/");
      if (!spoke || !topic) {
        await admin.from("flashcard_decks").update({ generation_status: "failed" }).eq("id", deck.id);
        return json(400, { error: "source_ref must be 'spoke/topic'" });
      }
      const { data: concepts } = await admin.from("curriculum_concepts")
        .select("concept_id, title, band, model_line_plain, teach_beat_md")
        .eq("spoke", spoke).eq("topic", topic)
        .order("band", { ascending: true }).order("sub_level", { ascending: true });

      const conceptIds = (concepts ?? []).map((c: any) => c.concept_id);
      const { data: ki } = await admin.from("ki_curriculum")
        .select("concept_id, ki_id, is_exemplar, role, order_in_concept, active, drill_scenario")
        .in("concept_id", conceptIds).eq("active", true);

      const byConcept = new Map<string, any[]>();
      for (const r of (ki ?? []) as any[]) {
        if (!byConcept.has(r.concept_id)) byConcept.set(r.concept_id, []);
        byConcept.get(r.concept_id)!.push(r);
      }
      // pick one exemplar/teach KI per concept, and collect up to 3 drill scenarios
      const kiIds = new Set<string>();
      const conceptToKi = new Map<string, string>();
      const conceptToScenarios = new Map<string, string[]>();
      for (const c of (concepts ?? []) as any[]) {
        const rows = (byConcept.get(c.concept_id) ?? []).sort((a: any, b: any) =>
          (b.is_exemplar ? 1 : 0) - (a.is_exemplar ? 1 : 0) ||
          (a.order_in_concept ?? 0) - (b.order_in_concept ?? 0)
        );
        if (rows[0]) { conceptToKi.set(c.concept_id, rows[0].ki_id); kiIds.add(rows[0].ki_id); }
        const scenarios = rows
          .map((r) => (typeof r.drill_scenario === "string" ? r.drill_scenario.trim() : ""))
          .filter((s) => s.length > 0)
          .slice(0, 3);
        if (scenarios.length) conceptToScenarios.set(c.concept_id, scenarios);
      }
      const { data: kiRows } = await admin.from("knowledge_items")
        .select("id, title, tactic_summary, why_it_matters, when_to_use, example_usage")
        .in("id", Array.from(kiIds));
      const kiMap = new Map<string, any>();
      for (const k of (kiRows ?? []) as any[]) kiMap.set(k.id, k);

      for (const c of (concepts ?? []) as any[]) {
        const kid = conceptToKi.get(c.concept_id);
        if (!kid) continue;
        const k = kiMap.get(kid) || {};
        const scenarios = conceptToScenarios.get(c.concept_id) ?? [];
        const scenariosBlock = scenarios.length
          ? scenarios.map((s, i) => `  ${i + 1}. ${s.slice(0, 400)}`).join("\n")
          : "  (none)";
        items.push({
          ki_id: kid,
          concept_id: c.concept_id,
          prompt_block: `concept_id: ${c.concept_id}
ki_id: ${kid}
title: ${c.title}
band: ${c.band}
model_line_plain: ${c.model_line_plain ?? "(none)"}
teach_beat_md: ${(c.teach_beat_md ?? "").slice(0, 600)}
ki_title: ${k.title ?? ""}
ki_summary: ${k.tactic_summary ?? ""}
ki_why: ${k.why_it_matters ?? ""}
ki_when: ${k.when_to_use ?? ""}
ki_example: ${(k.example_usage ?? "").slice(0, 300)}
drill_scenarios:
${scenariosBlock}`,
        });
      }
    } else if (source_type === "resource" || source_type === "chapter") {
      const filterCol = source_type === "resource" ? "resource_id" : "chapter";
      const { data: kis } = await admin.from("knowledge_items")
        .select("id, title, tactic_summary, why_it_matters, when_to_use, example_usage")
        .eq(filterCol, source_ref).eq("active", true).limit(30);
      for (const k of (kis ?? []) as any[]) {
        items.push({
          ki_id: k.id, concept_id: null,
          prompt_block: `ki_id: ${k.id}
title: ${k.title ?? ""}
summary: ${k.tactic_summary ?? ""}
why: ${k.why_it_matters ?? ""}
when: ${k.when_to_use ?? ""}
example: ${(k.example_usage ?? "").slice(0, 300)}`,
        });
      }
    } else {
      await admin.from("flashcard_decks").update({ generation_status: "failed" }).eq("id", deck.id);
      return json(400, { error: `unknown source_type ${source_type}` });
    }

    if (items.length === 0) {
      await admin.from("flashcard_decks").update({ generation_status: "failed" }).eq("id", deck.id);
      return json(422, { error: "no source items found" });
    }

    // ── Batch AI calls (15 per call) ──
    const allCards: Card[] = [];
    try {
      for (const batch of chunk(items, 15)) {
        const userPrompt = `Produce flashcards for the following ${batch.length} item(s). Return {"cards": [...]}.

${batch.map((b, i) => `--- ITEM ${i + 1} ---\n${b.prompt_block}`).join("\n\n")}`;
        const cards = await callAI(lovableApiKey, userPrompt);
        for (const c of cards) allCards.push(c);
      }
    } catch (e) {
      console.error("AI batch failed", e);
      await admin.from("flashcard_decks").update({ generation_status: "failed" }).eq("id", deck.id);
      return json(502, { error: "AI generation failed", detail: String(e).slice(0, 400) });
    }

    // ── Idempotent insert ──
    const validKiIds = new Set(items.map((i) => i.ki_id));
    const rows = allCards
      .filter((c) => validKiIds.has(c.ki_id))
      .map((c) => ({
        deck_id: deck.id,
        ki_id: c.ki_id,
        concept_id: c.concept_id ?? null,
        card_type: c.card_type,
        front: c.front,
        back: c.back,
        generation_model: MODEL,
      }));

    let inserted = 0;
    if (rows.length > 0) {
      const { data: ins, error: insErr } = await admin
        .from("flashcards")
        .upsert(rows, { onConflict: "deck_id,ki_id,card_type", ignoreDuplicates: true })
        .select("id");
      if (insErr) {
        console.error("insert error", insErr);
        await admin.from("flashcard_decks").update({ generation_status: "failed" }).eq("id", deck.id);
        return json(500, { error: "insert failed", detail: insErr.message });
      }
      inserted = ins?.length ?? 0;
    }

    // ── Update deck totals ──
    const { count } = await admin.from("flashcards").select("id", { count: "exact", head: true }).eq("deck_id", deck.id);
    await admin.from("flashcard_decks")
      .update({ generation_status: "complete", card_count: count ?? 0 })
      .eq("id", deck.id);

    return json(200, { deck_id: deck.id, generated: allCards.length, inserted, total_cards: count ?? 0 });
  } catch (err) {
    console.error("Unhandled", err);
    return json(500, { error: "internal", detail: String(err).slice(0, 400) });
  }
});

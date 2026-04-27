// ════════════════════════════════════════════════════════════════
// W6.5 Pass A — Library Standard Context tests
//
// Covers:
//   • Exemplar selection from a stub library_cards table
//   • Skip-clean behavior on insufficient exemplars
//   • RESOURCE beats STANDARD dedup (retrieved IDs are demoted)
//   • Rendered STANDARDS block always carries the do-not-cite line
//   • Persistence/telemetry shapes are stable
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildStandardContextLog,
  buildStandardContextPersistenceBlock,
  renderStandardBlock,
  selectExemplars,
} from "./libraryStandard.ts";

// ─── Stub Supabase client ────────────────────────────────────────
//
// Implements just enough of the chained PostgREST builder used by
// `selectExemplars`: from(...).select(...).eq(...).in(...).limit(...).
// Returns `{ data, error }` from the final await.

interface CardRow {
  id: string;
  source_type?: string;
  source_ids?: string[];
  library_role: string;
  title: string;
  when_to_use: string | null;
  the_move: string;
  why_it_works: string | null;
  anti_patterns: string[];
  example_snippet: string | null;
  applies_to_contexts: string[];
  confidence: number;
}

function stubSupabaseWithCards(
  cards: CardRow[],
  opts?: { errorMessage?: string },
) {
  return {
    from(_table: string) {
      const builder = {
        select(_cols: string) { return builder; },
        eq(_col: string, _val: unknown) { return builder; },
        in(_col: string, _vals: unknown[]) { return builder; },
        limit(_n: number) {
          return Promise.resolve(
            opts?.errorMessage
              ? { data: null, error: { message: opts.errorMessage } }
              : { data: cards, error: null },
          );
        },
      };
      return builder;
    },
  };
}

const baseCard = (over: Partial<CardRow>): CardRow => ({
  id: over.id ?? crypto.randomUUID(),
  library_role: over.library_role ?? "pattern",
  title: over.title ?? "Untitled",
  when_to_use: over.when_to_use ?? null,
  the_move: over.the_move ?? "Do the thing",
  why_it_works: over.why_it_works ?? null,
  anti_patterns: over.anti_patterns ?? [],
  example_snippet: over.example_snippet ?? null,
  applies_to_contexts: over.applies_to_contexts ?? [],
  confidence: over.confidence ?? 0.8,
  source_ids: over.source_ids,
  source_type: over.source_type,
});

// ─── Tests ───────────────────────────────────────────────────────

Deno.test("Pass A: selects 2–4 exemplars when scopes match", async () => {
  const cards: CardRow[] = [
    baseCard({
      id: "card-aaaaaaaa-1111-2222-3333-aaaaaaaaaaaa",
      library_role: "pattern",
      title: "Multi-Angle Reopen",
      the_move: "Open with four distinct angles for a stalled retail renewal",
      applies_to_contexts: ["retail", "renewal"],
    }),
    baseCard({
      id: "card-bbbbbbbb-1111-2222-3333-bbbbbbbbbbbb",
      library_role: "exemplar",
      title: "Account Brief Museum",
      the_move: "Six sections including PoV and Next Step for retail accounts",
      applies_to_contexts: ["retail", "brief"],
    }),
    baseCard({
      id: "card-cccccccc-1111-2222-3333-cccccccccccc",
      library_role: "standard",
      title: "PoV Specificity",
      the_move: "Name the leakage and attach an economic frame for retail buyers",
      applies_to_contexts: ["retail"],
    }),
    // Decoy with no scope match — should not be selected.
    baseCard({
      id: "card-decoy",
      library_role: "tactic",
      title: "Unrelated tactic",
      the_move: "Something about cybersecurity",
      applies_to_contexts: ["security"],
    }),
  ];
  const supabase = stubSupabaseWithCards(cards);

  const set = await selectExemplars(supabase, "user-1", {
    workspace: "brainstorm",
    surface: "strategy-chat",
    scopes: ["retail"],
  });

  assertEquals(set.injected, true);
  assert(set.exemplars.length >= 2 && set.exemplars.length <= 4);
  // Decoy must not be selected.
  assert(!set.exemplars.some((e) => e.id === "card-decoy"));
  // ExemplarSetId must be a non-empty string for telemetry join.
  assert(set.exemplarSetId.length > 0);
});

Deno.test("Pass A: skips cleanly when no rows in library", async () => {
  const supabase = stubSupabaseWithCards([]);
  const set = await selectExemplars(supabase, "user-1", {
    workspace: "brainstorm",
    surface: "strategy-chat",
    scopes: ["retail"],
  });
  assertEquals(set.injected, false);
  assertEquals(set.skippedReason, "no_rows");
  assertEquals(set.exemplars.length, 0);
});

Deno.test("Pass A: skips cleanly when no scopes provided", async () => {
  const supabase = stubSupabaseWithCards([
    baseCard({ library_role: "pattern", title: "Anything", the_move: "x" }),
  ]);
  const set = await selectExemplars(supabase, "user-1", {
    workspace: "work",
    surface: "strategy-chat",
    scopes: [],
  });
  assertEquals(set.injected, false);
  assertEquals(set.skippedReason, "no_scopes");
});

Deno.test("Pass A: skips cleanly below minExemplars", async () => {
  const supabase = stubSupabaseWithCards([
    baseCard({
      id: "only-one",
      library_role: "pattern",
      title: "Just one",
      the_move: "Mentions retail once",
      applies_to_contexts: ["retail"],
    }),
  ]);
  const set = await selectExemplars(supabase, "user-1", {
    workspace: "brainstorm",
    surface: "strategy-chat",
    scopes: ["retail"],
    minExemplars: 2,
  });
  assertEquals(set.injected, false);
  assertEquals(set.skippedReason, "below_min_exemplars");
});

Deno.test("Pass A: RESOURCE beats STANDARD — retrievedItemIds demoted", async () => {
  const cards: CardRow[] = [
    baseCard({
      id: "demoted-id",
      library_role: "pattern",
      title: "Should be demoted",
      the_move: "Talks about retail patterns explicitly",
      applies_to_contexts: ["retail"],
    }),
    baseCard({
      id: "kept-1",
      library_role: "exemplar",
      title: "Kept exemplar A",
      the_move: "A great retail brief example",
      applies_to_contexts: ["retail"],
    }),
    baseCard({
      id: "kept-2",
      library_role: "standard",
      title: "Kept standard B",
      the_move: "PoV bar for retail accounts",
      applies_to_contexts: ["retail"],
    }),
  ];
  const supabase = stubSupabaseWithCards(cards);

  const set = await selectExemplars(supabase, "user-1", {
    workspace: "brainstorm",
    surface: "strategy-chat",
    scopes: ["retail"],
    retrievedItemIds: ["demoted-id"],
  });

  assertEquals(set.injected, true);
  assert(!set.exemplars.some((e) => e.id === "demoted-id"));
});

Deno.test("Pass A: source_ids overlap with retrieval also demotes the card", async () => {
  const cards: CardRow[] = [
    baseCard({
      id: "card-derived",
      library_role: "pattern",
      title: "Card derived from a retrieved resource",
      the_move: "Retail patterns",
      applies_to_contexts: ["retail"],
      source_ids: ["resource-X"],
    }),
    baseCard({
      id: "card-clean-1",
      library_role: "exemplar",
      title: "Clean A",
      the_move: "Retail exemplar",
      applies_to_contexts: ["retail"],
    }),
    baseCard({
      id: "card-clean-2",
      library_role: "standard",
      title: "Clean B",
      the_move: "Retail bar",
      applies_to_contexts: ["retail"],
    }),
  ];
  const supabase = stubSupabaseWithCards(cards);
  const set = await selectExemplars(supabase, "user-1", {
    workspace: "artifacts",
    surface: "run-task",
    scopes: ["retail"],
    retrievedItemIds: ["resource-X"],
  });
  assertEquals(set.injected, true);
  assert(!set.exemplars.some((e) => e.id === "card-derived"));
});

Deno.test("Pass A: rendered STANDARDS block contains the do-not-cite instruction", async () => {
  const cards: CardRow[] = [
    baseCard({
      library_role: "pattern",
      title: "P1",
      the_move: "Retail pattern one",
      applies_to_contexts: ["retail"],
    }),
    baseCard({
      library_role: "exemplar",
      title: "E1",
      the_move: "Retail exemplar one",
      applies_to_contexts: ["retail"],
    }),
  ];
  const supabase = stubSupabaseWithCards(cards);
  const set = await selectExemplars(supabase, "user-1", {
    workspace: "brainstorm",
    surface: "strategy-chat",
    scopes: ["retail"],
  });
  assertEquals(set.injected, true);
  const text = renderStandardBlock(set);
  assertStringIncludes(text, "WHAT GOOD LOOKS LIKE");
  assertStringIncludes(text, "Do NOT cite these unless");
  assertStringIncludes(text, "STANDARDS guide HOW to answer. RESOURCES are facts you may cite.");
  assertStringIncludes(text, "=== END STANDARDS ===");
});

Deno.test("Pass A: renderStandardBlock returns empty string when not injected", async () => {
  const supabase = stubSupabaseWithCards([]);
  const set = await selectExemplars(supabase, "user-1", {
    workspace: "brainstorm",
    surface: "strategy-chat",
    scopes: ["retail"],
  });
  assertEquals(set.injected, false);
  assertEquals(renderStandardBlock(set), "");
});

Deno.test("Pass A: telemetry log + persistence block expose exemplarSetId", async () => {
  const cards: CardRow[] = [
    baseCard({
      library_role: "pattern",
      title: "P",
      the_move: "Retail",
      applies_to_contexts: ["retail"],
    }),
    baseCard({
      library_role: "standard",
      title: "S",
      the_move: "Retail bar",
      applies_to_contexts: ["retail"],
    }),
  ];
  const supabase = stubSupabaseWithCards(cards);
  const set = await selectExemplars(supabase, "user-1", {
    workspace: "work",
    surface: "strategy-chat",
    scopes: ["retail"],
  });
  const log = buildStandardContextLog(set);
  const persisted = buildStandardContextPersistenceBlock(set);
  assertEquals(log.exemplarSetId, set.exemplarSetId);
  assertEquals(persisted.exemplarSetId, set.exemplarSetId);
  assertEquals(log.shadow, true);
  assertEquals(persisted.injected, set.injected);
  assertEquals(persisted.exemplarCount, set.exemplars.length);
});

Deno.test("Pass A: gracefully returns empty set when fetch errors", async () => {
  const supabase = stubSupabaseWithCards([], {
    errorMessage: "boom",
  });
  const set = await selectExemplars(supabase, "user-1", {
    workspace: "brainstorm",
    surface: "strategy-chat",
    scopes: ["retail"],
  });
  assertEquals(set.injected, false);
  assertEquals(set.skippedReason, "fetch_failed");
});

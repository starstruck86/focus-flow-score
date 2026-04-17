// Deterministic tests for resourceRetrieval.ts.
// No network. We stub a tiny supabase-shaped object that records the
// queries it sees and returns canned rows so we can verify ranking,
// admit-absence behavior, and prompt-block contracts.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractCandidatePhrases,
  inferResourceCategories,
  renderResourceContextBlock,
  retrieveResourceContext,
  userAskedForResource,
} from "./resourceRetrieval.ts";

// ── Fake supabase client ──────────────────────────────────────────
interface Recorded {
  table: string;
  filters: Array<{ op: string; col?: string; val?: unknown }>;
}

function makeStubSupabase(rowsByQuery: (rec: Recorded) => any[]) {
  const records: Recorded[] = [];
  const builder = (rec: Recorded): any => ({
    select: (_cols: string) => builder(rec),
    eq: (col: string, val: unknown) => {
      rec.filters.push({ op: "eq", col, val });
      return builder(rec);
    },
    ilike: (col: string, val: unknown) => {
      rec.filters.push({ op: "ilike", col, val });
      return builder(rec);
    },
    order: (_c: string, _o: unknown) => builder(rec),
    limit: (_n: number) => Promise.resolve({ data: rowsByQuery(rec), error: null }),
  });
  return {
    from: (table: string) => {
      const rec: Recorded = { table, filters: [] };
      records.push(rec);
      return builder(rec);
    },
    _records: records,
  };
}

// ── Phrase extraction ─────────────────────────────────────────────

Deno.test("extractCandidatePhrases: pulls quoted strings", () => {
  const out = extractCandidatePhrases(`Use the "Kevin Dorsey ROI Calculator" please`);
  assertEquals(out.includes("Kevin Dorsey ROI Calculator"), true);
});

Deno.test("extractCandidatePhrases: pulls capitalized title spans", () => {
  const out = extractCandidatePhrases(`Let's build this off Kevin Dorsey ROI Calculator`);
  // Must contain at least one span containing "Kevin Dorsey"
  assert(out.some((p) => p.includes("Kevin Dorsey")), `expected a 'Kevin Dorsey' span, got ${JSON.stringify(out)}`);
});

Deno.test("inferResourceCategories: detects multiple intents", () => {
  const cats = inferResourceCategories("Do we have a business case template or ROI calculator example?");
  assertEquals(cats.includes("template"), true);
  assertEquals(cats.includes("calculator"), true);
  assertEquals(cats.includes("business case"), true);
  assertEquals(cats.includes("roi"), true);
});

Deno.test("userAskedForResource: triggers on intent words", () => {
  assertEquals(userAskedForResource("Do we have an executive business case template?"), true);
  assertEquals(userAskedForResource("Random unrelated chit-chat"), false);
});

// ── retrieveResourceContext: hit path ─────────────────────────────

Deno.test("retrieveResourceContext: returns exact match before category match and emits citation rules", async () => {
  const stub = makeStubSupabase((rec) => {
    // Exact ILIKE on "Kevin Dorsey ROI Calculator" → no hit
    if (rec.filters.some((f) => f.op === "ilike" && f.val === "Kevin Dorsey ROI Calculator")) {
      return [];
    }
    // Near-exact (%Kevin Dorsey ROI Calculator%) → no hit
    if (rec.filters.some((f) => f.op === "ilike" && typeof f.val === "string" && (f.val as string).includes("Kevin Dorsey ROI Calculator"))) {
      return [];
    }
    // Category intent on %roi% → simulated row
    if (rec.filters.some((f) => f.op === "ilike" && typeof f.val === "string" && (f.val as string).toLowerCase().includes("roi"))) {
      return [
        {
          id: "11111111-1111-1111-1111-111111111111",
          title: "ROI Doesn't Create Demand. ROI Justifies Demand",
          description: null,
          resource_type: "transcript",
          is_template: false,
          template_category: null,
          account_id: null,
          opportunity_id: null,
          tags: null,
        },
      ];
    }
    return [];
  });

  const out = await retrieveResourceContext(stub as any, "user-1", {
    userMessage: "Let's build this off Kevin Dorsey ROI Calculator",
  });

  assertEquals(out.userAskedForResource, true);
  assert(out.hits.length >= 1, "expected at least one hit from category backstop");
  assertEquals(out.hits[0].matchKind, "category_intent");
  assertStringIncludes(out.contextBlock, "LIBRARY RESOURCES");
  assertStringIncludes(out.contextBlock, "RESOURCE[");
  assertStringIncludes(out.contextBlock, "Never fabricate");
});

// ── retrieveResourceContext: admit-absence path ───────────────────

Deno.test("retrieveResourceContext: emits admit-absence block when nothing matches", async () => {
  const stub = makeStubSupabase(() => []);
  const out = await retrieveResourceContext(stub as any, "user-1", {
    userMessage: 'Do we have an executive business case template?',
  });
  assertEquals(out.hits.length, 0);
  assertEquals(out.userAskedForResource, true);
  assertStringIncludes(out.contextBlock, "No matching resource was found");
  assertStringIncludes(out.contextBlock, "I don't see a matching resource");
  assertStringIncludes(out.contextBlock, "Do NOT invent");
});

// ── retrieveResourceContext: silent when not asked ────────────────

Deno.test("retrieveResourceContext: emits empty block on irrelevant chit-chat", async () => {
  const stub = makeStubSupabase(() => []);
  const out = await retrieveResourceContext(stub as any, "user-1", {
    userMessage: "What's the weather like in Boston?",
  });
  assertEquals(out.userAskedForResource, false);
  assertEquals(out.contextBlock, "");
});

// ── Account-linked retrieval is wired ─────────────────────────────

Deno.test("retrieveResourceContext: queries account_id when accountId provided", async () => {
  const stub = makeStubSupabase(() => []);
  await retrieveResourceContext(stub as any, "user-1", {
    userMessage: "any examples for this account?",
    accountId: "acct-9",
  });
  const sawAccountFilter = (stub as any)._records.some((r: Recorded) =>
    r.table === "resources" && r.filters.some((f) => f.op === "eq" && f.col === "account_id" && f.val === "acct-9")
  );
  assertEquals(sawAccountFilter, true, "expected an eq('account_id', 'acct-9') query");
});

// ── ILIKE injection safety ────────────────────────────────────────

Deno.test("retrieveResourceContext: escapes %% and _ in user phrases", async () => {
  const escapedSeen: string[] = [];
  const stub = makeStubSupabase((rec) => {
    for (const f of rec.filters) {
      if (f.op === "ilike" && typeof f.val === "string" && (f.val.includes("\\%") || f.val.includes("\\_"))) {
        escapedSeen.push(f.val as string);
      }
    }
    return [];
  });
  await retrieveResourceContext(stub as any, "user-1", {
    userMessage: 'use the "100% ROI_calc" template',
  });
  assert(escapedSeen.length > 0, `expected at least one escaped ILIKE, none seen`);
});

// ── Prompt block: hits render with exact-title citation form ──────

Deno.test("renderResourceContextBlock: lists titles and forces RESOURCE[<title>] citation form", () => {
  const block = renderResourceContextBlock({
    hits: [
      {
        id: "abcdef0123456789",
        title: "AE Operating System - Business Case Template",
        description: "A one-pager template",
        resource_type: "document",
        is_template: false,
        template_category: null,
        account_id: null,
        opportunity_id: null,
        tags: null,
        matchKind: "near_exact_title",
        matchReason: 'Title contains "Business Case"',
      },
    ],
    userAskedForResource: true,
    extractedPhrases: ["Business Case"],
    inferredCategories: ["template", "business case"],
  });
  assertStringIncludes(block, "AE Operating System - Business Case Template");
  assertStringIncludes(block, "RESOURCE[abcdef01]");
  assertStringIncludes(block, "EXACT title");
});

// ── Apostrophe / possessive extraction (regression for "Kevin Dorsey's") ──

Deno.test("extractCandidatePhrases: handles possessive 's without leaking 's into the phrase", () => {
  const phrases = extractCandidatePhrases("Let's build this off Kevin Dorsey's ROI calculator");
  // Must include "Kevin Dorsey" cleanly (no leading "s build…")
  assert(phrases.some((p) => p === "Kevin Dorsey"), `missing 'Kevin Dorsey' in: ${JSON.stringify(phrases)}`);
  // Must NOT produce the broken artifact we used to see.
  assert(
    !phrases.some((p) => p.toLowerCase().startsWith("s build")),
    `regression: leaked 's' artifact in: ${JSON.stringify(phrases)}`,
  );
});

Deno.test("extractCandidatePhrases: ignores lowercase 'let's' / contractions at the start", () => {
  const phrases = extractCandidatePhrases("let's use Kevin Dorsey ROI thinking here");
  assert(phrases.some((p) => p.includes("Kevin Dorsey")));
  assert(!phrases.some((p) => /^let/i.test(p)));
});

// ── Type-aware ranking (regression: template should outrank transcripts) ──

Deno.test("retrieveResourceContext: template resource_type outranks transcripts when user asks for a template", async () => {
  const rows = [
    // Two near-exact title hits, returned in this order:
    { id: "11111111-aaaa-bbbb-cccc-000000000000", title: "9 Mistakes Salespeople Make with Business Cases", description: null, resource_type: "transcript", is_template: false, template_category: null, account_id: null, opportunity_id: null, tags: null },
    { id: "22222222-aaaa-bbbb-cccc-000000000000", title: "AE Operating System - Business Case Template", description: null, resource_type: "template", is_template: false, template_category: null, account_id: null, opportunity_id: null, tags: null },
  ];
  const stub: any = {
    from: (_t: string) => {
      const b: any = {
        _rows: rows,
        select: () => b,
        eq: () => b,
        ilike: () => b,
        order: () => b,
        limit: async () => ({ data: rows }),
      };
      return b;
    },
  };
  const out = await retrieveResourceContext(stub, "user-1", {
    userMessage: "Do we have an executive business case template?",
  });
  // Template should appear before the transcript.
  const titles = out.hits.map((h) => h.title);
  const tplIdx = titles.indexOf("AE Operating System - Business Case Template");
  const txIdx = titles.indexOf("9 Mistakes Salespeople Make with Business Cases");
  assert(tplIdx >= 0 && txIdx >= 0, `expected both rows in hits, got ${JSON.stringify(titles)}`);
  assert(tplIdx < txIdx, `expected template to outrank transcript; got order ${JSON.stringify(titles)}`);
});

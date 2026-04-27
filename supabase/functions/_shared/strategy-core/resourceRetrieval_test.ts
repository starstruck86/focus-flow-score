// Deterministic tests for resourceRetrieval.ts.
// No network. We stub a tiny supabase-shaped object that records the
// queries it sees and returns canned rows so we can verify ranking,
// admit-absence behavior, and prompt-block contracts.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  detectSourceShape,
  extractCandidatePhrases,
  inferResourceCategories,
  recordResourceUsage,
  renderResourceContextBlock,
  retrieveResourceContext,
  userAskedForPriorUse,
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
    or: (val: string) => {
      rec.filters.push({ op: "or", col: "or", val });
      return builder(rec);
    },
    in: (col: string, val: unknown) => {
      rec.filters.push({ op: "in", col, val });
      return builder(rec);
    },
    overlaps: (col: string, val: unknown) => {
      rec.filters.push({ op: "overlaps", col, val });
      return builder(rec);
    },
    contains: (col: string, val: unknown) => {
      rec.filters.push({ op: "contains", col, val });
      return builder(rec);
    },
    not: (col: string, op: string, val: unknown) => {
      rec.filters.push({ op: `not_${op}`, col, val });
      return builder(rec);
    },
    is: (col: string, val: unknown) => {
      rec.filters.push({ op: "is", col, val });
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
  assertStringIncludes(out.contextBlock, "No matching resource or KI was found");
  assertStringIncludes(out.contextBlock, "I scanned your library");
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

// ── Cross-thread resource memory (NEW) ────────────────────────────

Deno.test("userAskedForPriorUse: detects continuity phrases", () => {
  assert(userAskedForPriorUse("use the same resource we used last time"));
  assert(userAskedForPriorUse("what template did we use previously on this account?"));
  assert(userAskedForPriorUse("the deck we used before"));
  assert(!userAskedForPriorUse("what's the weather"));
  assert(!userAskedForPriorUse(""));
});

Deno.test("recordResourceUsage: writes deduped, non-empty inserts only", async () => {
  const inserts: any[] = [];
  const reads: any[] = [];
  const stub: any = {
    from: (table: string) => {
      const b: any = {
        _table: table,
        _filters: {} as Record<string, any>,
        select: (_c: string) => b,
        eq: (col: string, val: any) => { b._filters[col] = val; return b; },
        in: (col: string, vals: any[]) => {
          // simulate dedupe-read returning empty (nothing previously written)
          reads.push({ table, col, vals, filters: { ...b._filters } });
          return Promise.resolve({ data: [] });
        },
        insert: (rows: any[]) => {
          inserts.push({ table, rows });
          return Promise.resolve({ error: null });
        },
      };
      return b;
    },
  };
  const out = await recordResourceUsage(stub, {
    userId: "user-1",
    threadId: "thread-1",
    resourceIds: ["a", "b", "a", ""], // dedupe + drop empty
  });
  assertEquals(out.inserted, 2);
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].table, "strategy_thread_resources");
  assertEquals(inserts[0].rows.length, 2);
  assertEquals(inserts[0].rows[0].source_type, "cited");
  assertEquals(inserts[0].rows[0].user_id, "user-1");
  assertEquals(inserts[0].rows[0].thread_id, "thread-1");
  // Dedupe-read happened first
  assertEquals(reads.length, 1);
  assertEquals(reads[0].vals.sort(), ["a", "b"]);
});

Deno.test("recordResourceUsage: skips ids already written for the same thread", async () => {
  const inserts: any[] = [];
  const stub: any = {
    from: (_t: string) => {
      const b: any = {
        select: (_c: string) => b,
        eq: () => b,
        in: () => Promise.resolve({ data: [{ resource_id: "a" }, { resource_id: "b" }] }),
        insert: (rows: any[]) => { inserts.push(rows); return Promise.resolve({ error: null }); },
      };
      return b;
    },
  };
  const out = await recordResourceUsage(stub, {
    userId: "u", threadId: "t", resourceIds: ["a", "b", "c"],
  });
  assertEquals(out.inserted, 1);
  assertEquals(inserts[0].length, 1);
  assertEquals(inserts[0][0].resource_id, "c");
});

Deno.test("recordResourceUsage: empty input is a no-op", async () => {
  const stub: any = { from: (_t: string) => { throw new Error("should not query"); } };
  const out = await recordResourceUsage(stub, { userId: "u", threadId: "t", resourceIds: [] });
  assertEquals(out.inserted, 0);
});

Deno.test("retrieveResourceContext: prior_use branch queries strategy_thread_resources when accountId present", async () => {
  const seenTables: string[] = [];
  const stub: any = {
    from: (table: string) => {
      seenTables.push(table);
      const b: any = {
        select: (_c: string) => b,
        eq: () => b,
        in: () => Promise.resolve({ data: [{ id: "r1", title: "Prior Resource", description: null, resource_type: "template", is_template: false, template_category: null, account_id: null, opportunity_id: null, tags: null }] }),
        ilike: () => b,
        order: () => b,
        limit: () => {
          if (table === "strategy_thread_resources") {
            return Promise.resolve({ data: [{ resource_id: "r1", thread_id: "other-thread", created_at: new Date().toISOString() }] });
          }
          return Promise.resolve({ data: [] });
        },
      };
      return b;
    },
  };
  const out = await retrieveResourceContext(stub, "u", {
    userMessage: "use the same template we used last time",
    accountId: "acct-1",
    threadId: "current-thread",
  });
  assert(seenTables.includes("strategy_thread_resources"), `expected prior-use query; tables=${seenTables.join(",")}`);
  assert(out.hits.some((h) => h.matchKind === "prior_use"), `expected a prior_use hit; got ${JSON.stringify(out.hits.map((h) => h.matchKind))}`);
});

Deno.test("retrieveResourceContext: prior_use excludes resources from the current thread", async () => {
  const stub: any = {
    from: (table: string) => {
      const b: any = {
        select: (_c: string) => b,
        eq: () => b,
        in: () => Promise.resolve({ data: [] }),
        ilike: () => b,
        order: () => b,
        limit: () => {
          if (table === "strategy_thread_resources") {
            // Both rows belong to the *current* thread → must be filtered out.
            return Promise.resolve({
              data: [
                { resource_id: "r1", thread_id: "current-thread", created_at: new Date().toISOString() },
                { resource_id: "r2", thread_id: "current-thread", created_at: new Date().toISOString() },
              ],
            });
          }
          return Promise.resolve({ data: [] });
        },
      };
      return b;
    },
  };
  const out = await retrieveResourceContext(stub, "u", {
    userMessage: "use the same template we used last time",
    accountId: "acct-1",
    threadId: "current-thread",
  });
  assert(!out.hits.some((h) => h.matchKind === "prior_use"), `expected no prior_use hits; got ${JSON.stringify(out.hits)}`);
});

// ── Body search (description / content) ──────────────────────────

Deno.test("retrieveResourceContext: body search finds resource when title misses", async () => {
  const stub: any = {
    from: (table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        ilike: (_col: string, val: string) => { b._lastIlike = String(val); b._lastOr = undefined; return b; },
        or: (val: string) => { b._lastOr = val; return b; },
        in: () => b,
        order: () => b,
        limit: () => {
          if (table !== "resources") return Promise.resolve({ data: [] });
          if (b._lastOr) {
            return Promise.resolve({
              data: [{
                id: "r-body", title: "How Top Reps Win Renewals",
                description: "renewal motion",
                content: "...the ROI calculation that justifies demand requires...",
                resource_type: "transcript",
              }],
            });
          }
          if (b._lastIlike && b._lastIlike.toLowerCase().includes("kevin")) {
            return Promise.resolve({
              data: [{
                id: "r-title", title: "Cloning Your Top Reps (Kevin Dorsey)",
                description: "podcast", resource_type: "transcript",
              }],
            });
          }
          return Promise.resolve({ data: [] });
        },
      };
      return b;
    },
  };
  const out = await retrieveResourceContext(stub, "u", {
    userMessage: "the Kevin Dorsey thing about ROI",
  });
  const kinds = out.hits.map((h) => h.matchKind);
  assert(out.hits.some((h) => h.id === "r-body"), `expected body row; got ${JSON.stringify(out.hits)}`);
  assert(
    kinds.includes("content_match") || kinds.includes("description_match"),
    `expected body match kind; got ${JSON.stringify(kinds)}`,
  );
  const titleIdx = out.hits.findIndex((h) => h.id === "r-title");
  const bodyIdx = out.hits.findIndex((h) => h.id === "r-body");
  if (titleIdx >= 0 && bodyIdx >= 0) {
    assert(titleIdx < bodyIdx, "title match must rank above body match");
  }
});

Deno.test("renderResourceContextBlock: surfaces body-match flag and snippet", () => {
  const block = renderResourceContextBlock({
    hits: [{
      id: "abcd1234-xxxx", title: "Some Renewal Talk",
      description: null, resource_type: "transcript",
      is_template: null, template_category: null,
      account_id: null, opportunity_id: null, tags: null,
      matchKind: "content_match",
      matchReason: 'Phrase "ROI" appears in resource body',
      matchSnippet: "…the ROI calculation that justifies demand requires…",
    }],
    userAskedForResource: true,
    extractedPhrases: ["ROI"],
    inferredCategories: ["roi"],
  });
  assertStringIncludes(block, "body-match");
  assertStringIncludes(block, "snippet:");
  assertStringIncludes(block, "ROI calculation");
  assertStringIncludes(block, "body, not the title");
});

// ── Source-shape detection ────────────────────────────────────────

Deno.test("detectSourceShape: empty body → empty", () => {
  const out = detectSourceShape("");
  assertEquals(out.shape, "empty");
});

Deno.test("detectSourceShape: transcript resource_type → unstructured even if it has a heading", () => {
  const body = "# Episode 540\nHost: Welcome back. Today we talk about cold calling.\nGuest: Thanks for having me.\nHost: Let's dive in.";
  const out = detectSourceShape(body, { resource_type: "transcript" });
  assertEquals(out.shape, "unstructured");
});

Deno.test("detectSourceShape: dialogue markers → unstructured", () => {
  const body = "Host: Welcome.\nGuest: Hi.\nHost: Tell me about discovery.\nGuest: Sure, the first thing I do is...\nHost: Interesting.\nGuest: Then I ask about budget.";
  const out = detectSourceShape(body);
  assertEquals(out.shape, "unstructured");
});

Deno.test("detectSourceShape: business-case style → structured", () => {
  const body = `# FTD Q2 Business Case
## Situation
Customer is at 50 seats and growing 30% QoQ.
## Ask
Expand to 200 seats with multi-year commit.
## Value
Projected $480K ARR uplift, 6-month payback.
## Outcome
Champion presents to CFO in week 3.`;
  const out = detectSourceShape(body, { resource_type: "document" });
  assertEquals(out.shape, "structured");
});

Deno.test("detectSourceShape: is_template=true → structured", () => {
  const out = detectSourceShape("Just a paragraph of text.", { is_template: true });
  assertEquals(out.shape, "structured");
});

Deno.test("detectSourceShape: presentation resource_type → structured", () => {
  const out = detectSourceShape("Slide content here.", { resource_type: "presentation" });
  assertEquals(out.shape, "structured");
});

Deno.test("renderResourceContextBlock: emits STRUCTURED contract for structured picked resources", () => {
  const block = renderResourceContextBlock({
    hits: [{
      id: "p-1", title: "FTD Q2 Business Case",
      description: null, resource_type: "document",
      is_template: null, template_category: null,
      account_id: null, opportunity_id: null, tags: null,
      matchKind: "picked",
      matchReason: "User picked from /library this turn",
      bodyExcerpt: "## Situation\n## Ask\n## Value",
      sourceShape: "structured",
      sourceShapeReason: "3 md-headings, labeled-section lines",
    }],
    userAskedForResource: true,
    extractedPhrases: [],
    inferredCategories: [],
  });
  assertStringIncludes(block, "source-shape: structured");
  assertStringIncludes(block, "STRUCTURED SOURCE");
  assertStringIncludes(block, "Mirror the source's actual section structure");
  assertStringIncludes(block, "NEVER respond with only a question");
});

Deno.test("renderResourceContextBlock: emits UNSTRUCTURED contract for transcript picked resources", () => {
  const block = renderResourceContextBlock({
    hits: [{
      id: "p-2", title: "#540 Cold Call Masterclass",
      description: null, resource_type: "transcript",
      is_template: null, template_category: null,
      account_id: null, opportunity_id: null, tags: null,
      matchKind: "picked",
      matchReason: "User picked from /library this turn",
      bodyExcerpt: "Host: Let's break down a cold opener... Guest: I always lead with...",
      sourceShape: "unstructured",
      sourceShapeReason: "resource_type=transcript",
    }],
    userAskedForResource: true,
    extractedPhrases: [],
    inferredCategories: [],
  });
  assertStringIncludes(block, "source-shape: unstructured");
  assertStringIncludes(block, "UNSTRUCTURED SOURCE");
  assertStringIncludes(block, "EXTRACT the reusable substance");
  assertStringIncludes(block, 'NEVER answer only with "I need a fact');
});

// ════════════════════════════════════════════════════════════════
// Library Lookup — end-to-end behavior tests
//
// These tests pin down the targeted-lookup contract so the
// "I can offer a lookup" → "I can't perform that lookup" regression
// can never happen again.
//
// They cover:
//   A. Direct lookup intent → real DB-backed counts returned
//   B. Offer + "yes" → pending action resumes & executes
//   C. Negative reply → no lookup
//   D. List intent → preview list returned
//   E. Affirmative detector boundaries (avoid false positives)
//   F. Capability rule present in chat prompt
// ════════════════════════════════════════════════════════════════

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPendingLookupAction,
  buildStrategyChatSystemPrompt,
  detectAffirmative,
  detectLookupIntent,
  detectNegative,
  pendingActionToIntent,
  renderLookupResultText,
  runLibraryLookup,
} from "../_shared/strategy-core/index.ts";

// ──────────────────────────────────────────────────────────────────
// Fake supabase client — only implements the .from().select().eq().or()
// chain that runLibraryLookup uses, plus head:true count semantics.
// ──────────────────────────────────────────────────────────────────
function makeFakeSupabase(seed: {
  resources: Array<{ id: string; user_id: string; title: string; description?: string; content?: string }>;
  knowledge_items: Array<{ id: string; user_id: string; title: string; tactic_summary?: string }>;
}) {
  function from(table: string) {
    const rows = (seed as any)[table] ?? [];
    const state: any = { table, filters: [] as Array<(r: any) => boolean>, count: false, head: false, limit: undefined };
    const builder: any = {
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count === "exact") state.count = true;
        if (opts?.head) state.head = true;
        return builder;
      },
      eq(col: string, val: any) {
        state.filters.push((r: any) => r[col] === val);
        return builder;
      },
      or(expr: string) {
        // expr like "title.ilike.%cold%,description.ilike.%cold%,..."
        const clauses = expr.split(",").map((c) => {
          const [field, op, ...rest] = c.split(".");
          const pattern = rest.join(".").replace(/^%/, "").replace(/%$/, "").toLowerCase();
          return (r: any) => {
            const v = (r[field] ?? "").toString().toLowerCase();
            return op === "ilike" ? v.includes(pattern) : false;
          };
        });
        state.filters.push((r: any) => clauses.some((fn) => fn(r)));
        return builder;
      },
      order(_col: string, _opts: any) { return builder; },
      limit(n: number) { state.limit = n; return builder; },
      then(onFulfilled: (v: any) => void) {
        const filtered = rows.filter((r: any) => state.filters.every((fn: any) => fn(r)));
        if (state.count && state.head) {
          return Promise.resolve({ count: filtered.length, error: null, data: null }).then(onFulfilled);
        }
        const sliced = state.limit ? filtered.slice(0, state.limit) : filtered;
        return Promise.resolve({ data: sliced, error: null, count: filtered.length }).then(onFulfilled);
      },
    };
    return builder;
  }
  return { from };
}

const USER_ID = "user-1";
const FAKE = makeFakeSupabase({
  resources: [
    { id: "r1", user_id: USER_ID, title: "Cold Calling 101", description: "intro to cold calling", content: "" },
    { id: "r2", user_id: USER_ID, title: "Advanced cold calling openers", description: "" },
    { id: "r3", user_id: USER_ID, title: "Discovery call playbook", description: "" },
    { id: "r4", user_id: USER_ID, title: "Email templates", description: "" },
    { id: "rOther", user_id: "other", title: "cold calling for others", description: "" },
  ],
  knowledge_items: [
    { id: "k1", user_id: USER_ID, title: "Pattern interrupt for cold calling", tactic_summary: "pattern interrupt on cold calling" },
    { id: "k2", user_id: USER_ID, title: "Objection handling: 'we already have a vendor'", tactic_summary: "objection handling tactic" },
    { id: "k3", user_id: USER_ID, title: "Discovery: pain question stack", tactic_summary: "" },
  ],
});

// ──────────────────────────────────────────────────────────────────
// A. Direct lookup intent → real DB-backed counts returned
// ──────────────────────────────────────────────────────────────────
Deno.test("lookup A: 'how many of my resources include cold calling?' → 2 resources", async () => {
  const intent = detectLookupIntent("How many of my resources include content related to cold calling?");
  assert(intent, "intent should be detected");
  assertEquals(intent!.kind, "count");
  assertEquals(intent!.target, "resources");
  assertStringIncludes(intent!.topic, "cold");

  const result = await runLibraryLookup(FAKE, USER_ID, intent!);
  assertEquals(result.resources_total, 2, "should count exactly the 2 user-scoped cold-calling resources");
  assertEquals(result.knowledge_items_total, null, "KIs should not be queried for resources-only intent");
  const text = renderLookupResultText(result);
  assertStringIncludes(text, "2 resource");
});

Deno.test("lookup A2: 'how many KIs about objection handling?' → 1 KI, scoped to user", async () => {
  const intent = detectLookupIntent("how many KIs do I have about objection handling?");
  assert(intent);
  assertEquals(intent!.target, "knowledge_items");
  const result = await runLibraryLookup(FAKE, USER_ID, intent!);
  assertEquals(result.knowledge_items_total, 1);
  assertEquals(result.resources_total, null);
});

// ──────────────────────────────────────────────────────────────────
// B. Offer + "yes" flow → pending action round-trips into intent
// ──────────────────────────────────────────────────────────────────
Deno.test("lookup B: pending action round-trips through buildPendingLookupAction → pendingActionToIntent", () => {
  const intent = detectLookupIntent("how many of my resources include content related to cold calling?")!;
  const pending = buildPendingLookupAction(intent);
  assertEquals(pending.pending_action, "resource_lookup");
  assertEquals(pending.lookup_type, "count");
  assertEquals(pending.target, "resources");

  const restored = pendingActionToIntent(pending);
  assert(restored);
  assertEquals(restored!.kind, intent.kind);
  assertEquals(restored!.target, intent.target);
  assertEquals(restored!.topic, intent.topic);
});

Deno.test("lookup B2: affirmative variants resume the pending action", () => {
  const variants = [
    "yes",
    "yep",
    "yeah",
    "sure",
    "okay",
    "ok",
    "do it",
    "run it",
    "go ahead",
    "go for it",
    "please do",
    "please run it",
    "sounds good",
    "let's do it",
    "yeah do it",
    "okay, run it",
    "yes please",
  ];
  for (const v of variants) {
    assert(detectAffirmative(v), `expected "${v}" → affirmative`);
  }
});

// ──────────────────────────────────────────────────────────────────
// C. Negative reply → clears
// ──────────────────────────────────────────────────────────────────
Deno.test("lookup C: negative variants clear the pending action and never count as affirmative", () => {
  const negs = ["no", "nope", "nah", "never mind", "nvm", "cancel", "skip", "don't", "not now", "not yet", "hold off"];
  for (const v of negs) {
    assert(detectNegative(v), `expected "${v}" → negative`);
    assert(!detectAffirmative(v), `"${v}" must NOT be affirmative`);
  }
});

// ──────────────────────────────────────────────────────────────────
// D. List intent → previews returned
// ──────────────────────────────────────────────────────────────────
Deno.test("lookup D: 'show me my resources about cold calling' → list with previews", async () => {
  const intent = detectLookupIntent("show me my resources about cold calling");
  assert(intent);
  assertEquals(intent!.kind, "list");
  assertEquals(intent!.target, "resources");

  const result = await runLibraryLookup(FAKE, USER_ID, intent!);
  assertEquals(result.resources_total, 2);
  assertEquals(result.resource_samples.length, 2);
  const text = renderLookupResultText(result);
  assertStringIncludes(text, "Resources matching");
  assertStringIncludes(text, "Cold Calling 101");
});

// ──────────────────────────────────────────────────────────────────
// E. Affirmative detector boundaries — avoid false positives
// ──────────────────────────────────────────────────────────────────
Deno.test("lookup E: long sentences are not treated as bare affirmatives", () => {
  // A topic-changing reply that happens to start with "yes" should
  // still be an affirmative (it's an explicit confirmation), but a
  // long unrelated question must NOT be:
  const longUnrelated = "By the way, can you draft me a cold-email template for a logistics CFO and also include three bullet points about ROI?";
  assert(!detectAffirmative(longUnrelated), "long unrelated message must not fire pending lookup");

  const empty = "";
  assert(!detectAffirmative(empty));

  // Pure thanks should not resume a lookup
  assert(!detectAffirmative("thanks"));
  assert(!detectAffirmative("got it"));
});

Deno.test("lookup E2: ambiguous yes-but-no is rejected", () => {
  // Contains both an affirmative lead and a negative — we treat as no.
  assert(!detectAffirmative("yes but actually never mind"));
});

// ──────────────────────────────────────────────────────────────────
// F. Capability rule present in chat prompt — guards against
//    contradictory "I can't run that lookup" replies after offers.
// ──────────────────────────────────────────────────────────────────
Deno.test("lookup F: chat prompt declares targeted-lookup capability is wired", () => {
  const sys = buildStrategyChatSystemPrompt({
    depth: "Standard",
    accountContext: "Account: Acme",
    libraryContext: "",
  });
  assertStringIncludes(sys, "TARGETED LIBRARY LOOKUP CAPABILITY");
  assertStringIncludes(sys, "system executes it immediately");
  assertStringIncludes(sys, "MUST NOT");
});

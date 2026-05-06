import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Inline the function to test — avoids importing the entire index.ts
function deriveChatManifestId(
  content: string,
  workspace: string | null,
  workflowType?: string | null,
): string | null {
  if (workflowType) {
    const wfMap: Record<string, string> = {
      deep_research: "account-research",
      account_plan: "account-research",
      territory_tiering: "account-research",
      opportunity_strategy: "conversation-pov",
      brainstorm: "commercial-insight",
      email_evaluation: "follow-up-email",
    };
    return wfMap[workflowType] ?? "conversation-pov";
  }

  const lower = (content || "").toLowerCase();
  if (/\b(meddicc|meddpicc|meddic)\b/.test(lower)) return "meddicc-review";
  if (/\b(demo)\b/.test(lower) && /\b(strat|plan|prep|approach|design|build|tailor)\b/.test(lower)) return "demo-strategy";
  if (/\bdemonstration\b/.test(lower)) return "demo-strategy";
  if (/\bdemo\s+(strategy|plan|prep)\b/.test(lower)) return "demo-strategy";
  if (/\b(objection|pushback|handle|overcome)\b/.test(lower)) return "objection-strategy";
  if (/\b(follow[\s-]?up|recap)\b/.test(lower) && /\b(email|message|note)\b/.test(lower)) return "follow-up-email";
  if (/\bdiscovery\s+(?:question|prep\s+question)/.test(lower)) return "discovery-questions";
  if (/\bquestion(?:s)?\s+to\s+ask\b/.test(lower)) return "discovery-questions";
  if (/\b(discovery|question|probe)\b/.test(lower) && /\b(question|list|prep|ask)\b/.test(lower)) return "discovery-questions";
  if (/\b(research|account\s+research|competitor|landscape)\b/.test(lower)) return "account-research";
  if (/\b(insight|commercial|value\s+prop)\b/.test(lower)) return "commercial-insight";

  if (workspace === "deep_research" || workspace === "library") return "account-research";
  return "conversation-pov";
}

// ── 1. demo-strategy ──────────────────────────────────────────
Deno.test("demo-strategy: 'demo strategy'", () => {
  assertEquals(deriveChatManifestId("Help me with a demo strategy for Acme", null), "demo-strategy");
});
Deno.test("demo-strategy: 'demo prep'", () => {
  assertEquals(deriveChatManifestId("I need demo prep for the VP call", null), "demo-strategy");
});
Deno.test("demo-strategy: 'demo plan'", () => {
  assertEquals(deriveChatManifestId("Build a demo plan for this persona", null), "demo-strategy");
});
Deno.test("demo-strategy: 'tailor the demo'", () => {
  assertEquals(deriveChatManifestId("Help me tailor the demo for the CFO", null), "demo-strategy");
});
Deno.test("demo-strategy: 'demonstration'", () => {
  assertEquals(deriveChatManifestId("Plan our product demonstration", null), "demo-strategy");
});

// ── 2. discovery-questions ────────────────────────────────────
Deno.test("discovery-questions: 'discovery questions'", () => {
  assertEquals(deriveChatManifestId("Give me discovery questions for Acme", null), "discovery-questions");
});
Deno.test("discovery-questions: 'questions to ask'", () => {
  assertEquals(deriveChatManifestId("What questions to ask the VP of Sales?", null), "discovery-questions");
});
Deno.test("discovery-questions: 'discovery prep questions'", () => {
  assertEquals(deriveChatManifestId("Generate discovery prep questions for this call", null), "discovery-questions");
});

// ── 3. meddicc-review ─────────────────────────────────────────
Deno.test("meddicc-review: 'meddicc'", () => {
  assertEquals(deriveChatManifestId("Run a MEDDICC review for the TJX deal", null), "meddicc-review");
});
Deno.test("meddicc-review: 'meddpicc'", () => {
  assertEquals(deriveChatManifestId("Score us on MEDDPICC criteria", null), "meddicc-review");
});

// ── 4. objection-strategy ─────────────────────────────────────
Deno.test("objection-strategy: 'objection'", () => {
  assertEquals(deriveChatManifestId("Help me handle this objection about price", null), "objection-strategy");
});

// ── 5. follow-up-email ────────────────────────────────────────
Deno.test("follow-up-email: 'follow up email'", () => {
  assertEquals(deriveChatManifestId("Draft a follow up email after the call", null), "follow-up-email");
});

// ── 6. account-research ───────────────────────────────────────
Deno.test("account-research: 'research'", () => {
  assertEquals(deriveChatManifestId("Do research on Sephora's digital strategy", null), "account-research");
});

// ── 7. commercial-insight ─────────────────────────────────────
Deno.test("commercial-insight: 'commercial insight'", () => {
  assertEquals(deriveChatManifestId("Generate a commercial insight about supply chain", null), "commercial-insight");
});

// ── 8. conversation-pov (default) ─────────────────────────────
Deno.test("conversation-pov: generic", () => {
  assertEquals(deriveChatManifestId("What should I say in the next meeting?", null), "conversation-pov");
});

// ── Workflow type mappings ─────────────────────────────────────
Deno.test("workflow: deep_research", () => {
  assertEquals(deriveChatManifestId("anything", null, "deep_research"), "account-research");
});
Deno.test("workflow: brainstorm", () => {
  assertEquals(deriveChatManifestId("anything", null, "brainstorm"), "commercial-insight");
});

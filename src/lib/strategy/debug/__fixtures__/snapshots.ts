/**
 * W9 — Snapshot fixtures
 *
 * Fully-populated W3–W7.5 metadata blocks for one chat message and
 * one task run. Used by snapshot tests to detect schema drift.
 *
 * NOTE: These fixtures reflect the contract the runtime emits today.
 * If a new field is added to a block, the corresponding schema in
 * `schemaValidators.ts` must be updated and the fixture extended.
 * Otherwise the snapshot test will fail loudly.
 */

export const CHAT_MESSAGE_FULL_META = {
  text: "Here is a grounded answer with citations.",
  sources_used: 4,
  retrieval_meta: {
    resourceHits: 3,
    kiHits: 12,
    sourceCount: 4,
    queryStrategy: "title_match+account_link",
    matchedTitles: ["MEDDIC Primer", "Discovery Standard"],
  },
  routing_decision: {
    mode: "long_form",
    actual_provider: "anthropic",
    actual_model: "claude-3.7-sonnet",
    system_prompt_tokens: 2840,
    fallbackUsed: false,
  },
  standard_context: {
    injected: true,
    exemplarSetId: "exset-chat-001",
    surface: "strategy-chat",
    approxTokens: 1850,
    exemplars: [
      { id: "ex-1", shortId: "EX1", score: 0.92 },
      { id: "ex-2", shortId: "EX2", score: 0.88 },
    ],
  },
  citation_audit: {
    modified: false,
    unverified: [],
    verified: ["MEDDIC Primer", "Discovery Standard"],
    citations_found: 2,
  },
  gate_check: {
    gates: [
      { id: "answer_first", passed: true },
      { id: "no_invented_facts", passed: true },
      { id: "cited_when_claimed", passed: true },
    ],
    passed_all: true,
  },
  calibration: {
    exemplarSetId: "exset-chat-001",
    overallVerdict: "on_standard",
    overallConfidence: "high",
    weightedScore: 0.86,
    dimensions: [
      { name: "specificity", score: 0.9 },
      { name: "structure", score: 0.82 },
    ],
  },
  escalation_suggestions: {
    suggestions: [],
    calibrationVerdict: "on_standard",
    calibrationConfidence: "high",
  },
  enforcement_dry_run: {
    workspace: "strategy",
    contractVersion: "v1",
    surface: "strategy-chat",
    totals: { evaluated: 5, wouldFire: 0, disabled: 0, errors: 0 },
    evaluations: [],
  },
} as const;

export const TASK_RUN_FULL_META = {
  ...CHAT_MESSAGE_FULL_META,
  sop: {
    enabled: true,
    inputCheck: { ok: true, missingFields: [] },
    outputCheck: { ok: true, sectionCount: 5 },
  },
} as const;

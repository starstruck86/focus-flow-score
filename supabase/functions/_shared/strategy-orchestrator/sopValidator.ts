// ════════════════════════════════════════════════════════════════
// SOP Validator — Phase 3A "SAFE BRIDGE" (shadow mode)
//
// These checks are PURE OBSERVATION ONLY. They never throw, never
// mutate state, and never block a run. Their job is to surface the
// gap between what the user-defined Discovery Prep SOP requires and
// what the inputs / generated draft actually contain — so we can
// gather signal before we decide to enforce anything.
//
// Inputs:  the structured DiscoveryPrepSopContract sent from the
//          client (see src/lib/strategy/strategyConfig.ts) — already
//          parsed into bullet arrays per heading.
// Outputs: a small JSON-serializable report safe to log.
//
// DO NOT add any side effects to this file.
// ════════════════════════════════════════════════════════════════

export interface SopContractLike {
  enabled?: boolean;
  nonNegotiables?: string[];
  requiredInputs?: string[];
  requiredOutputs?: string[];
  researchWorkflow?: string[];
  mandatoryChecks?: string[];
  metricsProtocol?: string[];
  pageOneCockpitRules?: string[];
  formattingRules?: string[];
  buildOrder?: string[];
  qaChecklist?: string[];
}

export interface SopInputCheckResult {
  ran: boolean;
  rules_total: number;
  required_inputs_total: number;
  required_inputs_present: number;
  required_inputs_missing: string[];
  matched_input_keys: string[];
  notes?: string;
}

export interface SopOutputCheckResult {
  ran: boolean;
  sections_total: number;
  required_outputs_total: number;
  required_outputs_satisfied: number;
  required_outputs_missing: string[];
  matched_section_names: string[];
  notes?: string;
}

// ── Helpers ─────────────────────────────────────────────────────

function lc(s: unknown): string {
  return typeof s === "string" ? s.toLowerCase() : "";
}

/** Loose token match: does `haystack` contain any of the meaningful
 *  tokens from `needle`? Used so an SOP line like
 *  "Company name and website" can match an inputs key like
 *  `company_name`. Tokens of length < 3 are ignored. */
function looselyMatches(haystack: string, needle: string): boolean {
  const h = lc(haystack);
  if (!h) return false;
  const tokens = lc(needle)
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  return tokens.some((t) => h.includes(t));
}

/** Flatten an inputs object into a single searchable blob (keys + values). */
function inputsHaystack(inputs: Record<string, unknown> | undefined | null): {
  keys: string[];
  blob: string;
} {
  if (!inputs || typeof inputs !== "object") return { keys: [], blob: "" };
  const keys: string[] = [];
  const parts: string[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (k.startsWith("__")) continue; // skip internal markers like __sop
    keys.push(k);
    parts.push(k);
    if (typeof v === "string") parts.push(v);
    else if (typeof v === "number" || typeof v === "boolean") parts.push(String(v));
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string") parts.push(item);
        else if (item && typeof item === "object") parts.push(JSON.stringify(item));
      }
    }
  }
  return { keys, blob: lc(parts.join(" \n ")) };
}

/** Flatten a draft into a single searchable blob (section names + content). */
function draftHaystack(draft: any): { sectionNames: string[]; blob: string } {
  const sectionNames: string[] = [];
  const parts: string[] = [];
  if (!draft || typeof draft !== "object") return { sectionNames, blob: "" };
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  for (const s of sections) {
    if (s?.name && typeof s.name === "string") {
      sectionNames.push(s.name);
      parts.push(s.name);
    }
    if (s?.id && typeof s.id === "string") parts.push(s.id);
    if (typeof s?.content === "string") parts.push(s.content);
    else if (s?.content && typeof s.content === "object") {
      try { parts.push(JSON.stringify(s.content)); } catch { /* ignore */ }
    }
  }
  return { sectionNames, blob: lc(parts.join(" \n ")) };
}

// ── Public API ──────────────────────────────────────────────────

/** Phase 3A: input validation in SHADOW MODE. Never blocks. */
export function validateSopInputs(
  inputs: Record<string, unknown> | undefined | null,
  sop: SopContractLike | null | undefined,
): SopInputCheckResult {
  if (!sop) {
    return {
      ran: false,
      rules_total: 0,
      required_inputs_total: 0,
      required_inputs_present: 0,
      required_inputs_missing: [],
      matched_input_keys: [],
      notes: "no_sop_attached",
    };
  }
  const required = Array.isArray(sop.requiredInputs) ? sop.requiredInputs : [];
  const { keys, blob } = inputsHaystack(inputs ?? undefined);
  const present: string[] = [];
  const missing: string[] = [];
  for (const rule of required) {
    if (looselyMatches(blob, rule)) present.push(rule);
    else missing.push(rule);
  }
  const rulesTotal =
    (sop.nonNegotiables?.length ?? 0) +
    required.length +
    (sop.requiredOutputs?.length ?? 0) +
    (sop.researchWorkflow?.length ?? 0) +
    (sop.mandatoryChecks?.length ?? 0) +
    (sop.metricsProtocol?.length ?? 0) +
    (sop.pageOneCockpitRules?.length ?? 0) +
    (sop.formattingRules?.length ?? 0) +
    (sop.buildOrder?.length ?? 0) +
    (sop.qaChecklist?.length ?? 0);
  return {
    ran: true,
    rules_total: rulesTotal,
    required_inputs_total: required.length,
    required_inputs_present: present.length,
    required_inputs_missing: missing,
    matched_input_keys: keys,
  };
}

/** Phase 3A: output validation in SHADOW MODE. Never blocks. */
export function validateDraftAgainstSop(
  draft: any,
  sop: SopContractLike | null | undefined,
): SopOutputCheckResult {
  if (!sop) {
    return {
      ran: false,
      sections_total: 0,
      required_outputs_total: 0,
      required_outputs_satisfied: 0,
      required_outputs_missing: [],
      matched_section_names: [],
      notes: "no_sop_attached",
    };
  }
  const required = Array.isArray(sop.requiredOutputs) ? sop.requiredOutputs : [];
  const { sectionNames, blob } = draftHaystack(draft);
  const satisfied: string[] = [];
  const missing: string[] = [];
  for (const rule of required) {
    if (looselyMatches(blob, rule)) satisfied.push(rule);
    else missing.push(rule);
  }
  return {
    ran: true,
    sections_total: sectionNames.length,
    required_outputs_total: required.length,
    required_outputs_satisfied: satisfied.length,
    required_outputs_missing: missing,
    matched_section_names: sectionNames,
  };
}

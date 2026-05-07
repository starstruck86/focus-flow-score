// ════════════════════════════════════════════════════════════════
// Phase 4G-2 — Section Canonicalizer
//
// Normalizes LLM-generated section names/ids to their canonical
// equivalents BEFORE the artifact gate evaluates them. Solves the
// class of false template_fidelity failures caused by the LLM
// renaming sections slightly ("Executive Summary" vs "Executive
// Snapshot" vs "Exec Summary").
// ════════════════════════════════════════════════════════════════

import { DISCOVERY_PREP_SECTIONS } from "./handlers/discoveryPrepTemplate.ts";
import { ACCOUNT_BRIEF_SECTIONS, NINETY_DAY_PLAN_SECTIONS } from "./sectionAuthor.ts";

// ── Types ────────────────────────────────────────────────────────

export interface CanonicalMapping {
  canonical_id: string;
  canonical_name: string;
  source_name: string;
  source_id: string;
  was_remapped: boolean;
}

export interface CanonicalizationResult {
  sections: any[];
  mappings: CanonicalMapping[];
  remapped_count: number;
  unrecognized: string[];
}

// ── Alias Registry ──────────────────────────────────────────────
// Maps normalized (lowercase, no punctuation, collapsed whitespace)
// aliases to canonical section ids.

const ALIAS_REGISTRY: Record<string, string> = {
  // cockpit
  "page1cockpit": "cockpit",
  "page1": "cockpit",
  "cockpitoverview": "cockpit",
  "cockpitsummary": "cockpit",

  // cover
  "prepdoccover": "cover",
  "coverpage": "cover",
  "titlepage": "cover",
  "prepcover": "cover",

  // participants
  "participantlist": "participants",
  "meetingparticipants": "participants",
  "attendees": "participants",

  // cx_audit
  "cxauditcheck": "cx_audit",
  "cxaudit": "cx_audit",
  "customerexperienceaudit": "cx_audit",

  // executive_snapshot
  "executivesnapshot": "executive_snapshot",
  "execsnapshot": "executive_snapshot",
  "executivesummary": "executive_snapshot",
  "execsummary": "executive_snapshot",
  "executiveoverview": "executive_snapshot",

  // value_selling
  "valuesellingobservationsframework": "value_selling",
  "valuesellingobservations": "value_selling",
  "valueselling": "value_selling",
  "valueframework": "value_selling",

  // discovery_questions
  "discovery1questions": "discovery_questions",
  "discoveryquestions": "discovery_questions",
  "preparedquestions": "discovery_questions",

  // customer_examples
  "customerexamples": "customer_examples",
  "customerstories": "customer_examples",
  "casestudies": "customer_examples",

  // pivot_statements
  "pivotstatements": "pivot_statements",
  "pivots": "pivot_statements",

  // objection_handling
  "objectionhandling": "objection_handling",
  "objections": "objection_handling",
  "objectionresponses": "objection_handling",

  // marketing_team
  "marketingteammembers": "marketing_team",
  "marketingteam": "marketing_team",

  // exit_criteria
  "exitcriteriameddpicc": "exit_criteria",
  "exitcriteria": "exit_criteria",
  "meddpicc": "exit_criteria",

  // revenue_pathway
  "revenuepathwaysensitivity": "revenue_pathway",
  "revenuepathway": "revenue_pathway",
  "revenueanalysis": "revenue_pathway",

  // metrics_intelligence
  "metricsintelligence": "metrics_intelligence",
  "metricsanalysis": "metrics_intelligence",

  // loyalty_analysis
  "loyaltyprogramanalysis": "loyalty_analysis",
  "loyaltyanalysis": "loyalty_analysis",

  // tech_stack
  "techstackconsolidation": "tech_stack",
  "techstack": "tech_stack",
  "technologystack": "tech_stack",

  // competitive_war_game
  "competitivewargame": "competitive_war_game",
  "competitiveanalysis": "competitive_war_game",
  "wargame": "competitive_war_game",

  // hypotheses_risks
  "hypothesesblockersriskheatmap": "hypotheses_risks",
  "hypothesesrisks": "hypotheses_risks",
  "riskheatmap": "hypotheses_risks",
  "hypotheses": "hypotheses_risks",
  "risks": "hypotheses_risks",

  // appendix
  "appendixdeepresearch": "appendix",
  "deepresearch": "appendix",
  "researchappendix": "appendix",

  // account_brief sections
  "companysnapshot": "company_snapshot",
  "stakeholdersonfile": "stakeholders",
  "stakeholdermap": "stakeholders",
  "operatorread": "operator_read",
  "nextmoves": "next_moves",
  "nextsteps": "next_moves",

  // ninety_day_plan sections
  "accountcontext": "account_context",
  "days130learn": "days_1_30",
  "days130": "days_1_30",
  "days3160engage": "days_31_60",
  "days3160": "days_31_60",
  "days6190advance": "days_61_90",
  "days6190": "days_61_90",
};

/**
 * Normalize a string for alias lookup: lowercase, strip non-alphanumeric,
 * collapse whitespace.
 */
function normalizeForLookup(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Resolve a section id/name to its canonical section id.
 * Tries exact id match first, then normalized alias lookup.
 */
function resolveCanonicalId(
  idOrName: string,
  validIds: Set<string>,
): { canonical_id: string; was_remapped: boolean } | null {
  // Exact id match
  if (validIds.has(idOrName)) {
    return { canonical_id: idOrName, was_remapped: false };
  }

  // Underscore-collapsed match (e.g. "executive snapshot" → "executive_snapshot")
  const underscored = idOrName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (validIds.has(underscored)) {
    return { canonical_id: underscored, was_remapped: idOrName !== underscored };
  }

  // Alias lookup
  const normalized = normalizeForLookup(idOrName);
  const aliasHit = ALIAS_REGISTRY[normalized];
  if (aliasHit && validIds.has(aliasHit)) {
    return { canonical_id: aliasHit, was_remapped: true };
  }

  return null;
}

/**
 * Get the valid section definitions for a task type.
 */
function getSectionsForTask(taskType: string): ReadonlyArray<{ id: string; name: string }> {
  switch (taskType) {
    case "discovery_prep": return DISCOVERY_PREP_SECTIONS;
    case "account_brief": return ACCOUNT_BRIEF_SECTIONS;
    case "ninety_day_plan": return NINETY_DAY_PLAN_SECTIONS;
    default: return DISCOVERY_PREP_SECTIONS;
  }
}

/**
 * Canonicalize a single section name to its canonical id.
 */
export function canonicalizeSectionName(
  name: string,
  taskType: string = "discovery_prep",
): { canonical_id: string; was_remapped: boolean } | null {
  const sections = getSectionsForTask(taskType);
  const validIds = new Set(sections.map(s => s.id));
  return resolveCanonicalId(name, validIds);
}

/**
 * Canonicalize all sections in a draft output.
 * Remaps section ids and names to canonical equivalents.
 * Returns a new sections array (does not mutate input).
 */
export function canonicalizeDraftSections(
  sections: any[],
  taskType: string = "discovery_prep",
): CanonicalizationResult {
  const sectionDefs = getSectionsForTask(taskType);
  const validIds = new Set(sectionDefs.map(s => s.id));
  const nameMap = new Map(sectionDefs.map(s => [s.id, s.name]));

  const mappings: CanonicalMapping[] = [];
  const unrecognized: string[] = [];
  const seen = new Set<string>();
  const canonicalized: any[] = [];

  for (const section of sections) {
    if (!section || typeof section !== "object") continue;

    const sourceId = String(section.id ?? "");
    const sourceName = String(section.name ?? sourceId);

    // Try resolving by id first, then by name
    let resolved = resolveCanonicalId(sourceId, validIds);
    if (!resolved) {
      resolved = resolveCanonicalId(sourceName, validIds);
    }

    if (resolved) {
      // Skip duplicates
      if (seen.has(resolved.canonical_id)) continue;
      seen.add(resolved.canonical_id);

      const canonicalName = nameMap.get(resolved.canonical_id) ?? sourceName;
      mappings.push({
        canonical_id: resolved.canonical_id,
        canonical_name: canonicalName,
        source_name: sourceName,
        source_id: sourceId,
        was_remapped: resolved.was_remapped,
      });

      canonicalized.push({
        ...section,
        id: resolved.canonical_id,
        name: canonicalName,
      });
    } else {
      unrecognized.push(sourceId || sourceName);
      canonicalized.push(section);
    }
  }

  return {
    sections: canonicalized,
    mappings,
    remapped_count: mappings.filter(m => m.was_remapped).length,
    unrecognized,
  };
}

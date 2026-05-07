// ════════════════════════════════════════════════════════════════
// Phase 4G-2 — Section Integrity Analyzer
//
// Analyzes generated draft outputs BEFORE gate enforcement to
// detect structural problems: missing sections, duplicates,
// renamed sections, malformed IDs, empty sections, ordering
// violations, and batch merge corruption.
// ════════════════════════════════════════════════════════════════

import { DISCOVERY_PREP_SECTIONS } from "./handlers/discoveryPrepTemplate.ts";
import { ACCOUNT_BRIEF_SECTIONS, NINETY_DAY_PLAN_SECTIONS } from "./sectionAuthor.ts";

// ── Types ────────────────────────────────────────────────────────

export interface SectionIntegrityResult {
  missing_sections: string[];
  duplicated_sections: string[];
  malformed_sections: string[];
  empty_sections: string[];
  unexpected_sections: string[];
  ordering_violations: string[];
  integrity_pass: boolean;
  sections_present: number;
  sections_expected: number;
}

// ── Helpers ──────────────────────────────────────────────────────

function getSectionDefs(taskType: string): ReadonlyArray<{ id: string; name: string }> {
  switch (taskType) {
    case "discovery_prep": return DISCOVERY_PREP_SECTIONS;
    case "account_brief": return ACCOUNT_BRIEF_SECTIONS;
    case "ninety_day_plan": return NINETY_DAY_PLAN_SECTIONS;
    default: return DISCOVERY_PREP_SECTIONS;
  }
}

function isEmptyContent(content: unknown): boolean {
  if (content === null || content === undefined) return true;
  if (typeof content === "string") return content.trim().length === 0;
  if (typeof content === "object") {
    if ((content as any)?._authoring_failed) return true;
    const text = JSON.stringify(content);
    return text.length < 20;
  }
  return false;
}

// ── Main Analyzer ───────────────────────────────────────────────

/**
 * Analyze the structural integrity of a draft output.
 * Run AFTER canonicalization, BEFORE artifact gate.
 */
export function analyzeSectionIntegrity(
  draftOutput: any,
  taskType: string = "discovery_prep",
): SectionIntegrityResult {
  const sectionDefs = getSectionDefs(taskType);
  const expectedIds = sectionDefs.map(s => s.id);
  const expectedSet = new Set(expectedIds);

  const sections: any[] = Array.isArray(draftOutput?.sections) ? draftOutput.sections : [];

  const missing: string[] = [];
  const duplicated: string[] = [];
  const malformed: string[] = [];
  const empty: string[] = [];
  const unexpected: string[] = [];
  const ordering: string[] = [];

  const seenIds = new Set<string>();
  const idOrder: string[] = [];

  for (const section of sections) {
    if (!section || typeof section !== "object") {
      malformed.push(`non-object section: ${JSON.stringify(section)?.slice(0, 50)}`);
      continue;
    }

    const id = String(section.id ?? "");

    // Malformed id check
    if (!id || id === "undefined" || id === "null" || id.includes(" ")) {
      malformed.push(id || "(empty)");
      continue;
    }

    // Duplicate check
    if (seenIds.has(id)) {
      duplicated.push(id);
      continue;
    }
    seenIds.add(id);
    idOrder.push(id);

    // Unexpected section check
    if (!expectedSet.has(id)) {
      unexpected.push(id);
    }

    // Empty content check
    if (isEmptyContent(section.content)) {
      empty.push(id);
    }
  }

  // Missing sections
  for (const eid of expectedIds) {
    if (!seenIds.has(eid)) {
      missing.push(eid);
    }
  }

  // Ordering violations — check that present sections maintain expected order
  const expectedOrder = expectedIds.filter(id => idOrder.includes(id));
  let orderIdx = 0;
  for (const id of idOrder) {
    if (!expectedSet.has(id)) continue;
    if (orderIdx < expectedOrder.length && expectedOrder[orderIdx] === id) {
      orderIdx++;
    } else {
      ordering.push(`${id} out of expected order`);
    }
  }

  const integrity_pass =
    missing.length === 0 &&
    duplicated.length === 0 &&
    malformed.length === 0 &&
    empty.length === 0;

  return {
    missing_sections: missing,
    duplicated_sections: duplicated,
    malformed_sections: malformed,
    empty_sections: empty,
    unexpected_sections: unexpected,
    ordering_violations: ordering,
    integrity_pass,
    sections_present: seenIds.size,
    sections_expected: expectedIds.length,
  };
}

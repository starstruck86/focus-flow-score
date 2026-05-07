// ════════════════════════════════════════════════════════════════
// Phase 4G-2 — Batch Output Validator
//
// Validates each batch's parsed output INDEPENDENTLY before merge.
// Catches structural corruption at the batch boundary so bad batches
// don't poison the full document.
// ════════════════════════════════════════════════════════════════

export interface BatchViolation {
  type: "missing_sections_array" | "invalid_json" | "missing_section" | "duplicate_section" |
        "empty_content" | "malformed_id" | "unexpected_section";
  detail: string;
  section_id?: string;
}

export interface BatchValidationResult {
  pass: boolean;
  retryable: boolean;
  violations: BatchViolation[];
  sections_returned: string[];
  sections_expected: string[];
}

/**
 * Validate a single batch's parsed output.
 *
 * @param parsed - The parsed JSON output from the LLM (should have `sections` array)
 * @param expectedSectionIds - The section ids this batch was supposed to produce
 */
export function validateBatchOutput(
  parsed: unknown,
  expectedSectionIds: string[],
): BatchValidationResult {
  const violations: BatchViolation[] = [];
  const expectedSet = new Set(expectedSectionIds);

  // Check: valid object with sections array
  if (!parsed || typeof parsed !== "object") {
    return {
      pass: false,
      retryable: true,
      violations: [{ type: "invalid_json", detail: "Parsed output is not an object" }],
      sections_returned: [],
      sections_expected: expectedSectionIds,
    };
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.sections)) {
    return {
      pass: false,
      retryable: true,
      violations: [{ type: "missing_sections_array", detail: "No 'sections' array in output" }],
      sections_returned: [],
      sections_expected: expectedSectionIds,
    };
  }

  const sections = obj.sections as any[];
  const returnedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const section of sections) {
    if (!section || typeof section !== "object") continue;

    const id = String(section.id ?? "");

    // Malformed id
    if (!id || id === "undefined" || id === "null") {
      violations.push({ type: "malformed_id", detail: `Section has invalid id: ${JSON.stringify(section.id)}` });
      continue;
    }

    // Duplicate
    if (seenIds.has(id)) {
      violations.push({ type: "duplicate_section", detail: `Duplicate section id: ${id}`, section_id: id });
      continue;
    }
    seenIds.add(id);
    returnedIds.push(id);

    // Unexpected section
    if (!expectedSet.has(id)) {
      violations.push({ type: "unexpected_section", detail: `Section "${id}" not in expected set`, section_id: id });
    }

    // Empty content
    if (isEmptyContent(section.content)) {
      violations.push({ type: "empty_content", detail: `Section "${id}" has empty content`, section_id: id });
    }
  }

  // Missing sections
  for (const expected of expectedSectionIds) {
    if (!seenIds.has(expected)) {
      violations.push({ type: "missing_section", detail: `Expected section "${expected}" not returned`, section_id: expected });
    }
  }

  const hasCritical = violations.some(v =>
    v.type === "missing_section" || v.type === "missing_sections_array" || v.type === "invalid_json"
  );

  return {
    pass: violations.length === 0,
    retryable: hasCritical,
    violations,
    sections_returned: returnedIds,
    sections_expected: expectedSectionIds,
  };
}

/**
 * Check if content is effectively empty.
 */
function isEmptyContent(content: unknown): boolean {
  if (content === null || content === undefined) return true;
  if (typeof content === "string") return content.trim().length === 0;
  if (typeof content === "object") {
    // Check for authoring_failed placeholder
    if ((content as any)?._authoring_failed) return true;
    // Check if object has any substantive string content
    const text = JSON.stringify(content);
    // Very short JSON is likely empty/placeholder
    return text.length < 20;
  }
  return false;
}

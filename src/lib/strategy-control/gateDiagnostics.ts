/**
 * Phase 3 — Gate Diagnostic Intelligence.
 *
 * Structured diagnostics for artifact gate failures.
 * Universal across all manifests — no manifest-specific branching.
 *
 * DOES NOT modify: scorer, synthesis, methodologySeeds.
 */

// ═══════════════════════════════════════════════════════════════════
// Diagnostic types
// ═══════════════════════════════════════════════════════════════════

export interface GateSectionDiagnostic {
  dimension: string;
  requirement: string;
  reason: string;
  matched_excerpt: string;
  remediation: string;
}

export interface SectionLevelGateTelemetry {
  sections_checked: string[];
  sections_passed: string[];
  sections_failed: string[];
  diagnostics: GateSectionDiagnostic[];
}

// ═══════════════════════════════════════════════════════════════════
// Diagnostic extraction — works on any GateDiagnostic[] output
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse raw gate diagnostics into structured section-level telemetry.
 * Universal — works with any manifest's mustHave requirements.
 */
export function extractSectionDiagnostics(
  gates: ReadonlyArray<{ gate: string; pass: boolean; diagnostics: string[] }>,
  mustHave: readonly string[],
): SectionLevelGateTelemetry {
  const diagnostics: GateSectionDiagnostic[] = [];
  const sectionsFailed = new Set<string>();
  const sectionsPassed = new Set<string>(mustHave);

  for (const gate of gates) {
    for (const diag of gate.diagnostics) {
      const parsed = parseDiagnosticString(diag, gate.gate);
      diagnostics.push(parsed);
      if (parsed.requirement) {
        sectionsFailed.add(parsed.requirement);
        sectionsPassed.delete(parsed.requirement);
      }
    }
  }

  return {
    sections_checked: [...mustHave],
    sections_passed: [...sectionsPassed],
    sections_failed: [...sectionsFailed],
    diagnostics,
  };
}

/**
 * Parse a raw diagnostic string into a structured GateSectionDiagnostic.
 * Deterministic — no LLM, no heuristics.
 */
function parseDiagnosticString(
  diag: string,
  dimension: string,
): GateSectionDiagnostic {
  // Extract requirement from diagnostic patterns
  const reqMatch = diag.match(/(?:Missing required (?:element|section)|Section) "([^"]+)"/);
  const requirement = reqMatch?.[1] ?? extractRequirementFallback(diag);

  // Determine reason from diagnostic text
  const reason = deriveReason(diag, dimension);

  // Build remediation from reason + dimension
  const remediation = deriveRemediation(reason, requirement, dimension);

  // Extract any excerpt mentioned
  const excerptMatch = diag.match(/excerpt:\s*"([^"]+)"/);
  const matched_excerpt = excerptMatch?.[1] ?? "";

  return {
    dimension,
    requirement,
    reason,
    matched_excerpt,
    remediation,
  };
}

function extractRequirementFallback(diag: string): string {
  // Try common patterns
  const patterns = [
    /Section "([^"]+)"/,
    /Missing.*?"([^"]+)"/,
    /required.*?"([^"]+)"/i,
    /element.*?"([^"]+)"/i,
  ];
  for (const p of patterns) {
    const m = diag.match(p);
    if (m) return m[1];
  }
  // Return first significant phrase
  return diag.replace(/^(Missing|Section|Paragraph)\s*/i, "").slice(0, 60);
}

function deriveReason(diag: string, dimension: string): string {
  if (diag.includes("not found")) return "heading_absent";
  if (diag.includes("is a stub")) return "stub_content";
  if (diag.includes("is filler")) return "filler_detected";
  if (diag.includes("lacks substance")) return "lacks_substance";
  if (diag.includes("wall of text")) return "wall_of_text";
  if (diag.includes("dense prose")) return "dense_prose";
  if (diag.includes("no causal reasoning")) return "citation_without_causality";
  if (diag.includes("citations (max")) return "citation_overuse";
  if (diag.includes("Missing required element")) return "heading_absent";
  if (diag.includes("Missing required section")) return "key_missing";
  if (dimension === "readability") return "readability_violation";
  return "content_gap";
}

function deriveRemediation(
  reason: string,
  requirement: string,
  dimension: string,
): string {
  const remediations: Record<string, string> = {
    heading_absent: `Add an explicit section or heading for "${requirement}"`,
    stub_content: `Expand "${requirement}" section with specific details, metrics, and stakeholder context (min 40 words)`,
    filler_detected: `Replace introductory filler in "${requirement}" with substantive content — data, stakeholders, causal reasoning`,
    lacks_substance: `Add metrics (percentages, dollar amounts), stakeholder names/titles, or causal reasoning to "${requirement}"`,
    wall_of_text: `Break "${requirement}" into shorter paragraphs with clear subheadings`,
    dense_prose: `Add bullet points, headers, or whitespace to improve readability`,
    citation_without_causality: `Add causal connectors (because, therefore, resulting in) near citations`,
    citation_overuse: `Distribute citations more evenly — max 3 per sentence`,
    key_missing: `Include a clearly labeled "${requirement}" section in the output`,
    readability_violation: `Improve formatting: shorter paragraphs, clear headings, structured lists`,
    content_gap: `Add explicit content addressing "${requirement}" with specifics relevant to the account`,
  };
  return remediations[reason] ?? `Address the ${dimension} issue for "${requirement}"`;
}

// ═══════════════════════════════════════════════════════════════════
// Prompt Correction Engine
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive additional authoring instructions from gate diagnostics.
 * Universal — no manifest-specific branching.
 * Deterministic — same diagnostics always produce the same corrections.
 * Additive — never removes existing instructions.
 */
export function derivePromptCorrections(
  diagnostics: GateSectionDiagnostic[],
): string[] {
  if (diagnostics.length === 0) return [];

  const corrections: string[] = [];
  const seen = new Set<string>();

  for (const d of diagnostics) {
    const key = `${d.reason}:${d.requirement}`;
    if (seen.has(key)) continue;
    seen.add(key);

    switch (d.reason) {
      case "heading_absent":
      case "key_missing":
        corrections.push(
          `CRITICAL: Include an explicit section labeled "${d.requirement}" with substantive content.`
        );
        break;
      case "stub_content":
        corrections.push(
          `Section "${d.requirement}" needs expansion — include specific metrics, stakeholder names, and business impact.`
        );
        break;
      case "filler_detected":
        corrections.push(
          `Do NOT start "${d.requirement}" with introductory phrasing. Lead with the most important insight or data point.`
        );
        break;
      case "lacks_substance":
        corrections.push(
          `"${d.requirement}" must contain at least one of: percentage/dollar metric, named stakeholder role, or causal business reasoning.`
        );
        break;
      case "wall_of_text":
      case "dense_prose":
        corrections.push(
          `Use bullet points or shorter paragraphs. Dense prose exceeds readability thresholds.`
        );
        break;
      case "citation_without_causality":
        corrections.push(
          `When citing sources, explain WHY the source matters — use "because", "therefore", "resulting in" near citations.`
        );
        break;
      case "citation_overuse":
        corrections.push(
          `Limit citations to 3 per sentence. Spread supporting evidence across multiple sentences.`
        );
        break;
      default:
        corrections.push(d.remediation);
    }
  }

  return corrections;
}

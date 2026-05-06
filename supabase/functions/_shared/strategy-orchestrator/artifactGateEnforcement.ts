/**
 * Phase 3.5D — Artifact Gate Enforcement (Production).
 *
 * Server-side artifact gate that runs AFTER generation.
 * Deterministic, pure, no LLM calls.
 * Mirrors src/lib/strategy-control/artifactGate.ts logic.
 *
 * Phase 3 fix: structured artifacts now extract ALL text from any JSON shape
 * and match mustHave concepts semantically — not by brittle key matching.
 */

export interface GateDiagnostic {
  gate: string;
  pass: boolean;
  diagnostics: string[];
}

export interface ArtifactGateResult {
  pass: boolean;
  gates: GateDiagnostic[];
  failed_dimensions: string[];
  sections_checked?: string[];
  sections_passed?: string[];
  sections_failed?: string[];
  diagnostics?: Array<{
    dimension: string;
    requirement: string;
    reason: string;
    matched_excerpt: string;
    remediation: string;
  }>;
}

export interface ArtifactManifest {
  rubric: { mustHave: readonly string[] };
  output: { shape: string; forbid?: readonly string[] };
}

// ── Shared helpers ────────────────────────────────────────────────

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Synonym map for semantic concept matching — universal, not manifest-specific. */
const SEMANTIC_SYNONYMS: Record<string, RegExp> = {
  "current state reasoning": /\b(?:currently|today|right now|existing|as of|status quo|operates?|current\s+state)\b/i,
  "current state": /\b(?:currently|today|right now|existing|as of|status quo|operates?)\b/i,
  "cost or risk": /\b(?:cost|risk|exposure|threat|consequence|price|penalty|loss)\b/i,
  "change hypothesis": /\b(?:change|hypothesis|shift|reframe|consolidat|transform)\b/i,
  "change vectors": /\b(?:change|shift|transform|pivot|evolv|transition|disrupt|reframe|vector)\b/i,
  "open question": /\b(?:question|\?|ask (?:the|their|about))\b/i,
  "strategic why": /\b(?:strategic|why now|urgency|compelling|imperative|catalyst)\b/i,
  "friction": /\b(?:friction|obstacle|barrier|blocker|resistance|challenge|headwind)\b/i,
  "cited sources": /\b(?:source|citation|cited|grounded in|RESEARCH\[|\[S\d|\[KI|\[PB|according to|per )\b/i,
  "verified signals": /\b(?:signal|indicator|evidence|data point|confirmed|validated|trend)\b/i,
  "commercial insight": /\b(?:commercial|insight|value|ROI|cost|savings|revenue|margin|impact)\b/i,
  "situation": /\b(?:situation|overview|snapshot|context|background|landscape)\b/i,
  "specific asks": /\b(?:ask|request|action|next step|recommend|call to action)\b/i,
  "risks": /\b(?:risk|threat|concern|exposure|vulnerability|downside)\b/i,
  "milestones": /\b(?:milestone|target|goal|deliverable|checkpoint|objective)\b/i,
  "stakeholder strategy": /\b(?:stakeholder|champion|sponsor|executive|buyer|influencer)\b/i,
  "metrics": /\b(?:metric|KPI|measure|indicator|benchmark|target)\b/i,
  "executive alignment": /\b(?:executive|alignment|sponsor|C-suite|leadership|board)\b/i,
  "expansion triggers": /\b(?:expand|upsell|cross-sell|grow|trigger|land.and.expand|adoption)\b/i,
};

/**
 * Recursively extract ALL text content from any JSON value.
 * Handles: strings, arrays, nested objects, wrapper formats, batch keys.
 */
function deepExtractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(deepExtractText).join("\n\n");
  if (typeof value === "object") {
    // Include keys as pseudo-headers so concept matching can find them
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const keyLabel = k.replace(/_/g, " ");
        return `## ${keyLabel}\n\n${deepExtractText(v)}`;
      })
      .join("\n\n");
  }
  return "";
}

/**
 * Parse output string into a flat text blob for semantic matching.
 * Handles code fences, raw JSON, wrapper formats, batch keys, and plain text.
 */
function extractSemanticText(output: string): string {
  const trimmed = output.trim();

  // Try code fence extraction first
  const fenceMatch = output.match(/```(?:json|structured_artifact)\s*([\s\S]*?)```/);
  const raw = fenceMatch ? fenceMatch[1].trim() : trimmed;

  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      return deepExtractText(parsed);
    } catch { /* fall through */ }
  }

  // Also try without fence
  if (!fenceMatch && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
    try {
      const parsed = JSON.parse(trimmed);
      return deepExtractText(parsed);
    } catch { /* fall through */ }
  }

  return output;
}

/**
 * Check if a mustHave concept is present in text using multi-layer matching:
 * 1. Exact phrase match
 * 2. Heading/bold match
 * 3. All significant words present
 * 4. Synonym expansion
 */
function conceptPresent(concept: string, text: string, rawText: string): boolean {
  const norm = concept.toLowerCase();
  const lower = text.toLowerCase();

  // 1. Exact phrase
  if (lower.includes(norm)) return true;

  // 2. Heading/bold match
  const headingPattern = new RegExp(
    `(?:^#+\\s*.*${norm.replace(/\s+/g, "\\s+")}|\\*\\*.*${norm.replace(/\s+/g, "\\s+")}.*\\*\\*)`,
    "im",
  );
  if (headingPattern.test(rawText) || headingPattern.test(text)) return true;

  // 3. All significant words present
  const words = norm.split(/\s+/).filter(w => w.length > 2);
  if (words.length >= 2 && words.every(w => lower.includes(w))) return true;

  // 4. Synonym expansion
  const synPattern = SEMANTIC_SYNONYMS[norm];
  if (synPattern && synPattern.test(text)) return true;

  return false;
}

// ── Gate 1: Template Fidelity ─────────────────────────────────────

export function checkTemplateFidelity(
  output: string,
  manifest: ArtifactManifest,
): GateDiagnostic {
  const mustHave = manifest.rubric.mustHave;
  const diagnostics: string[] = [];

  // For ALL shapes (structured_artifact, executive_brief, prose):
  // extract semantic text and use concept matching.
  const semanticText = extractSemanticText(output);

  for (const req of mustHave) {
    if (conceptPresent(req, semanticText, output)) continue;
    diagnostics.push(`Missing required element: "${req}"`);
  }

  return { gate: "template_fidelity", pass: diagnostics.length === 0, diagnostics };
}

// ── Gate 2: Readability ───────────────────────────────────────────

export function checkReadability(text: string): GateDiagnostic {
  const diagnostics: string[] = [];
  const semanticText = extractSemanticText(text);

  const paragraphs = semanticText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  let totalWords = 0;
  let denseWords = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    if (para.startsWith("```") || para.startsWith("{") || para.startsWith("[") || /^#+\s/.test(para)) continue;
    const words = para.split(/\s+/).length;
    totalWords += words;
    if (words > 120) {
      diagnostics.push(`Paragraph ${i + 1} has ${words} words (max 120)`);
    }
    const internalBreaks = (para.match(/\n/g) || []).length;
    if (words >= 200 && internalBreaks === 0) {
      diagnostics.push(`Paragraph ${i + 1} is a wall of text: ${words} words with no line breaks`);
    }
    if (words > 80) denseWords += words;
  }

  if (totalWords > 0 && denseWords / totalWords > 0.7) {
    diagnostics.push(`${Math.round((denseWords / totalWords) * 100)}% of content is dense prose (>70% threshold)`);
  }

  return { gate: "readability", pass: diagnostics.length === 0, diagnostics };
}

// ── Gate 3: Section Completeness ──────────────────────────────────

const FILLER_PATTERNS = [
  /^this section (?:covers|describes|explains|outlines)/i,
  /^in this section/i,
  /^(?:the following|below) (?:is|are|describes)/i,
  /^(?:here|this) (?:we|is where we) (?:will|discuss|examine|explore)/i,
];

const SUBSTANCE_PATTERNS = [
  /\b\d[\d,.]*%?\b/,
  /\b(?:VP|CEO|CFO|CRO|CTO|CMO|COO|GM|Director|Manager|Head of)\b/i,
  /\b(?:because|therefore|resulting in|which means|leading to|causing|driving|this creates|consequently)\b/i,
];

export function checkSectionCompleteness(
  output: string,
  mustHave: readonly string[],
): GateDiagnostic {
  const diagnostics: string[] = [];

  const semanticText = extractSemanticText(output);
  const lower = semanticText.toLowerCase();

  // Split into paragraphs for section-finding
  const paragraphs = semanticText.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  for (const req of mustHave) {
    const norm = req.toLowerCase();
    let sectionContent = "";

    // 1. Find by heading
    const headingPattern = new RegExp(
      `(?:^#+\\s*[^\\n]*${norm.replace(/\s+/g, "\\s+")}[^\\n]*|^[^\\n]*${norm.replace(/\s+/g, "\\s+")}[^\\n]*:)\\s*\\n([\\s\\S]*?)(?=\\n#+\\s|\\n[A-Z][A-Z\\s]+:|$)`,
      "im",
    );
    const headingMatch = semanticText.match(headingPattern);
    if (headingMatch) sectionContent = headingMatch[1] || "";

    // 2. Find by concept words in paragraph (prefer substantive paragraphs ≥20 words)
    if (!sectionContent) {
      const words = norm.split(/\s+/).filter(w => w.length > 2);
      let shortFallback = "";
      for (const para of paragraphs) {
        const pl = para.toLowerCase();
        if (pl.includes(norm) || (words.length >= 2 && words.every(w => pl.includes(w)))) {
          if (para.split(/\s+/).length >= 20) {
            sectionContent = para;
            break;
          } else if (!shortFallback) {
            shortFallback = para;
          }
        }
      }
      if (!sectionContent && shortFallback) sectionContent = shortFallback;
    }

    // 3. Synonym-based paragraph finding
    if (!sectionContent) {
      const synPattern = SEMANTIC_SYNONYMS[norm];
      if (synPattern) {
        for (const para of paragraphs) {
          if (synPattern.test(para) && para.split(/\s+/).length >= 40) {
            sectionContent = para;
            break;
          }
        }
      }
    }

    // 4. If concept is not present at all, check
    if (!sectionContent) {
      if (!conceptPresent(req, semanticText, output)) {
        diagnostics.push(`Section "${req}" not found`);
      }
      // Concept words exist but not in a dedicated section — acceptable
      continue;
    }

    // Validate found section content
    const wordCount = sectionContent.trim().split(/\s+/).length;
    if (wordCount < 40) {
      diagnostics.push(`Section "${req}" is a stub (${wordCount} words, min 40)`);
      continue;
    }
    const isFiller = FILLER_PATTERNS.some(p => p.test(sectionContent.trim()));
    if (isFiller) {
      diagnostics.push(`Section "${req}" is filler`);
      continue;
    }
    const hasSubstance = SUBSTANCE_PATTERNS.some(p => p.test(sectionContent));
    if (!hasSubstance) {
      diagnostics.push(`Section "${req}" lacks substance (no metrics, stakeholders, or causal reasoning)`);
    }
  }

  return { gate: "section_completeness", pass: diagnostics.length === 0, diagnostics };
}

// ── Gate 4: Evidence Discipline ───────────────────────────────────

const CITATION_PATTERN = /\[(?:KI|PB|SRC):[^\]]+\]/g;

export function checkEvidenceDiscipline(text: string): GateDiagnostic {
  const diagnostics: string[] = [];
  const textToCheck = extractSemanticText(text);

  const sentences = textToCheck.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

  for (let i = 0; i < sentences.length; i++) {
    const citations = (sentences[i].match(CITATION_PATTERN) || []).length;
    if (citations > 3) {
      diagnostics.push(`Sentence ${i + 1} has ${citations} citations (max 3 per sentence)`);
    }
  }

  const citationSentences: number[] = [];
  for (let i = 0; i < sentences.length; i++) {
    if (CITATION_PATTERN.test(sentences[i])) {
      CITATION_PATTERN.lastIndex = 0;
      citationSentences.push(i);
    }
  }

  const CAUSAL_PATTERNS = /\b(?:because|therefore|resulting|which means|leading to|this (?:means|creates|drives|shows)|consequently|as a result|the data shows|evidence suggests|according to|proves|demonstrates|confirms|validates|supporting)\b/i;

  for (const idx of citationSentences) {
    let hasCausal = false;
    for (let j = Math.max(0, idx - 2); j <= Math.min(sentences.length - 1, idx + 2); j++) {
      if (CAUSAL_PATTERNS.test(sentences[j])) {
        hasCausal = true;
        break;
      }
    }
    if (!hasCausal) {
      diagnostics.push(`Citation at sentence ${idx + 1} has no causal reasoning within ±2 sentences`);
    }
  }

  return { gate: "evidence_discipline", pass: diagnostics.length === 0, diagnostics };
}

/**
 * Runs all 4 dimension gates. ANY failure → overall FAIL.
 */
export function runArtifactGate(
  output: string,
  manifest: ArtifactManifest,
): ArtifactGateResult {
  const fidelity = checkTemplateFidelity(output, manifest);
  const readability = checkReadability(output);
  const completeness = checkSectionCompleteness(output, manifest.rubric.mustHave);
  const evidence = checkEvidenceDiscipline(output);

  const gates = [fidelity, readability, completeness, evidence];
  const failed = gates.filter(g => !g.pass).map(g => g.gate);

  const mustHave = manifest.rubric.mustHave;
  const sectionsFailed = new Set<string>();
  const sectionsPassed = new Set<string>(mustHave);
  const diagnosticsArr: Array<{
    dimension: string;
    requirement: string;
    reason: string;
    matched_excerpt: string;
    remediation: string;
  }> = [];

  for (const gate of gates) {
    for (const diag of gate.diagnostics) {
      const reqMatch = diag.match(/(?:Missing required (?:element|section)|Section) "([^"]+)"/);
      const requirement = reqMatch?.[1] ?? diag.slice(0, 60);
      const reason = diag.includes("not found") ? "heading_absent"
        : diag.includes("stub") ? "stub_content"
        : diag.includes("filler") ? "filler_detected"
        : diag.includes("lacks substance") ? "lacks_substance"
        : diag.includes("wall of text") ? "wall_of_text"
        : diag.includes("dense prose") ? "dense_prose"
        : diag.includes("no causal") ? "citation_without_causality"
        : "content_gap";

      diagnosticsArr.push({
        dimension: gate.gate,
        requirement,
        reason,
        matched_excerpt: "",
        remediation: `Address ${gate.gate} issue for "${requirement}"`,
      });
      sectionsFailed.add(requirement);
      sectionsPassed.delete(requirement);
    }
  }

  return {
    pass: failed.length === 0,
    gates,
    failed_dimensions: failed,
    sections_checked: [...mustHave],
    sections_passed: [...sectionsPassed],
    sections_failed: [...sectionsFailed],
    diagnostics: diagnosticsArr,
  };
}

/** Telemetry shape for artifact gate results. */
export interface ArtifactGateTelemetry {
  pass: boolean;
  failed_dimensions: string[];
  regen_attempts: number;
  regen_success: boolean;
  total_gate_latency_ms: number;
  sections_checked?: string[];
  sections_passed?: string[];
  sections_failed?: string[];
  diagnostics?: Array<{
    dimension: string;
    requirement: string;
    reason: string;
    matched_excerpt: string;
    remediation: string;
  }>;
}

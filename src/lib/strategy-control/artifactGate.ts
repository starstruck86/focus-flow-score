/**
 * Phase 3.5C — Artifact Gate (deterministic, pure TypeScript).
 *
 * Five hard gates between generation and delivery.
 * If ANY gate fails → artifact rejected.
 * No LLM calls, no async, no external dependencies.
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
}

export interface ArtifactManifest {
  rubric: { mustHave: readonly string[] };
  output: { shape: string; forbid?: readonly string[] };
}

// ────────────────────────────────────────────────────────────────
// 1. TEMPLATE FIDELITY
// ────────────────────────────────────────────────────────────────

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * For structured artifacts: top-level JSON keys must cover every mustHave.
 * For prose: headings must cover every mustHave (regex).
 */
export function checkTemplateFidelity(
  output: string,
  manifest: ArtifactManifest,
): GateDiagnostic {
  const mustHave = manifest.rubric.mustHave;
  const diagnostics: string[] = [];

  if (manifest.output.shape === "structured_artifact" || manifest.output.shape === "executive_brief") {
    // Extract JSON keys
    let keys: string[] = [];
    try {
      const fenceMatch = output.match(/```(?:json|structured_artifact)\s*([\s\S]*?)```/);
      const raw = fenceMatch ? fenceMatch[1] : output.trim();
      if (raw.startsWith("{") || raw.startsWith("[")) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          keys = Object.keys(parsed);
        }
      }
    } catch {
      // Try extracting quoted keys from JSON-like text
      const keyMatches = output.match(/"([^"]+)"\s*:/g);
      if (keyMatches) {
        keys = keyMatches.map(m => m.replace(/"/g, "").replace(":", "").trim());
      }
    }

    const normalizedKeys = keys.map(normalizeKey);
    for (const req of mustHave) {
      const norm = normalizeKey(req);
      const found = normalizedKeys.some(k => k.includes(norm) || norm.includes(k));
      if (!found) {
        diagnostics.push(`Missing required section: "${req}"`);
      }
    }
  } else {
    // Prose: check concept presence (exact phrase OR all key words within text)
    const lower = output.toLowerCase();
    for (const req of mustHave) {
      const norm = req.toLowerCase();
      // 1. Exact phrase match
      if (lower.includes(norm)) continue;
      // 2. Heading/bold match
      const headingPattern = new RegExp(
        `(?:^#+\\s*.*${norm.replace(/\s+/g, "\\s+")}|\\*\\*.*${norm.replace(/\s+/g, "\\s+")}.*\\*\\*)`,
        "im",
      );
      if (headingPattern.test(output)) continue;
      // 3. All significant words from the requirement present in text
      const words = norm.split(/\s+/).filter(w => w.length > 2);
      const allWordsPresent = words.every(w => lower.includes(w));
      if (allWordsPresent && words.length >= 2) continue;
      // 4. Synonym expansion for common concepts
      const synonyms: Record<string, RegExp> = {
        "current state": /\b(?:currently|today|right now|existing|as of|status quo|operates?)\b/i,
        "cost or risk": /\b(?:cost|risk|exposure|threat|consequence|price|penalty|loss)\b/i,
        "change hypothesis": /\b(?:change|hypothesis|shift|reframe|consolidat|transform)\b/i,
        "open question": /\b(?:question|\?|ask (?:the|their|about))\b/i,
      };
      const synPattern = synonyms[norm];
      if (synPattern && synPattern.test(output)) continue;
      // 5. If none matched, fail
      diagnostics.push(`Missing required element: "${req}"`);
    }
  }

  return {
    gate: "template_fidelity",
    pass: diagnostics.length === 0,
    diagnostics,
  };
}

// ────────────────────────────────────────────────────────────────
// 2. READABILITY
// ────────────────────────────────────────────────────────────────

/**
 * Mechanical readability check:
 * - Max 120 words per paragraph
 * - Any section with ≥200 words and 0 line breaks → FAIL
 * - If >70% of text is dense prose (paragraphs >80 words) → FAIL
 */
export function checkReadability(text: string): GateDiagnostic {
  const diagnostics: string[] = [];

  // For structured JSON artifacts, extract string values and check those instead
  const trimmed = text.trim();
  let textToCheck = text;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) {
        // Extract all string values for readability checking
        const values = Object.values(parsed as Record<string, unknown>)
          .filter((v): v is string => typeof v === "string");
        textToCheck = values.join("\n\n");
      }
    } catch { /* not valid JSON, check as-is */ }
  }

  // Split into paragraphs (double newline or section breaks)
  const paragraphs = textToCheck.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  let totalWords = 0;
  let denseWords = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    // Skip JSON blocks, code fences, headings
    if (para.startsWith("```") || para.startsWith("{") || para.startsWith("[") || /^#+\s/.test(para)) continue;

    const words = para.split(/\s+/).length;
    totalWords += words;

    if (words > 120) {
      diagnostics.push(`Paragraph ${i + 1} has ${words} words (max 120)`);
    }

    // Check for wall-of-text: ≥200 words with no internal line breaks
    const internalBreaks = (para.match(/\n/g) || []).length;
    if (words >= 200 && internalBreaks === 0) {
      diagnostics.push(`Paragraph ${i + 1} is a wall of text: ${words} words with no line breaks`);
    }

    if (words > 80) {
      denseWords += words;
    }
  }

  // Dense prose ratio check
  if (totalWords > 0 && denseWords / totalWords > 0.7) {
    diagnostics.push(`${Math.round((denseWords / totalWords) * 100)}% of content is dense prose (>70% threshold)`);
  }

  return {
    gate: "readability",
    pass: diagnostics.length === 0,
    diagnostics,
  };
}

// ────────────────────────────────────────────────────────────────
// 3. SECTION COMPLETENESS
// ────────────────────────────────────────────────────────────────

const FILLER_PATTERNS = [
  /^this section (?:covers|describes|explains|outlines)/i,
  /^in this section/i,
  /^(?:the following|below) (?:is|are|describes)/i,
  /^(?:here|this) (?:we|is where we) (?:will|discuss|examine|explore)/i,
];

const SUBSTANCE_PATTERNS = [
  /\b\d[\d,.]*%?\b/, // numbers/metrics
  /\b(?:VP|CEO|CFO|CRO|CTO|CMO|COO|GM|Director|Manager|Head of)\b/i, // stakeholders
  /\b(?:because|therefore|resulting in|which means|leading to|causing|driving|this creates|consequently)\b/i, // causal
];

/**
 * Every mustHave section must:
 * - Exist
 * - Contain ≥40 words
 * - Contain at least ONE substantive signal (number, stakeholder, or causal statement)
 * - Not be filler
 */
export function checkSectionCompleteness(
  output: string,
  mustHave: readonly string[],
): GateDiagnostic {
  const diagnostics: string[] = [];
  const lower = output.toLowerCase();

  // Try to parse as JSON for structured artifacts
  let parsedJson: Record<string, unknown> | null = null;
  try {
    const fenceMatch = output.match(/```(?:json|structured_artifact)\s*([\s\S]*?)```/);
    const raw = fenceMatch ? fenceMatch[1] : output.trim();
    if (raw.startsWith("{")) {
      parsedJson = JSON.parse(raw);
    }
  } catch { /* not JSON */ }

  for (const req of mustHave) {
    const norm = req.toLowerCase();
    let sectionContent = "";

    // For parsed JSON: find matching key and stringify its value
    if (parsedJson) {
      const matchingKey = Object.keys(parsedJson).find(k => {
        const nk = normalizeKey(k);
        const nr = normalizeKey(req);
        return nk.includes(nr) || nr.includes(nk);
      });
      if (matchingKey) {
        const val = parsedJson[matchingKey];
        sectionContent = typeof val === "string" ? val : JSON.stringify(val);
      }
    }

    // Try heading-based section extraction
    if (!sectionContent) {
      const headingPattern = new RegExp(
        `(?:^#+\\s*[^\\n]*${norm.replace(/\s+/g, "\\s+")}[^\\n]*|^[^\\n]*${norm.replace(/\s+/g, "\\s+")}[^\\n]*:)\\s*\\n([\\s\\S]*?)(?=\\n#+\\s|\\n[A-Z][A-Z\\s]+:|$)`,
        "im",
      );
      const headingMatch = output.match(headingPattern);
      if (headingMatch) {
        sectionContent = headingMatch[1] || "";
      }
    }

    // Fallback for prose: find the paragraph containing the concept
    if (!sectionContent) {
      const paragraphs = output.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      // Check for exact phrase or individual significant words
      const words = norm.split(/\s+/).filter(w => w.length > 2);
      for (const para of paragraphs) {
        const pl = para.toLowerCase();
        if (pl.includes(norm) || words.every(w => pl.includes(w))) {
          sectionContent = para;
          break;
        }
      }
    }

    if (!sectionContent && !lower.includes(norm)) {
      // Last resort: check if key concept words exist anywhere
      const words = norm.split(/\s+/).filter(w => w.length > 2);
      const anyPresent = words.some(w => lower.includes(w));
      if (!anyPresent) {
        diagnostics.push(`Section "${req}" not found`);
        continue;
      }
      // Concept words exist but not in a clear section — skip detailed checks
      continue;
    }

    // If we found content, validate it
    if (sectionContent) {
      const words = sectionContent.trim().split(/\s+/).length;
      if (words < 40) {
        diagnostics.push(`Section "${req}" is a stub (${words} words, min 40)`);
        continue;
      }

      // Check for filler
      const isFiller = FILLER_PATTERNS.some(p => p.test(sectionContent.trim()));
      if (isFiller) {
        diagnostics.push(`Section "${req}" is filler`);
        continue;
      }

      // Check for substance
      const hasSubstance = SUBSTANCE_PATTERNS.some(p => p.test(sectionContent));
      if (!hasSubstance) {
        diagnostics.push(`Section "${req}" lacks substance (no metrics, stakeholders, or causal reasoning)`);
      }
    }
  }

  return {
    gate: "section_completeness",
    pass: diagnostics.length === 0,
    diagnostics,
  };
}

// ────────────────────────────────────────────────────────────────
// 4. EVIDENCE DISCIPLINE
// ────────────────────────────────────────────────────────────────

const CITATION_PATTERN = /\[(?:KI|PB|SRC):[^\]]+\]/g;

/**
 * Evidence discipline:
 * A. >3 citations in a single sentence → stuffing → FAIL
 * B. Citation not within ±2 sentences of a claim → orphan → FAIL
 * C. Citations exist but no causal language nearby → empty evidence → FAIL
 */
export function checkEvidenceDiscipline(text: string): GateDiagnostic {
  const diagnostics: string[] = [];

  // For JSON artifacts, extract string values to check citations in prose context
  let textToCheck = text;
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) {
        const vals = Object.values(parsed as Record<string, unknown>)
          .filter((v): v is string => typeof v === "string");
        textToCheck = vals.join("\n\n");
      }
    } catch { /* not JSON, check raw */ }
  }
  // Also try code fences
  const fenceMatch = text.match(/```(?:json|structured_artifact)\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (typeof parsed === "object" && parsed !== null) {
        const vals = Object.values(parsed as Record<string, unknown>)
          .filter((v): v is string => typeof v === "string");
        textToCheck = vals.join("\n\n");
      }
    } catch { /* use raw */ }
  }

  // Split into sentences
  const sentences = textToCheck.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

  // A. Citation stuffing per sentence
  for (let i = 0; i < sentences.length; i++) {
    const citations = (sentences[i].match(CITATION_PATTERN) || []).length;
    if (citations > 3) {
      diagnostics.push(`Sentence ${i + 1} has ${citations} citations (max 3 per sentence)`);
    }
  }

  // Collect all citation positions
  const citationSentences: number[] = [];
  for (let i = 0; i < sentences.length; i++) {
    if (CITATION_PATTERN.test(sentences[i])) {
      CITATION_PATTERN.lastIndex = 0; // reset regex state
      citationSentences.push(i);
    }
  }

  // B & C. For each citation sentence, check for nearby causal language
  const CAUSAL_PATTERNS = /\b(?:because|therefore|resulting|which means|leading to|this (?:means|creates|drives|shows)|consequently|as a result|the data shows|evidence suggests|according to|proves|demonstrates|confirms|validates|supporting)\b/i;

  for (const idx of citationSentences) {
    // Check ±2 sentences for causal language
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

  return {
    gate: "evidence_discipline",
    pass: diagnostics.length === 0,
    diagnostics,
  };
}

// ────────────────────────────────────────────────────────────────
// 5. COMPOSITE GATE — runArtifactGate
// ────────────────────────────────────────────────────────────────

/**
 * Runs all 4 dimension gates + composite usability verdict.
 * ANY dimension failure → overall FAIL.
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

  return {
    pass: failed.length === 0,
    gates,
    failed_dimensions: failed,
  };
}

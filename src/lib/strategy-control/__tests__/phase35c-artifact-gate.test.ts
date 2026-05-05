import { describe, it, expect } from "vitest";
import {
  checkTemplateFidelity,
  checkReadability,
  checkSectionCompleteness,
  checkEvidenceDiscipline,
  runArtifactGate,
  type ArtifactManifest,
} from "../artifactGate";

// ── Test manifests ──────────────────────────────────────────────

const STRUCTURED_MANIFEST: ArtifactManifest = {
  rubric: {
    mustHave: ["situation", "commercial insight", "risks", "strategic why", "specific asks", "cited sources"],
  },
  output: { shape: "structured_artifact" },
};

const PROSE_MANIFEST: ArtifactManifest = {
  rubric: {
    mustHave: ["current state", "cost or risk", "change hypothesis", "open question"],
  },
  output: { shape: "prose", forbid: ["headings", "bullets"] },
};

// ── Fixture: compliant structured artifact ──────────────────────

const COMPLIANT_STRUCTURED = JSON.stringify({
  situation: "Beechwood Hotel currently operates 4 disconnected guest platforms, costing $180K/year in redundant licensing. The GM is under pressure because NPS dropped 12 points last quarter, resulting in reduced repeat bookings [KI:a1b2c3d4]. This fragmentation means front-desk staff waste 22 minutes per check-in resolving data conflicts across systems, which directly erodes margin.",
  commercial_insight: "The real issue is not technology sprawl — it's that Beechwood cannot execute personalized upsell at check-in because guest preference data lives in 4 silos [PB:e5f6g7h8]. This means the GM is leaving $42/room-night on the table in ancillary revenue, consequently costing the property $890K annually in missed opportunity.",
  risks: "Without consolidation by Q3, Beechwood faces a $2.1M renovation cycle that will lock in the current stack for 3+ years. The VP of Operations has already flagged this as a budget risk [KI:i9j0k1l2], therefore delaying action compounds the cost of re-platforming by an estimated 40%.",
  strategic_why: "Consolidation is not an IT project — it's a revenue recovery initiative. The GM's bonus is tied to NPS and RevPAR, both of which are directly degraded by fragmented guest data. Because the decision process requires board approval above $500K, the champion must frame this as margin protection, not technology modernization [PB:m3n4o5p6].",
  specific_asks: "Ask the GM: 'What is your per-room technology cost today, and how does that compare to your target margin?' Then confirm whether the Q3 renovation budget has been allocated or is still pending approval. This validates urgency and surfaces the true decision timeline.",
  cited_sources: "Grounded in KI:a1b2c3d4 (guest platform fragmentation pattern showing 4-system sprawl drives $180K redundant licensing), PB:e5f6g7h8 (upsell execution playbook confirming $42/room-night gap when guest preferences are siloed across disconnected systems), KI:i9j0k1l2 (renovation cycle risk analysis proving 40% cost compounding from delayed re-platforming decisions), and PB:m3n4o5p6 (champion framing strategy for margin-protection positioning with board-level stakeholders). All citations directly support the causal reasoning chains above, resulting in actionable commercial pressure.",
}, null, 2);

// ── Fixture: compliant prose ────────────────────────────────────

const COMPLIANT_PROSE = `Currently, Beechwood Hotel operates four disconnected guest-facing platforms, resulting in $180K/year in redundant licensing and a 12-point NPS decline last quarter [KI:a1b2c3d4]. The cost or risk of inaction is severe: every quarter without consolidated data costs approximately $42/room-night in missed ancillary revenue, because front-desk staff cannot execute personalized upsell when guest preferences live in four silos [PB:e5f6g7h8].

The change hypothesis is that consolidation reframes this from an IT project to a revenue recovery initiative — the GM's bonus is tied to RevPAR and NPS, both directly degraded by data fragmentation. Therefore, the seller must position consolidation as margin protection, not technology modernization.

The open question to pose: "What is your per-room technology cost today, and how does that compare to your target operating margin?" This validates urgency and confirms whether the Q3 renovation budget — which would lock in the current stack for 3+ years — has been allocated.`;

// ════════════════════════════════════════════════════════════════
// 1. Template Fidelity
// ════════════════════════════════════════════════════════════════

describe("Phase 3.5C — Template Fidelity Gate", () => {
  it("passes when all required sections present in structured artifact", () => {
    const result = checkTemplateFidelity(COMPLIANT_STRUCTURED, STRUCTURED_MANIFEST);
    expect(result.pass).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("fails when a required section is missing", () => {
    const incomplete = JSON.stringify({
      situation: "Some situation text here.",
      commercial_insight: "Some insight.",
      // missing: risks, strategic_why, specific_asks, cited_sources
    });
    const result = checkTemplateFidelity(incomplete, STRUCTURED_MANIFEST);
    expect(result.pass).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.some(d => d.includes("Missing"))).toBe(true);
  });

  it("fails for prose when required element is absent", () => {
    const incomplete = "This prose mentions current state and cost or risk but nothing else about hypotheses.";
    const manifest: ArtifactManifest = {
      rubric: { mustHave: ["current state", "cost or risk", "change hypothesis", "open question"] },
      output: { shape: "prose" },
    };
    const result = checkTemplateFidelity(incomplete, manifest);
    expect(result.pass).toBe(false);
    expect(result.diagnostics.some(d => d.includes("change hypothesis") || d.includes("open question"))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// 2. Readability
// ════════════════════════════════════════════════════════════════

describe("Phase 3.5C — Readability Gate", () => {
  it("passes for scannable text with short paragraphs", () => {
    const result = checkReadability(COMPLIANT_PROSE);
    expect(result.pass).toBe(true);
  });

  it("fails for wall-of-text paragraph (200+ words, no breaks)", () => {
    const wallOfText = "The " + Array(201).fill("word").join(" ") + ".";
    const result = checkReadability(wallOfText);
    expect(result.pass).toBe(false);
    expect(result.diagnostics.some(d => d.includes("wall of text") || d.includes("words"))).toBe(true);
  });

  it("fails when >70% of content is dense prose", () => {
    // Create 3 dense paragraphs of ~100 words each + 1 short one
    const dense = Array(3).fill(
      "The " + Array(99).fill("word").join(" ") + "."
    ).join("\n\n");
    const short = "Short paragraph here.";
    const result = checkReadability(dense + "\n\n" + short);
    expect(result.pass).toBe(false);
    expect(result.diagnostics.some(d => d.includes("dense prose"))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. Section Completeness
// ════════════════════════════════════════════════════════════════

describe("Phase 3.5C — Section Completeness Gate", () => {
  it("passes for substantive sections", () => {
    const result = checkSectionCompleteness(COMPLIANT_STRUCTURED, STRUCTURED_MANIFEST.rubric.mustHave);
    expect(result.pass).toBe(true);
  });

  it("fails for stub section (<40 words)", () => {
    const stubbed = JSON.stringify({
      situation: "Short.",
      commercial_insight: "Brief.",
      risks: "Minimal text here.",
      strategic_why: "Too short.",
      specific_asks: "Stub.",
      cited_sources: "None.",
    });
    const result = checkSectionCompleteness(stubbed, STRUCTURED_MANIFEST.rubric.mustHave);
    expect(result.pass).toBe(false);
    expect(result.diagnostics.some(d => d.includes("stub"))).toBe(true);
  });

  it("fails for filler section", () => {
    const filler = JSON.stringify({
      situation: "This section covers the current state of the account and provides an overview of the business context for the engagement. We will examine the landscape and identify key themes that are relevant to the conversation. " + Array(20).fill("Additional context here.").join(" "),
      commercial_insight: "This section describes the commercial angle for the deal with detailed analysis of market conditions and competitive positioning that drives our strategic recommendations forward. " + Array(10).fill("More detail.").join(" "),
      risks: "The following describes the risk profile of this engagement. " + Array(30).fill("Risk factor noted.").join(" "),
      strategic_why: "In this section we will discuss the strategic rationale including market dynamics, competitive pressure, and revenue implications. " + Array(20).fill("Strategic point.").join(" "),
      specific_asks: "Here we outline the specific requests for the GM including timeline, budget, and technical requirements. " + Array(20).fill("Ask noted.").join(" "),
      cited_sources: "The following are the sources used in this analysis: KI:123, PB:456, with extensive cross-referencing. " + Array(20).fill("Source reference.").join(" "),
    });
    const result = checkSectionCompleteness(filler, STRUCTURED_MANIFEST.rubric.mustHave);
    expect(result.pass).toBe(false);
    expect(result.diagnostics.some(d => d.includes("filler"))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// 4. Evidence Discipline
// ════════════════════════════════════════════════════════════════

describe("Phase 3.5C — Evidence Discipline Gate", () => {
  it("passes for well-placed citations with causal language", () => {
    const result = checkEvidenceDiscipline(COMPLIANT_PROSE);
    expect(result.pass).toBe(true);
  });

  it("fails for citation stuffing (>3 per sentence)", () => {
    const stuffed = "This point is supported by [KI:a1] and [KI:b2] and [KI:c3] and [KI:d4] and [KI:e5] which proves everything.";
    const result = checkEvidenceDiscipline(stuffed);
    expect(result.pass).toBe(false);
    expect(result.diagnostics.some(d => d.includes("citations"))).toBe(true);
  });

  it("fails for orphan citations (no causal language nearby)", () => {
    const orphan = "The hotel is nice. The weather is good. The food is great. Something here [KI:a1b2c3d4]. The pool is warm. The staff is friendly. The rooms are clean.";
    const result = checkEvidenceDiscipline(orphan);
    expect(result.pass).toBe(false);
    expect(result.diagnostics.some(d => d.includes("causal reasoning"))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// 5. Composite Gate
// ════════════════════════════════════════════════════════════════

describe("Phase 3.5C — Composite Artifact Gate", () => {
  it("passes for fully compliant structured artifact", () => {
    const result = runArtifactGate(COMPLIANT_STRUCTURED, STRUCTURED_MANIFEST);
    expect(result.pass).toBe(true);
    expect(result.failed_dimensions).toHaveLength(0);
  });

  it("passes for fully compliant prose artifact", () => {
    const result = runArtifactGate(COMPLIANT_PROSE, PROSE_MANIFEST);
    expect(result.pass).toBe(true);
    expect(result.failed_dimensions).toHaveLength(0);
  });

  it("fails overall when ONE dimension fails", () => {
    // Use wall-of-text to trigger readability failure
    const wallOfText = "The current state is that " + Array(200).fill("word").join(" ") + ". The cost or risk is high. The change hypothesis is clear. The open question is asked?";
    const result = runArtifactGate(wallOfText, PROSE_MANIFEST);
    expect(result.pass).toBe(false);
    expect(result.failed_dimensions.length).toBeGreaterThanOrEqual(1);
  });

  it("reports all failing dimensions", () => {
    // Empty output → multiple failures
    const result = runArtifactGate("", STRUCTURED_MANIFEST);
    expect(result.pass).toBe(false);
    expect(result.failed_dimensions.length).toBeGreaterThanOrEqual(1);
  });
});

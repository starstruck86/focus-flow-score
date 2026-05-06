/**
 * Phase 3 — Semantic Gate Matching Regression Tests
 *
 * Validates that the universal text extraction + semantic concept matching
 * works for ALL JSON shapes: wrapper format, batch keys, nested objects,
 * arrays, and plain prose. No manifest-specific branches.
 */
import { describe, it, expect } from "vitest";
import {
  runArtifactGate,
  checkTemplateFidelity,
  checkSectionCompleteness,
  type ArtifactManifest,
} from "../artifactGate";

// ── Manifests ──

const ACCOUNT_BRIEF_MANIFEST: ArtifactManifest = {
  rubric: { mustHave: ["situation", "commercial insight", "risks", "strategic why", "specific asks", "cited sources"] },
  output: { shape: "structured_artifact" },
};

const DISCOVERY_PREP_MANIFEST: ArtifactManifest = {
  rubric: { mustHave: ["verified signals", "current state reasoning", "change vectors", "commercial insight", "strategic why", "friction", "cited sources"] },
  output: { shape: "structured_artifact" },
};

// ── Rich content that semantically covers account_brief concepts ──
const ACCOUNT_BRIEF_MARKDOWN = [
  "## Situation Overview",
  "The hotel group currently operates 14 properties across 3 brands with fragmented",
  "guest data systems. This creates a background landscape where the VP of Revenue",
  "Management cannot execute cross-property upsell campaigns, resulting in $1.2M",
  "unrealized ancillary revenue annually [KI:abc123].",
  "",
  "## Commercial Insight",
  "Consolidation around operational margin rather than technology features shows",
  "commercial value — because GMs respond to cost-per-occupied-room metrics, the ROI",
  "is $420K annual savings from licensing deduplication alone. This demonstrates the",
  "strategic imperative for unified guest profiles [KI:def456].",
  "",
  "## Risks and Concerns",
  "Primary risk is GM resistance to platform consolidation. The exposure to competitor",
  "poaching increases as guest satisfaction scores drop 12% quarter-over-quarter,",
  "because the current fragmented systems cannot deliver personalized experiences.",
  "",
  "## Strategic Why — Urgency & Catalyst",
  "The strategic imperative is the upcoming contract renewal cycle in Q3, which creates",
  "a compelling window. Why now: 3 of 14 properties are up for technology refresh,",
  "and the CEO has signaled cost reduction as the board priority for FY26.",
  "",
  "## Specific Asks and Next Steps",
  "Recommend the VP schedule a 30-minute discovery call with the IT Director to validate",
  "the $420K licensing cost baseline. Action items: confirm per-property technology spend,",
  "request guest satisfaction data by property, and identify the internal champion.",
  "",
  "## Cited Sources",
  "All findings grounded in verified library content. According to the hospitality",
  "playbook, consolidation ROI typically materializes within 18 months [PB:ghi789].",
].join("\n");

// ── Rich content covering discovery_prep concepts ──
const DISCOVERY_PREP_MARKDOWN = [
  "## Verified Signals and Data Points",
  "Multiple confirmed signals indicate readiness: the prospect's 10-K filing shows",
  "a 15% increase in technology spend, and their VP of Sales mentioned headcount",
  "growth from 50 to 80 reps in the last earnings call. This validates the expansion",
  "trend we identified [KI:sig001].",
  "",
  "## Current State Reasoning",
  "Currently the organization operates with 3 separate CRM instances across divisions.",
  "The status quo creates duplicate data entry costing the team an estimated 2,400",
  "hours annually, because reps must manually reconcile contact records across systems.",
  "",
  "## Change Vectors",
  "Three transformation vectors converge: (1) new CRO hired with consolidation mandate,",
  "(2) contract renewal window in Q2, (3) competitor just launched a unified platform.",
  "This shift creates urgency that disrupts the existing procurement timeline.",
  "",
  "## Commercial Insight",
  "The commercial value proposition centers on operational margin improvement — $380K",
  "annual savings from license consolidation, plus $1.1M in pipeline acceleration from",
  "unified reporting. The ROI demonstrates within 14 months based on comparable deals.",
  "",
  "## Strategic Why",
  "The strategic imperative: new CRO has a 90-day mandate to present a technology",
  "roadmap to the board. Why now — the catalyst is the upcoming board meeting in March,",
  "which creates a compelling decision window we must align to.",
  "",
  "## Friction and Obstacles",
  "Primary friction: VP of IT is a barrier to platform changes due to prior failed",
  "migration. Additional headwinds include budget freeze rumors and the challenge of",
  "convincing 3 division GMs to standardize on a single platform.",
  "",
  "## Sources and Citations",
  "All analysis grounded in verified library sources. Per the enterprise sales playbook,",
  "multi-division deals require executive alignment before technical evaluation [PB:src002].",
].join("\n");

// ── Test Shapes ──

describe("Phase 3 — Semantic Gate Matching", () => {
  describe("wrapper {markdown, sections} format", () => {
    it("passes when markdown contains all concepts", () => {
      const output = JSON.stringify({
        markdown: ACCOUNT_BRIEF_MARKDOWN,
        sections: ["situation", "commercial_insight", "risks"],
      });
      const result = runArtifactGate(output, ACCOUNT_BRIEF_MANIFEST);
      expect(result.pass).toBe(true);
      expect(result.failed_dimensions).toEqual([]);
    });

    it("passes discovery_prep concepts via wrapper format", () => {
      const output = JSON.stringify({
        markdown: DISCOVERY_PREP_MARKDOWN,
        sections: ["signals", "current_state"],
      });
      const result = runArtifactGate(output, DISCOVERY_PREP_MANIFEST);
      expect(result.pass).toBe(true);
    });
  });

  describe("batch-key JSON format", () => {
    it("passes when nested content contains concepts", () => {
      const output = JSON.stringify({
        executive_summary: "The situation overview shows the hotel group currently operates 14 properties. This creates a background landscape where the VP of Revenue Management cannot execute campaigns, resulting in $1.2M unrealized revenue [KI:abc].",
        hypotheses_risks: "Primary risk is GM resistance to consolidation. The exposure increases as guest satisfaction drops 12% quarter-over-quarter, because the fragmented systems cannot deliver personalized experiences.",
        commercial_analysis: "Consolidation shows commercial insight and ROI value — $420K savings from licensing deduplication. This demonstrates the strategic imperative for unified profiles [KI:def].",
        strategic_rationale: "The strategic why is the Q3 renewal cycle catalyst. Why now: 3 properties are up for refresh, and the CEO has signaled cost reduction as the board priority.",
        action_items: "Specific asks: recommend the VP schedule a discovery call. Action items include confirming per-property spend and identifying the internal champion.",
        appendix: "All cited sources grounded in verified library content. According to the hospitality playbook, consolidation ROI materializes within 18 months [PB:ghi].",
      });
      const result = runArtifactGate(output, ACCOUNT_BRIEF_MANIFEST);
      expect(result.pass).toBe(true);
    });

    it("passes discovery_prep with non-matching keys", () => {
      const output = JSON.stringify({
        signal_analysis: "Verified signals: the 10-K filing shows 15% increase in tech spend. The VP of Sales mentioned headcount growth from 50 to 80 reps. This validates expansion [KI:s1].",
        current_situation: "Currently the organization operates with 3 separate CRM instances. The status quo creates duplicate data entry costing 2,400 hours annually, because reps must reconcile records.",
        transformation_drivers: "Three change vectors converge: new CRO with consolidation mandate, Q2 contract renewal, competitor launched unified platform. This shift disrupts the procurement timeline.",
        value_proposition: "Commercial insight: $380K savings from license consolidation, plus $1.1M pipeline acceleration. The ROI demonstrates within 14 months based on comparable deals.",
        urgency_case: "Strategic why: new CRO has 90-day mandate. The catalyst is the board meeting in March, which creates a compelling decision window.",
        obstacles: "Primary friction: VP of IT is a barrier due to prior failed migration. Additional headwinds include budget freeze and the challenge of convincing 3 division GMs.",
        references: "Sources and citations grounded in library. Per the enterprise sales playbook, multi-division deals require executive alignment [PB:s2].",
      });
      const result = runArtifactGate(output, DISCOVERY_PREP_MANIFEST);
      expect(result.pass).toBe(true);
    });
  });

  describe("genuinely missing content still fails", () => {
    it("fails template_fidelity when concepts are absent", () => {
      const output = JSON.stringify({
        introduction: "Hello, welcome to the brief.",
        methodology: "We used standard analysis techniques.",
      });
      const fidelity = checkTemplateFidelity(output, ACCOUNT_BRIEF_MANIFEST);
      expect(fidelity.pass).toBe(false);
      expect(fidelity.diagnostics.length).toBeGreaterThan(0);
    });

    it("fails when output is empty JSON", () => {
      const result = runArtifactGate("{}", ACCOUNT_BRIEF_MANIFEST);
      expect(result.pass).toBe(false);
    });
  });

  describe("empty/stub content fails completeness", () => {
    it("fails section_completeness for stubs under 40 words", () => {
      const output = [
        "## Situation Overview",
        "Brief overview here.",
        "",
        "## Commercial Insight",
        "Some insight.",
        "",
        "## Risks",
        "Some risks.",
        "",
        "## Strategic Why",
        "Why now.",
        "",
        "## Specific Asks",
        "Next step.",
        "",
        "## Cited Sources",
        "Sources here.",
      ].join("\n");
      const completeness = checkSectionCompleteness(output, ACCOUNT_BRIEF_MANIFEST.rubric.mustHave);
      expect(completeness.pass).toBe(false);
      expect(completeness.diagnostics.some(d => d.includes("stub"))).toBe(true);
    });
  });

  describe("account_brief concepts pass semantically", () => {
    it("finds situation via synonym 'overview'", () => {
      const fidelity = checkTemplateFidelity(
        JSON.stringify({ summary: "The company overview and landscape shows a background context where the organization currently operates across multiple divisions." }),
        { rubric: { mustHave: ["situation"] }, output: { shape: "structured_artifact" } },
      );
      expect(fidelity.pass).toBe(true);
    });

    it("finds specific asks via synonym 'action'", () => {
      const fidelity = checkTemplateFidelity(
        JSON.stringify({ next: "We recommend the following action items and next steps for the executive team." }),
        { rubric: { mustHave: ["specific asks"] }, output: { shape: "structured_artifact" } },
      );
      expect(fidelity.pass).toBe(true);
    });
  });

  describe("discovery_prep concepts pass semantically", () => {
    it("finds verified signals via synonym 'indicator'", () => {
      const fidelity = checkTemplateFidelity(
        JSON.stringify({ data: "Multiple confirmed indicators and data points validate the expansion trend in this market." }),
        { rubric: { mustHave: ["verified signals"] }, output: { shape: "structured_artifact" } },
      );
      expect(fidelity.pass).toBe(true);
    });

    it("finds change vectors via synonym 'transform'", () => {
      const fidelity = checkTemplateFidelity(
        JSON.stringify({ drivers: "Three transformation vectors converge to disrupt the existing procurement timeline." }),
        { rubric: { mustHave: ["change vectors"] }, output: { shape: "structured_artifact" } },
      );
      expect(fidelity.pass).toBe(true);
    });

    it("finds friction via synonym 'barrier'", () => {
      const fidelity = checkTemplateFidelity(
        JSON.stringify({ blockers: "Primary barrier to adoption is the VP of IT resistance due to prior failed migrations." }),
        { rubric: { mustHave: ["friction"] }, output: { shape: "structured_artifact" } },
      );
      expect(fidelity.pass).toBe(true);
    });
  });

  describe("nested arrays and deep objects", () => {
    it("extracts text from deeply nested structures", () => {
      const output = JSON.stringify({
        sections: [
          { title: "Overview", body: "The situation landscape shows the organization currently operates 14 properties with fragmented systems." },
          { title: "Value", body: "Commercial insight: consolidation delivers $420K ROI savings annually, demonstrating the value impact." },
          { title: "Concerns", body: "Key risks include exposure to competitive threat and downside from 12% satisfaction decline, because systems are fragmented." },
          { title: "Urgency", body: "Strategic why: the compelling catalyst is Q3 renewal creating an imperative decision window for the CEO." },
          { title: "Actions", body: "Specific asks: recommend scheduling a discovery call. Next step is to confirm technology spend per property." },
          { title: "References", body: "Cited sources: per the hospitality playbook and according to verified library content [PB:ref1]." },
        ],
      });
      const fidelity = checkTemplateFidelity(output, ACCOUNT_BRIEF_MANIFEST);
      expect(fidelity.pass).toBe(true);
    });
  });
});

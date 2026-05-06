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
        executive_summary: "The situation overview shows the hotel group currently operates 14 properties across 3 brands with fragmented guest data systems. This creates a background landscape where the VP of Revenue Management cannot execute cross-property upsell campaigns. The result is an estimated $1.2M in unrealized ancillary revenue annually, because each property maintains separate CRM, PMS, and loyalty platforms — resulting in 23% higher technology spend per occupied room compared to consolidated competitors [KI:abc].",
        hypotheses_risks: "Primary risk is GM resistance to platform consolidation across all 14 properties. The exposure increases significantly as guest satisfaction scores drop 12% quarter-over-quarter, because the current fragmented systems cannot deliver the personalized experiences that modern hospitality demands. This vulnerability creates competitive threat from chains that have already consolidated their technology stack, leading to potential market share loss in the premium segment where the group competes directly.",
        commercial_analysis: "Consolidation demonstrates clear commercial insight with measurable ROI value — $420K annual savings from licensing deduplication alone. Additionally, unified guest profiles would enable cross-property campaigns worth an estimated $1.2M in incremental revenue. This demonstrates the strategic imperative for unified profiles, because GMs respond to cost-per-occupied-room metrics rather than platform capabilities. The total impact represents a 15% improvement in technology cost efficiency [KI:def].",
        strategic_rationale: "The strategic why centers on the Q3 contract renewal cycle, which creates a compelling catalyst for change. Why now: 3 of 14 properties are simultaneously up for technology refresh, and the CEO has signaled cost reduction as the board priority for FY26. This urgency window is time-limited — missing it means waiting 18 months for the next renewal cohort, during which competitors will continue to advance their consolidation efforts.",
        action_items: "Specific asks for the executive team: recommend the VP schedule a 30-minute discovery call with the IT Director to validate the $420K licensing cost baseline. Action items include confirming per-property technology spend, requesting guest satisfaction data segmented by property, identifying the internal champion for consolidation, and scheduling a follow-up with the CFO to discuss the budget approval process for technology investments above $50K.",
        appendix: "All cited sources are grounded in verified library content and validated through multiple data points. According to the hospitality technology playbook, consolidation ROI typically materializes within 18 months of initial deployment. Per industry benchmarks from the Director of Technology at comparable hotel groups, licensing costs decrease 30-40% post-consolidation [PB:ghi].",
      });
      const result = runArtifactGate(output, ACCOUNT_BRIEF_MANIFEST);
      expect(result.pass).toBe(true);
    });

    it("passes discovery_prep with non-matching keys", () => {
      const output = JSON.stringify({
        signal_analysis: "Multiple verified signals confirm market readiness: the prospect's 10-K filing shows a 15% increase in technology spend year-over-year, and their VP of Sales mentioned headcount growth from 50 to 80 reps in the last earnings call. Additionally, the company posted 3 new CRM-related job openings last quarter. This validates the expansion trend and indicates active investment in sales infrastructure [KI:s1].",
        current_situation: "Currently the organization operates with 3 separate CRM instances across divisions, creating significant operational friction. The status quo creates duplicate data entry costing an estimated 2,400 hours annually, because reps must manually reconcile contact records across systems. This current state reasoning shows that the organization is paying a hidden tax of approximately $180K in lost productivity — a cost that compounds as headcount grows from 50 to 80 reps.",
        transformation_drivers: "Three critical change vectors converge to create a transformation opportunity: (1) a new CRO hired 6 weeks ago with an explicit consolidation mandate from the board, (2) the Q2 contract renewal window for 2 of the 3 existing CRM licenses, and (3) a key competitor just launched a unified platform that is winning deals in the mid-market. This shift disrupts the existing procurement timeline and creates urgency that did not exist 90 days ago.",
        value_proposition: "The commercial insight centers on operational margin improvement — $380K in annual savings from license consolidation, plus $1.1M in pipeline acceleration from unified reporting and forecasting. The ROI demonstrates within 14 months based on 4 comparable deals closed in the last 18 months, because unified data eliminates the manual reconciliation bottleneck that currently delays weekly pipeline reviews by 2 business days.",
        urgency_case: "The strategic why is clear: the new CRO has a 90-day mandate to present a technology roadmap to the board. The catalyst is the upcoming board meeting in March, which creates a compelling decision window we must align our engagement to. Missing this window means the CRO will likely select an alternative vendor who is already in late-stage evaluation, because the board expects concrete recommendations at the March meeting.",
        obstacles: "Primary friction comes from the VP of IT, who is a significant barrier to platform changes due to a prior failed CRM migration that cost $200K and took 9 months. Additional headwinds include persistent budget freeze rumors following the Q4 earnings miss, and the challenge of convincing 3 division GMs to standardize on a single platform when each has customized their current CRM with division-specific workflows.",
        references: "All analysis is grounded in verified library sources and validated methodology. Per the enterprise sales playbook, multi-division deals require executive alignment before technical evaluation to prevent bottleneck at the procurement stage. According to the deal velocity framework, CRO-sponsored initiatives close 40% faster than grassroots adoption [PB:s2].",
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

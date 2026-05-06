import { describe, it, expect } from "vitest";
import { runArtifactGate } from "../artifactGate";

describe("debug", () => {
  it("shows failures", () => {
    const output = JSON.stringify({
      executive_summary: "The situation overview shows the hotel group currently operates 14 properties. This creates a background landscape where the VP of Revenue Management cannot execute campaigns, resulting in $1.2M unrealized revenue [KI:abc].",
      hypotheses_risks: "Primary risk is GM resistance to consolidation. The exposure increases as guest satisfaction drops 12% quarter-over-quarter, because the fragmented systems cannot deliver personalized experiences.",
      commercial_analysis: "Consolidation shows commercial insight and ROI value — $420K savings from licensing deduplication. This demonstrates the strategic imperative for unified profiles [KI:def].",
      strategic_rationale: "The strategic why is the Q3 renewal cycle catalyst. Why now: 3 properties are up for refresh, and the CEO has signaled cost reduction as the board priority.",
      action_items: "Specific asks: recommend the VP schedule a discovery call. Action items include confirming per-property spend and identifying the internal champion.",
      appendix: "All cited sources grounded in verified library content. According to the hospitality playbook, consolidation ROI materializes within 18 months [PB:ghi].",
    });
    const manifest = {
      rubric: { mustHave: ["situation", "commercial insight", "risks", "strategic why", "specific asks", "cited sources"] as const },
      output: { shape: "structured_artifact" },
    };
    const r = runArtifactGate(output, manifest);
    const failures = r.gates.filter(g => !g.pass).map(g => ({ gate: g.gate, diag: g.diagnostics }));
    expect(failures).toEqual([]);
  });
});

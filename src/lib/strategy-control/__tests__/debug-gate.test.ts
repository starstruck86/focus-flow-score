import { describe, it, expect } from "vitest";
import { runArtifactGate } from "../artifactGate";
describe("debug", () => {
  it("acct brief wrapper", () => {
    const ACCOUNT_BRIEF_MARKDOWN = `## Situation Overview
The hotel group currently operates 14 properties across 3 brands with fragmented guest data systems. This creates a background landscape where the VP of Revenue Management cannot execute cross-property upsell campaigns, resulting in $1.2M unrealized ancillary revenue annually [KI:abc123].

## Commercial Insight
Consolidation around operational margin rather than technology features shows commercial value — because GMs respond to cost-per-occupied-room metrics, the ROI is $420K annual savings from licensing deduplication alone. This demonstrates the strategic imperative for unified guest profiles [KI:def456].

## Risks and Concerns
Primary risk is GM resistance to platform consolidation. The exposure to competitor poaching increases as guest satisfaction scores drop 12% quarter-over-quarter, because the current fragmented systems cannot deliver personalized experiences.

## Strategic Why — Urgency & Catalyst
The strategic imperative is the upcoming contract renewal cycle in Q3, which creates a compelling window. Why now: 3 of 14 properties are up for technology refresh, and the CEO has signaled cost reduction as the board priority for FY26.

## Specific Asks and Next Steps
Recommend the VP schedule a 30-minute discovery call with the IT Director to validate the $420K licensing cost baseline. Action items: confirm per-property technology spend, request guest satisfaction data by property, and identify the internal champion.

## Cited Sources
All findings grounded in verified library content. According to the hospitality playbook, consolidation ROI typically materializes within 18 months [PB:ghi789].`;
    const output = JSON.stringify({ markdown: ACCOUNT_BRIEF_MARKDOWN, sections: ["situation", "commercial_insight"] });
    const manifest = { rubric: { mustHave: ["situation", "commercial insight", "risks", "strategic why", "specific asks", "cited sources"] as const }, output: { shape: "structured_artifact" } };
    const r = runArtifactGate(output, manifest);
    const failures = r.gates.filter(g => !g.pass).map(g => ({ gate: g.gate, diag: g.diagnostics }));
    expect(failures).toEqual([]);
  });
});

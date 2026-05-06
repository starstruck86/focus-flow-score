import { describe, it, expect } from "vitest";
import { runArtifactGate } from "../artifactGate";

describe("debug", () => {
  it("wrapper disco", () => {
    const DISCOVERY_PREP_MARKDOWN = `## Verified Signals and Data Points
Multiple confirmed signals indicate readiness: the prospect's 10-K filing shows
a 15% increase in technology spend, and their VP of Sales mentioned headcount
growth from 50 to 80 reps in the last earnings call. This validates the expansion
trend we identified [KI:sig001].

## Current State Reasoning
Currently the organization operates with 3 separate CRM instances across divisions.
The status quo creates duplicate data entry costing the team an estimated 2,400
hours annually, because reps must manually reconcile contact records across systems.

## Change Vectors
Three transformation vectors converge: (1) new CRO hired with consolidation mandate,
(2) contract renewal window in Q2, (3) competitor just launched a unified platform.
This shift creates urgency that disrupts the existing procurement timeline.

## Commercial Insight
The commercial value proposition centers on operational margin improvement — $380K
annual savings from license consolidation, plus $1.1M in pipeline acceleration from
unified reporting. The ROI demonstrates within 14 months based on comparable deals.

## Strategic Why
The strategic imperative: new CRO has a 90-day mandate to present a technology
roadmap to the board. Why now — the catalyst is the upcoming board meeting in March,
which creates a compelling decision window we must align to.

## Friction and Obstacles
Primary friction: VP of IT is a barrier to platform changes due to prior failed
migration. Additional headwinds include budget freeze rumors and the challenge of
convincing 3 division GMs to standardize on a single platform.

## Sources and Citations
All analysis grounded in verified library sources. Per the enterprise sales playbook,
multi-division deals require executive alignment before technical evaluation [PB:src002].`;

    const output = JSON.stringify({ markdown: DISCOVERY_PREP_MARKDOWN, sections: ["signals", "current_state"] });
    const manifest = {
      rubric: { mustHave: ["verified signals", "current state reasoning", "change vectors", "commercial insight", "strategic why", "friction", "cited sources"] as const },
      output: { shape: "structured_artifact" },
    };
    const r = runArtifactGate(output, manifest);
    const failures = r.gates.filter(g => !g.pass).map(g => ({ gate: g.gate, diag: g.diagnostics }));
    expect(failures).toEqual([]);
  });
});

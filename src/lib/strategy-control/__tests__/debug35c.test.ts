import { test } from "vitest";
import { runArtifactGate } from "@/lib/strategy-control/artifactGate";

const M = {
  rubric: { mustHave: ["situation", "commercial insight", "risks", "strategic why", "specific asks", "cited sources"] },
  output: { shape: "structured_artifact" },
};

const OBJ = JSON.stringify({
  situation: "Beechwood Hotel currently operates 4 disconnected guest platforms, costing $180K/year in redundant licensing. The GM is under pressure because NPS dropped 12 points last quarter, resulting in reduced repeat bookings [KI:a1b2c3d4]. This fragmentation means front-desk staff waste 22 minutes per check-in resolving data conflicts across systems, which directly erodes margin.",
  commercial_insight: "The real issue is not technology sprawl — it is that Beechwood cannot execute personalized upsell at check-in because guest preference data lives in 4 silos [PB:e5f6g7h8]. This means the GM is leaving $42/room-night on the table in ancillary revenue, consequently costing the property $890K annually in missed opportunity.",
  risks: "Without consolidation by Q3, Beechwood faces a $2.1M renovation cycle that will lock in the current stack for 3+ years. The VP of Operations has already flagged this as a budget risk [KI:i9j0k1l2], therefore delaying action compounds the cost of re-platforming by an estimated 40%.",
  strategic_why: "Consolidation is not an IT project — it is a revenue recovery initiative. The GM's bonus is tied to NPS and RevPAR, both of which are directly degraded by fragmented guest data. Because the decision process requires board approval above $500K, the champion must frame this as margin protection, not technology modernization [PB:m3n4o5p6].",
  specific_asks: "Ask the GM: 'What is your per-room technology cost today, and how does that compare to your target margin?' Then confirm whether the Q3 renovation budget has been allocated or is still pending approval. This validates urgency and surfaces the true decision timeline.",
  cited_sources: "Grounded in KI:a1b2c3d4 (guest platform fragmentation pattern), PB:e5f6g7h8 (upsell execution playbook), KI:i9j0k1l2 (renovation cycle risk), PB:m3n4o5p6 (champion framing strategy). All citations support causal reasoning above.",
}, null, 2);

test("debug structured", () => {
  const r = runArtifactGate(OBJ, M);
  for (const g of r.gates) {
    if (!g.pass) console.log(g.gate, g.diagnostics);
  }
});

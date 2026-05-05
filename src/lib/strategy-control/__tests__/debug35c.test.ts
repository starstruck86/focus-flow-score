import { test, expect } from "vitest";
import { runArtifactGate } from "@/lib/strategy-control/artifactGate";

const PROSE_MANIFEST = {
  rubric: { mustHave: ["current state", "cost or risk", "change hypothesis", "open question"] },
  output: { shape: "prose", forbid: ["headings", "bullets"] },
};

const COMPLIANT_PROSE = `Currently, Beechwood Hotel operates four disconnected guest-facing platforms, resulting in $180K/year in redundant licensing and a 12-point NPS decline last quarter [KI:a1b2c3d4]. The cost or risk of inaction is severe: every quarter without consolidated data costs approximately $42/room-night in missed ancillary revenue, because front-desk staff cannot execute personalized upsell when guest preferences live in four silos [PB:e5f6g7h8].

The change hypothesis is that consolidation reframes this from an IT project to a revenue recovery initiative — the GM's bonus is tied to RevPAR and NPS, both directly degraded by data fragmentation. Therefore, the seller must position consolidation as margin protection, not technology modernization.

The open question to pose: "What is your per-room technology cost today, and how does that compare to your target operating margin?" This validates urgency and confirms whether the Q3 renovation budget — which would lock in the current stack for 3+ years — has been allocated.`;

test("debug prose gates", () => {
  const r = runArtifactGate(COMPLIANT_PROSE, PROSE_MANIFEST);
  console.log(JSON.stringify(r, null, 2));
  expect(true).toBe(true);
});

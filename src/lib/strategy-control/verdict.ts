/**
 * GO / COVERAGE GAP / NO-GO computation — pure.
 *
 * Locked logic:
 *   GO requires:
 *     - case 3a is an honest refusal
 *     - AND (3b OR 3c) is an honest pass
 *     - AND cases 5, 6, 7 prove integrity intact
 *   COVERAGE GAP: no library_required skill passes (3b and 3c both refused/failed)
 *                 BUT integrity is intact
 *   NO-GO: any integrity failure (overrides leak, default path broken, fail)
 */
import type { CaseResult } from "./runner";

export type Verdict = "GO" | "COVERAGE_GAP" | "NO_GO";

export interface VerdictReport {
  verdict: Verdict;
  reason: string;
  details: ReadonlyArray<string>;
}

function byId(results: ReadonlyArray<CaseResult>, id: string): CaseResult | undefined {
  return results.find((r) => r.case.id === id);
}

export function computeVerdict(results: ReadonlyArray<CaseResult>): VerdictReport {
  const details: string[] = [];
  const c1 = byId(results, "1_conversation_pov");
  const c2 = byId(results, "2_commercial_insight");
  const c3a = byId(results, "3a_discovery_prep_sparse");
  const c3b = byId(results, "3b_discovery_prep_real");
  const c3c = byId(results, "3c_meddicc_review_real");
  const c4 = byId(results, "4_unknown_skill");
  const c5 = byId(results, "5_source_mode_injection");
  const c6 = byId(results, "6_no_skill_envelope");
  const c7 = byId(results, "7_missing_debug_header");

  const required = [c1, c2, c3a, c3b, c3c, c4, c5, c6, c7];
  if (required.some((r) => !r)) {
    return {
      verdict: "NO_GO",
      reason: "Not all 7 cases ran. Re-run validation.",
      details: ["Missing one or more case results."],
    };
  }

  // Integrity = cases 5, 6, 7 must all pass.
  const integrityFailures: string[] = [];
  if (c5!.status !== "pass") integrityFailures.push(`5 (override drop): ${c5!.reason}`);
  if (c6!.status !== "pass") integrityFailures.push(`6 (default path): ${c6!.reason}`);
  if (c7!.status !== "pass") integrityFailures.push(`7 (no debug header): ${c7!.reason}`);

  // Case 4 (unknown skill) is also an integrity contract.
  if (c4!.status !== "pass") integrityFailures.push(`4 (unknown skill): ${c4!.reason}`);

  // Cases 1, 2 are basic skill-branch sanity. Failure = NO-GO.
  if (c1!.status !== "pass") integrityFailures.push(`1 (conversation-pov): ${c1!.reason}`);
  if (c2!.status !== "pass") integrityFailures.push(`2 (commercial-insight): ${c2!.reason}`);

  if (integrityFailures.length > 0) {
    return {
      verdict: "NO_GO",
      reason: "Integrity failures detected. Phase 3.5 remains BLOCKED.",
      details: integrityFailures,
    };
  }

  // Case 3a must be an honest refusal.
  if (c3a!.status !== "expected_refusal") {
    if (c3a!.status === "pass") {
      return {
        verdict: "NO_GO",
        reason: "Case 3a passed when it should have refused (false positive on library_required).",
        details: [`3a status: ${c3a!.status} — ${c3a!.reason}`],
      };
    }
    return {
      verdict: "NO_GO",
      reason: "Case 3a did not produce an honest refusal.",
      details: [`3a status: ${c3a!.status} — ${c3a!.reason}`],
    };
  }
  details.push(`3a honest refusal: ${c3a!.signals.refusal_code ?? "n/a"}`);

  // (3b OR 3c) must pass honestly.
  const bPass = c3b!.status === "pass";
  const cPass = c3c!.status === "pass";
  if (!bPass && !cPass) {
    const detail3b = `3b: ${c3b!.status} — ${c3b!.reason}`;
    const detail3c = `3c: ${c3c!.status} — ${c3c!.reason}`;
    return {
      verdict: "COVERAGE_GAP",
      reason: "Integrity is intact, but no library_required skill passed honestly. Add or extract library coverage for these inputs and re-run.",
      details: [detail3b, detail3c],
    };
  }

  if (bPass) details.push("3b passed honestly");
  if (cPass) details.push("3c passed honestly");
  details.push("integrity contracts (4,5,6,7) all intact");

  return {
    verdict: "GO",
    reason: "Phase 3A validated end-to-end against real auth + real library. Phase 3.5 may be discussed.",
    details,
  };
}

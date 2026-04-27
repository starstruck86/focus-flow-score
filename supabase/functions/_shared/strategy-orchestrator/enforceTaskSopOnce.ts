// ════════════════════════════════════════════════════════════════
// enforceTaskSopOnce — Phase 4 (Account Brief only)
//
// Single, controlled SOP repair pass for Account Research / Account
// Brief. Activates only when validateDraftAgainstSop() reports
// `required_outputs_missing.length > 0`. Behavior is strictly:
//
//   - exactly ONE additional model call
//   - patches ONLY the missing SOP-required outputs
//   - preserves the existing draft shape ({ sections, markdown })
//   - never invents facts/metrics/sources/proof — unknowns become
//     "Unknown — requires validation" with precise validation
//     questions
//   - never blocks completion; on any error, returns the original
//     draft with `corrected: false` and an `enforcement_error` string
//
// Discovery Prep is intentionally NOT routed through this helper.
// ════════════════════════════════════════════════════════════════

import { safeParseJSON } from "./providers.ts";
import {
  validateDraftAgainstSop,
  type SopContractLike,
  type SopOutputCheckResult,
} from "./sopValidator.ts";

export interface EnforceTaskSopOnceArgs {
  /** The authored draft (expected shape: { sections: [...], markdown?: string }). */
  draftOutput: any;
  /** Structured SOP contract attached via inputs.__sop. */
  sop: SopContractLike;
  /** The pre-repair output check (must have ran=true & missing list). */
  outputCheck: SopOutputCheckResult;
  /** Task type — only "account_brief" is supported in Phase 4. */
  taskType: string;
  /** Injected model caller for testability. Returns raw assistant text. */
  callModel: (messages: { role: string; content: string }[]) => Promise<string>;
}

export interface EnforceTaskSopOnceResult {
  draftOutput: any;
  correction_attempted: boolean;
  corrected: boolean;
  enforcement_error?: string;
  missing_before: string[];
  missing_after?: string[];
}

function buildRepairPrompt(
  draftOutput: any,
  missing: string[],
): { system: string; user: string } {
  const system = `You are patching an existing Account Research artifact.

Patch ONLY the missing SOP-required outputs: ${missing.join(", ")}

Rules:
- Preserve all existing sections and structure
- Do not rewrite correct sections
- Do not invent facts, metrics, sources, or proof
- If information is unknown, write:
  "Unknown — requires validation"
- Convert unknowns into precise validation questions
- Return the full corrected draft in the same JSON/object shape as input

Return ONLY JSON. No markdown fences. No preamble.`;

  const user = `MISSING REQUIRED OUTPUTS (patch these only):
${missing.map((m, i) => `  ${i + 1}. ${m}`).join("\n")}

EXISTING DRAFT (preserve all current sections; add/repair only what is missing):
${JSON.stringify(draftOutput ?? {}, null, 2)}

Return the FULL corrected draft as JSON in the SAME shape as the input
(e.g. { "sections": [...], "markdown": "..." }). Do not omit existing
sections. Do not rename or reorder existing sections.`;

  return { system, user };
}

export async function enforceTaskSopOnce(
  args: EnforceTaskSopOnceArgs,
): Promise<EnforceTaskSopOnceResult> {
  const { draftOutput, sop, outputCheck, taskType, callModel } = args;
  const missing_before = Array.isArray(outputCheck?.required_outputs_missing)
    ? [...outputCheck.required_outputs_missing]
    : [];

  // Defensive guards — Phase 4 is account_brief only and only when
  // there is something missing to repair.
  if (taskType !== "account_brief") {
    return {
      draftOutput,
      correction_attempted: false,
      corrected: false,
      missing_before,
    };
  }
  if (!sop || !outputCheck?.ran || missing_before.length === 0) {
    return {
      draftOutput,
      correction_attempted: false,
      corrected: false,
      missing_before,
    };
  }

  const { system, user } = buildRepairPrompt(draftOutput, missing_before);

  try {
    const raw = await callModel([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const parsed = safeParseJSON<any>(raw);
    if (!parsed || typeof parsed !== "object") {
      return {
        draftOutput,
        correction_attempted: true,
        corrected: false,
        enforcement_error: "repair_parse_failed",
        missing_before,
      };
    }

    // Shape sanity: must still look like a draft (has `sections`).
    // If the model returned a partial patch instead of the full draft,
    // fall back to the original draft to avoid destroying content.
    const hasSections = Array.isArray((parsed as any).sections);
    const correctedDraft = hasSections ? parsed : draftOutput;
    if (!hasSections) {
      return {
        draftOutput,
        correction_attempted: true,
        corrected: false,
        enforcement_error: "repair_shape_invalid",
        missing_before,
      };
    }

    const after = validateDraftAgainstSop(correctedDraft, sop);
    const missing_after = Array.isArray(after?.required_outputs_missing)
      ? [...after.required_outputs_missing]
      : [];
    const corrected = missing_after.length === 0;

    return {
      draftOutput: correctedDraft,
      correction_attempted: true,
      corrected,
      missing_before,
      missing_after,
    };
  } catch (err) {
    return {
      draftOutput,
      correction_attempted: true,
      corrected: false,
      enforcement_error: String((err as Error)?.message ?? err).slice(0, 300),
      missing_before,
    };
  }
}

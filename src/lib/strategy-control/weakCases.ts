/**
 * Phase 3A Weak-Case Isolation Matrix (W1–W4).
 *
 * These cases strip stage seeds, use fake personas/topics, to prove
 * library_required refuses when retrieval is truly weak.
 */
import type { ValidationCase, ValidationInputs } from "./cases";

export function buildWeakCases(inputs: ValidationInputs): ReadonlyArray<ValidationCase> {
  return Object.freeze([
    // W1: no stage seed + irrelevant persona + irrelevant topic
    {
      id: "w1_no_stage_fake_all",
      label: "W1 · discovery-prep (no stage, fake persona+topic)",
      description: "Strip stage seed entirely, use fake persona and irrelevant topic. Must refuse.",
      expectation: "expected_refusal" as const,
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-w1",
        skill: {
          id: "discovery-prep",
          version: "1",
          inputs: {
            account: inputs.account,
            persona: "Chief Vibe Officer",
            stage: "",
            topic: "quantum computing for pet grooming",
          },
        },
      },
    },

    // W2: fake stage seed + fake persona + irrelevant topic
    {
      id: "w2_fake_stage_fake_all",
      label: "W2 · discovery-prep (fake stage, fake persona+topic)",
      description: "Nonsense stage, fake persona, irrelevant topic. Must refuse.",
      expectation: "expected_refusal" as const,
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-w2",
        skill: {
          id: "discovery-prep",
          version: "1",
          inputs: {
            account: inputs.account,
            persona: "Chief Vibe Officer",
            stage: "nebula",
            topic: "interstellar logistics optimization",
          },
        },
      },
    },

    // W3: executive-brief with no stage + fake persona + fake topic
    {
      id: "w3_exec_brief_fake_all",
      label: "W3 · executive-brief (no stage, fake persona+topic)",
      description: "Second library_required skill with zero retrieval conditions. Must refuse.",
      expectation: "expected_refusal" as const,
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-w3",
        skill: {
          id: "executive-brief",
          version: "1",
          inputs: {
            account: inputs.account,
            persona: "Chief Vibe Officer",
            stage: "",
            topic: "quantum computing for pet grooming",
          },
        },
      },
    },

    // W4: executive-brief with real stage + real persona + irrelevant topic
    // This tests whether real stage seeds pull enough KIs to pass (expected: pass with supporting KIs)
    {
      id: "w4_exec_brief_real_stage",
      label: "W4 · executive-brief (real stage, real persona, irrelevant topic)",
      description: "Real stage seed with real persona but irrelevant topic. May pass if stage retrieves enough KIs.",
      expectation: "pass_attempt" as const,
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-w4",
        skill: {
          id: "executive-brief",
          version: "1",
          inputs: {
            account: inputs.account,
            persona: inputs.persona,
            stage: inputs.stage,
            topic: "interstellar logistics optimization",
          },
        },
      },
    },
  ]);
}

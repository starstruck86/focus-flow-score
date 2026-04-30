/**
 * Phase 3A locked validation cases.
 *
 * Each case defines:
 *   - id, label
 *   - the request body sent to strategy-chat
 *   - whether to send the x-skill-debug header
 *   - the expectation used by the verdict engine
 *
 * Cases are PURE — they take user-provided inputs (account, opp, etc.)
 * and return a frozen list. No side effects, no Supabase calls here.
 */

export type CaseExpectation =
  | "success"             // expect ok=true envelope
  | "expected_refusal"    // honest refusal acceptable (3a)
  | "pass_attempt"        // try to pass; refusal = coverage gap (3b/3c)
  | "unknown_skill"       // must refuse with unknown_skill code
  | "override_dropped"    // must drop sourceMode/behaviorIntent/workspace
  | "default_path";       // must NOT return a skill envelope

export interface ValidationCase {
  id: string;
  label: string;
  description: string;
  expectation: CaseExpectation;
  /** strategy-chat body. Must include `skill` for skill-branch cases. */
  body: Record<string, unknown>;
  /** When false, omit the x-skill-debug header to prove default path. */
  withSkillDebugHeader: boolean;
}

export interface ValidationInputs {
  account: string;
  opportunity: string;
  methodology: string;
  persona: string;
  stage: string;
  topic: string;
}

export const DEFAULT_INPUTS: ValidationInputs = {
  account: "Beechwood Hotel",
  opportunity: "Q3 Platform Renewal",
  methodology: "MEDDICC",
  persona: "General Manager",
  stage: "discovery",
  topic: "guest experience platform consolidation",
};

export function buildCases(inputs: ValidationInputs): ReadonlyArray<ValidationCase> {
  return Object.freeze([
    // 1. conversation-pov — REAL account
    {
      id: "1_conversation_pov",
      label: "1 · conversation-pov (real account)",
      description: "Library-first POV against your real account. Expect a successful trace.",
      expectation: "success",
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-1",
        skill: {
          id: "conversation-pov",
          version: "1",
          inputs: {
            account: inputs.account,
            persona: inputs.persona,
            stage: inputs.stage,
            topic: inputs.topic,
          },
        },
      },
    },

    // 2. commercial-insight — REAL inputs
    {
      id: "2_commercial_insight",
      label: "2 · commercial-insight (real inputs)",
      description: "Sharpened commercial POV. Expect a successful trace.",
      expectation: "success",
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-2",
        skill: {
          id: "commercial-insight",
          version: "1",
          inputs: {
            topic: inputs.topic,
            industry: "hospitality",
            persona: inputs.persona,
            stage: inputs.stage,
            methodology: inputs.methodology,
          },
        },
      },
    },

    // 3a. discovery-prep — FAKE / sparse → expected refusal
    {
      id: "3a_discovery_prep_sparse",
      label: "3a · discovery-prep (sparse) — expected refusal",
      description: "library_required skill with thin inputs. An honest refusal is the correct outcome.",
      expectation: "expected_refusal",
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-3a",
        skill: {
          id: "discovery-prep",
          version: "1",
          inputs: {
            account: "Acme Test Co (fake)",
            persona: "Buyer",
            stage: "discovery",
            topic: "general platform consolidation",
          },
        },
      },
    },

    // 3b. discovery-prep — REAL account → pass attempt
    {
      id: "3b_discovery_prep_real",
      label: "3b · discovery-prep (real account) — pass attempt",
      description: "library_required skill with your real account. May expose a coverage gap.",
      expectation: "pass_attempt",
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-3b",
        skill: {
          id: "discovery-prep",
          version: "1",
          inputs: {
            account: inputs.account,
            persona: inputs.persona,
            stage: inputs.stage,
            topic: inputs.topic,
          },
        },
      },
    },

    // 3c. meddicc-review — REAL opportunity → best chance for library_required pass
    {
      id: "3c_meddicc_review_real",
      label: "3c · meddicc-review (real opp) — pass attempt",
      description: "Methodology-heavy library_required skill. Best chance for an honest pass.",
      expectation: "pass_attempt",
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-3c",
        skill: {
          id: "meddicc-review",
          version: "1",
          inputs: {
            account: inputs.account,
            opportunity: inputs.opportunity,
            methodology: inputs.methodology,
            stage: inputs.stage,
          },
        },
      },
    },

    // 4. unknown skill
    {
      id: "4_unknown_skill",
      label: "4 · unknown skill — must refuse",
      description: "Bogus skill id. Must return an unknown_skill refusal.",
      expectation: "unknown_skill",
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-4",
        skill: {
          id: "totally-not-a-real-skill-xyz-123",
          version: "1",
          inputs: { account: inputs.account },
        },
      },
    },

    // 5. sourceMode injection attack
    {
      id: "5_source_mode_injection",
      label: "5 · sourceMode injection — must be dropped",
      description: "Client tries to override sourceMode/behaviorIntent/workspace. Server must drop them.",
      expectation: "override_dropped",
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-5",
        skill: {
          id: "conversation-pov",
          version: "1",
          inputs: {
            account: inputs.account,
            persona: inputs.persona,
            stage: inputs.stage,
            topic: inputs.topic,
          },
          // forbidden client-side keys — must be ignored & logged
          overrides: {
            sourceMode: "library_relevant",
            behaviorIntent: "objection_handling",
            workspace: "brainstorm",
          },
          sourceMode: "library_relevant",
          behaviorIntent: "objection_handling",
          workspace: "brainstorm",
        },
      },
    },

    // 6. flag OFF simulation — no skill envelope at all
    {
      id: "6_no_skill_envelope",
      label: "6 · no skill envelope — default path",
      description: "Send a normal chat body with no skill. Server must NOT take the skill branch.",
      expectation: "default_path",
      withSkillDebugHeader: true,
      body: {
        threadId: "validation-6",
        action: "noop_validation",
        content: "Phase 3A integrity probe — default path expected.",
      },
    },

    // 7. missing x-skill-debug header
    {
      id: "7_missing_debug_header",
      label: "7 · missing x-skill-debug — default path",
      description: "Skill envelope sent but without the debug header. Server must NOT take the skill branch.",
      expectation: "default_path",
      withSkillDebugHeader: false,
      body: {
        threadId: "validation-7",
        action: "noop_validation",
        content: "Phase 3A integrity probe — default path expected.",
        skill: {
          id: "conversation-pov",
          version: "1",
          inputs: { account: "ignored" },
        },
      },
    },
  ]);
}

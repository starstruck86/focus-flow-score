// ════════════════════════════════════════════════════════════════
// Strategy Core — Workspace Prompt Composer (Phase W4)
//
// Pure string composition that turns a resolved WorkspaceContract into
// a structured "Workspace Overlay" block intended to be appended AFTER
// the Global Strategy SOP / identity / discipline rules and BEFORE the
// retrieved context blocks.
//
// Inviolable rules:
//   • Global Strategy SOP rules (no fabrication, account specificity,
//     economic framing, etc.) live in `reasoningCore.ts` and are
//     ALWAYS prepended first by the caller. The overlay does not
//     restate them — it only adds workspace-shaped behavior.
//   • The overlay must NOT change locked task templates. Discovery
//     Prep / Account Brief / 90-Day Plan etc keep ownership of their
//     section schemas. For the `artifacts` workspace this is enforced
//     in two ways:
//       1. The contract's outputFormattingHints.summary already says
//          "All required section headings come from the pill task
//          config".
//       2. This composer additionally renders an explicit override
//          line — "TASK TEMPLATE TAKES PRECEDENCE" — for any contract
//          whose `artifactsConfig.deferRequiredSectionsToTaskConfig`
//          is true.
//   • W4 does NOT enforce gates, citations, validation, or self-
//     correction. Quality gates are listed in the prompt as awareness
//     hints only. W6 owns enforcement. Citation enforcement is W5.
//
// All composition is pure — no I/O, no providers. Telemetry helpers
// build a metadata object the caller logs from its own surface
// (strategy-chat / run-task) so the surface tag stays accurate.
// ════════════════════════════════════════════════════════════════

import type {
  ContextMode,
  OutputFormattingHints,
  WorkspaceContract,
  WorkspaceKey,
} from "./workspaceContractTypes.ts";

// ─── Block ids (telemetry-stable) ────────────────────────────────

/**
 * Stable identifiers for each block this composer can emit. Logged
 * verbatim in `WorkspacePromptComposition.blocksIncluded` so we can
 * grep retrieval/composition decisions from edge logs.
 */
export type WorkspacePromptBlockId =
  | "workspace_header"
  | "mission"
  | "cognitive_posture"
  | "reasoning_path"
  | "retrieval_posture"
  | "output_formatting_hints"
  | "failure_modes"
  | "escalation_rules"
  | "task_template_precedence";

export const ALL_WORKSPACE_PROMPT_BLOCKS: ReadonlyArray<WorkspacePromptBlockId> =
  Object.freeze([
    "workspace_header",
    "mission",
    "cognitive_posture",
    "reasoning_path",
    "retrieval_posture",
    "output_formatting_hints",
    "failure_modes",
    "escalation_rules",
    "task_template_precedence",
  ]);

// ─── Composition ──────────────────────────────────────────────────

export interface BuildWorkspaceOverlayArgs {
  contract: WorkspaceContract;
  /**
   * When true (the default), the overlay includes the explicit
   * "TASK TEMPLATE TAKES PRECEDENCE" guard. Tasks inside the runTask
   * pipeline always pass `true` so locked templates win over workspace
   * formatting hints. Strategy chat passes `false` (no task template
   * is in flight).
   */
  taskTemplateLocked?: boolean;
  /**
   * When true (default), include the failure-modes block. Surfaces
   * that already enforce a heavy "no fabrication" contract may opt
   * out, but the overlay is intentionally noisy by default.
   */
  includeFailureModes?: boolean;
  /**
   * When true (default), include the escalation rules block. Off by
   * default for runTask because escalation is a chat-time concept;
   * the caller decides.
   */
  includeEscalationRules?: boolean;
  /**
   * Optional surface tag forwarded to telemetry only. Not rendered
   * into the prompt itself.
   */
  surface?: string;
}

export interface WorkspaceOverlayResult {
  /**
   * The composed overlay text. Empty string when (and only when) no
   * blocks were emitted. Callers append this to their own system
   * prompt with a leading "\n\n" separator.
   */
  text: string;
  /** Telemetry — exactly which blocks were emitted, in order. */
  blocksIncluded: WorkspacePromptBlockId[];
}

const HUMAN_WORKSPACE_LABELS: Readonly<Record<WorkspaceKey, string>> = Object
  .freeze({
    brainstorm: "Brainstorm",
    deep_research: "Deep Research",
    refine: "Refine",
    library: "Library",
    artifacts: "Artifacts",
    projects: "Projects",
    work: "Work",
  });

const CONTEXT_MODE_LABELS: Readonly<Record<ContextMode, string>> = Object.freeze(
  {
    thread_first: "thread-first (current conversation leads context)",
    draft_first: "draft-first (the user's draft leads context)",
    artifact_first: "artifact-first (linked artifacts lead context)",
    project_first: "project-first (linked project records lead context)",
  },
);

/**
 * Build the workspace overlay block. Pure. Safe to call from any
 * surface. Returns the rendered text plus a telemetry payload listing
 * the blocks emitted.
 */
export function buildWorkspaceOverlay(
  args: BuildWorkspaceOverlayArgs,
): WorkspaceOverlayResult {
  const {
    contract,
    taskTemplateLocked = false,
    includeFailureModes = true,
    includeEscalationRules = true,
  } = args;

  const parts: string[] = [];
  const included: WorkspacePromptBlockId[] = [];

  // 1. Workspace header — names the active workspace + version so any
  //    downstream review tooling can grep by workspace.
  const label = HUMAN_WORKSPACE_LABELS[contract.workspace] ?? contract.workspace;
  parts.push(
    `═══ ACTIVE WORKSPACE: ${label.toUpperCase()} (contract v${contract.version}) ═══\nThis is a behavioral overlay. The Global Strategy SOP above remains in force — workspace rules SHAPE behavior but never override the inviolable rules (no fabrication, account specificity, economic framing, uncertainty labeling, user-intent preservation).`,
  );
  included.push("workspace_header");

  // 2. Mission
  parts.push(`── Workspace Mission ──\n${contract.mission}`);
  included.push("mission");

  // 3. Cognitive posture
  parts.push(`── Cognitive Posture ──\n${contract.cognitivePosture}`);
  included.push("cognitive_posture");

  // 4. Reasoning path — numbered list, executed before writing.
  if (contract.reasoningPath.length) {
    const numbered = contract.reasoningPath
      .map((step, i) => `${i + 1}. ${step}`)
      .join("\n");
    parts.push(
      `── Reasoning Path (think in this order BEFORE writing) ──\n${numbered}`,
    );
    included.push("reasoning_path");
  }

  // 5. Retrieval posture — surfaces the contract's retrieval rules so
  //    the model knows how aggressively the library/web is in play.
  //    Citation mode is announced ("posture only — no enforcement yet")
  //    because W5 will own enforcement. The model is told the posture
  //    so its prose matches; it is not asked to police itself.
  parts.push(renderRetrievalPosture(contract));
  included.push("retrieval_posture");

  // 6. Output formatting hints — required sections + markers. For
  //    artifact-locked tasks we emit the explicit precedence note
  //    instead of the contract's section headings (artifacts contracts
  //    deliberately defer those to the pill task config).
  parts.push(renderOutputFormattingHints(contract));
  included.push("output_formatting_hints");

  // 7. Failure modes (advisory).
  if (includeFailureModes && contract.failureModes.length) {
    const lines = contract.failureModes.map((m) => `- ${m}`).join("\n");
    parts.push(`── Failure Modes To Avoid ──\n${lines}`);
    included.push("failure_modes");
  }

  // 8. Escalation rules (recommend / suggest only — W7 will own
  //    inline invocation). Suppressed by callers that want to keep the
  //    overlay tight.
  if (includeEscalationRules && contract.escalationRules.length) {
    const lines = contract.escalationRules
      .map(
        (e) => `- ${e.action.replace(/_/g, " ")} → ${e.targetWorkspace}: ${e.trigger}`,
      )
      .join("\n");
    parts.push(`── Escalation Hints ──\n${lines}`);
    included.push("escalation_rules");
  }

  // 9. Task-template precedence — forced on for runTask callers,
  //    additive for any artifacts-style contract that defers section
  //    requirements to the task config. Acts as a hard guard so the
  //    workspace overlay can never silently reshape locked templates.
  if (taskTemplateLocked || contract.artifactsConfig?.deferRequiredSectionsToTaskConfig) {
    parts.push(
      `── TASK TEMPLATE TAKES PRECEDENCE ──\nA task-locked template is in force. Required sections, ordering, field names, and JSON schema come from the task template — NOT from this workspace overlay. The overlay only shapes posture, reasoning order, and output style. Do NOT add, remove, rename, reorder, or merge sections that the task template defines.`,
    );
    included.push("task_template_precedence");
  }

  return {
    text: parts.join("\n\n"),
    blocksIncluded: included,
  };
}

function renderRetrievalPosture(contract: WorkspaceContract): string {
  const r = contract.retrievalRules;
  const ctxLabel = CONTEXT_MODE_LABELS[r.contextMode] ?? r.contextMode;
  return `── Retrieval Posture ──
- The user's library is Strategy's "degree in sales" — the standing definition of what good looks like. It carries TWO roles on every request: RESOURCE (citation-eligible factual grounding) and STANDARD / EXEMPLAR / PATTERN (the quality bar that shapes how you think and write). Standards guide structure and posture even when not cited; never cite a standard unless you directly borrow its language.
- Library use (RESOURCE posture): ${r.libraryUse} (controls how heavily the library leads as factual grounding — never whether it is available, and never disables the STANDARD role).
- Web mode: ${r.webMode}.
- Context mode: ${ctxLabel}.
- Citation posture: ${r.citationMode} (posture only — citation behavior is not enforced at this stage; match the posture in your prose).`;
}

function renderOutputFormattingHints(contract: WorkspaceContract): string {
  const hints: OutputFormattingHints = contract.outputFormattingHints;
  const lines: string[] = [`── Output Formatting Hints ──`, hints.summary];
  if (hints.markers.length) {
    lines.push("Markers:");
    for (const m of hints.markers) lines.push(`- ${m}`);
  }
  // For artifact-locked tasks the section headings come from the task
  // template — explicitly skip them in the overlay so a generic
  // workspace heading set cannot override the locked one.
  const skipHeadings =
    contract.artifactsConfig?.deferRequiredSectionsToTaskConfig === true;
  if (!skipHeadings && hints.sectionHeadings && hints.sectionHeadings.length) {
    lines.push("Required section headings (in order):");
    for (const h of hints.sectionHeadings) lines.push(`- ${h}`);
  }
  return lines.join("\n");
}

// ─── Telemetry payload ───────────────────────────────────────────

export interface WorkspacePromptComposition {
  workspace: WorkspaceKey;
  contractVersion: string;
  contextMode: ContextMode;
  blocksIncluded: WorkspacePromptBlockId[];
  outputFormattingHintsIncluded: boolean;
  taskTemplateLocked: boolean;
  /** Surface that emitted this composition (strategy-chat | run-task). */
  surface: string;
  /** Optional task type when surface === "run-task". */
  taskType?: string;
  /** Optional run id when surface === "run-task". */
  runId?: string;
}

export interface BuildPromptCompositionLogArgs {
  contract: WorkspaceContract;
  result: WorkspaceOverlayResult;
  taskTemplateLocked: boolean;
  surface: string;
  taskType?: string;
  runId?: string;
}

export function buildPromptCompositionLog(
  args: BuildPromptCompositionLogArgs,
): WorkspacePromptComposition {
  return {
    workspace: args.contract.workspace,
    contractVersion: args.contract.version,
    contextMode: args.contract.retrievalRules.contextMode,
    blocksIncluded: args.result.blocksIncluded,
    outputFormattingHintsIncluded: args.result.blocksIncluded.includes(
      "output_formatting_hints",
    ),
    taskTemplateLocked: args.taskTemplateLocked,
    surface: args.surface,
    taskType: args.taskType,
    runId: args.runId,
  };
}

/** Emit a single structured prompt-composition log line. */
export function logPromptComposition(
  composition: WorkspacePromptComposition,
): void {
  console.log(
    `workspace:prompt_composition ${JSON.stringify(composition)}`,
  );
}

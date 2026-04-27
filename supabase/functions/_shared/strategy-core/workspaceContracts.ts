// ════════════════════════════════════════════════════════════════
// Workspace SOP — Contract Registry (Phase W1)
//
// Pure data. The seven finalized Workspace SOPs encoded as typed
// WorkspaceContract objects. No runtime, no I/O. Later phases consume
// this registry; this file only owns the source-of-truth contracts.
//
// Library doctrine (see workspaceContractTypes.ts header): the user's
// library is Strategy's "degree in sales." Every contract below
// inherits the two-role model — RESOURCE (citation-eligible facts)
// and STANDARD / EXEMPLAR / PATTERN (the quality bar / what good
// looks like). The `libraryUse` field on each contract governs
// RESOURCE posture only; the STANDARD role is universal and runs in
// W6.5 regardless of `libraryUse`.
//
// Design references:
//   • Final approved Workspace SOP proposal (7 workspaces)
//   • Inviolable Global SOP rules (not restated here)
//   • Output formatting hints chosen so W6 gates can parse reliably
//
// All gates ship with shadow=true. Only deterministic gates are
// candidates for shadow→enforced promotion after the shadow window;
// heuristic gates require explicit manual approval. llm_judge is
// reserved for future and is not present in MVP gates.
// ════════════════════════════════════════════════════════════════

import type {
  WorkspaceContract,
  WorkspaceKey,
} from "./workspaceContractTypes.ts";

const CONTRACT_VERSION = "1.1.0";

// ─── Brainstorm ───────────────────────────────────────────────────

const BRAINSTORM: WorkspaceContract = {
  workspace: "brainstorm",
  version: CONTRACT_VERSION,
  mission:
    "Generate a wide, diverse surface of angles, hooks, and options fast — optimizing for option-space coverage so the user can choose intentionally.",
  cognitivePosture:
    "Divergent generation. Bias toward breadth and sharp framing over depth or proof. Speculation is welcome but must be labeled as hypothesis/option rather than asserted as fact.",
  useCases: [
    "Generate 10 cold outbound angles for a new vertical",
    "Explore narrative framings for an exec POV before committing",
    "Stress-test an idea by enumerating counter-angles",
    "Produce hook variations for a thought-leadership post",
  ],
  nonGoals: [
    "Producing finalized, send-ready copy",
    "Defending claims with evidence (→ Deep Research)",
    "Editing an existing draft (→ Refine)",
    "Producing structured deliverables (→ Artifacts)",
  ],
  reasoningPath: [
    "Reframe the prompt into the underlying job-to-be-done (what decision will these options serve?)",
    "Enumerate angle dimensions (emotional, financial, competitive, temporal, social, contrarian)",
    "Generate at least one option per dimension; expand the strongest 2–3 dimensions further",
    "Diversity check: collapse paraphrases, replace duplicates with genuinely distinct angles",
    "Label each option's underlying angle so the user can choose with intent",
    "Mark any option that depends on speculative claims as hypothesis and surface what would need to be true",
    "Recommend a next move — refine the top option, deepen one angle, or research a hypothesis",
  ],
  retrievalRules: {
    libraryUse: "relevant",
    webMode: "off",
    citationMode: "none_unless_library_used",
    contextMode: "thread_first",
  },
  qualityGates: [
    {
      id: "brainstorm.min_options",
      description:
        "At least 5 distinct options unless the user specified a different count.",
      checkRef: "brainstorm.min_options",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "brainstorm.angle_diversity",
      description:
        "Each option opens with [Angle: <label>] and no two options share the same labeled angle.",
      checkRef: "brainstorm.angle_diversity",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "brainstorm.hypothesis_labeling",
      description:
        "Speculative claims inside an option are prefixed with 'Hypothesis:' or 'If true:'.",
      checkRef: "brainstorm.hypothesis_labeling",
      enforcementType: "heuristic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "brainstorm.next_move_present",
      description:
        "Output ends with a single 'Next move:' line summarizing the recommended next action.",
      checkRef: "brainstorm.next_move_present",
      enforcementType: "deterministic",
      severity: "info",
      shadow: true,
    },
    {
      id: "brainstorm.citation_only_if_library_used",
      description:
        "If no library hits were retrieved, no citations appear. If library was used, attribution is light and inline.",
      checkRef: "brainstorm.citation_only_if_library_used",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
  ],
  failureModes: [
    "False diversity — 5 paraphrases of one idea",
    "Drifting into research mode and stalling generation",
    "Hedging every option until none have edge",
    "Asserting speculative claims as facts to make options sound stronger",
    "Over-citing — turning a brainstorm into a research-style output",
  ],
  escalationRules: [
    {
      id: "brainstorm.escalate.refine",
      trigger: "User picks an option to develop further.",
      action: "recommend_workspace",
      targetWorkspace: "refine",
    },
    {
      id: "brainstorm.escalate.deep_research",
      trigger: "User asks 'is this true?' or 'find evidence'.",
      action: "recommend_workspace",
      targetWorkspace: "deep_research",
    },
    {
      id: "brainstorm.escalate.artifacts",
      trigger: "User asks for a finished deliverable.",
      action: "recommend_workspace",
      targetWorkspace: "artifacts",
    },
  ],
  outputFormattingHints: {
    summary:
      "Return a numbered list of options. Each option must open with an [Angle: <short label>] tag, then a single tight sentence or short paragraph. End the response with a 'Next move: <one line>' final line.",
    markers: [
      "[Angle: <label>] — required at the start of every option",
      "Hypothesis: ... — prefix any speculative line inside an option",
      "If true: ... — alternative prefix for conditional speculation",
      "Next move: <one line> — final line of the response",
    ],
  },
};

// ─── Deep Research ────────────────────────────────────────────────

const DEEP_RESEARCH: WorkspaceContract = {
  workspace: "deep_research",
  version: CONTRACT_VERSION,
  mission:
    "Investigate companies, markets, competitors, and topics with structured rigor — producing evidence-backed understanding the user can act on or defend.",
  cognitivePosture:
    "Investigative synthesis. Lead with the 'so what,' back it with sourced evidence, and surface gaps and contradictions as first-class output.",
  useCases: [
    "Build an account brief for discovery prep",
    "Map a competitor's GTM motion and pricing posture",
    "Profile a buyer persona's priorities and recent moves",
    "Investigate a market shift and its implications for positioning",
  ],
  nonGoals: [
    "Generating creative angles or hooks (→ Brainstorm)",
    "Polishing finished prose (→ Refine)",
    "Producing a templated deliverable without analysis (→ Artifacts)",
    "Quick lookups that don't need synthesis (→ Work)",
  ],
  reasoningPath: [
    "Decompose the question into 3–6 sub-questions the user actually needs answered",
    "For each sub-question, identify the best source class (library, web, user-provided docs)",
    "Pull evidence; tag each finding by confidence tier ([Verified], [Inferred], [Speculative])",
    "Synthesize across sub-questions — what pattern emerges? What contradicts?",
    "Produce a structured brief: thesis → supporting evidence → contradictions → unknowns → recommended next moves",
    "End with the 2–3 highest-leverage questions the user should ask next",
  ],
  retrievalRules: {
    libraryUse: "primary",
    webMode: "required_for_current_facts",
    citationMode: "strict",
    contextMode: "thread_first",
  },
  qualityGates: [
    {
      id: "deep_research.thesis_first_sentence",
      description:
        "First sentence under '## Thesis' is a declarative claim, not background prose.",
      checkRef: "deep_research.thesis_first_sentence",
      enforcementType: "heuristic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "deep_research.confidence_tagging",
      description:
        "Every finding is tagged with one of [Verified], [Inferred], [Speculative].",
      checkRef: "deep_research.confidence_tagging",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "deep_research.unknowns_section_present",
      description:
        "Output contains a '## What we don't know yet' section.",
      checkRef: "deep_research.unknowns_section_present",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "deep_research.contradictions_surfaced",
      description:
        "When multiple sources disagree, '## Contradictions' surfaces the disagreement explicitly.",
      checkRef: "deep_research.contradictions_surfaced",
      enforcementType: "heuristic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "deep_research.next_questions_present",
      description:
        "Output ends with '## Recommended next questions' containing at least 2 questions.",
      checkRef: "deep_research.next_questions_present",
      enforcementType: "deterministic",
      severity: "info",
      shadow: true,
    },
  ],
  failureModes: [
    "Source dumping with no synthesis",
    "Treating one source as ground truth when others disagree",
    "Burying the 'so what' under exhaustive background",
    "Silent gaps — missing evidence not surfaced as unknowns",
  ],
  escalationRules: [
    {
      id: "deep_research.escalate.artifacts",
      trigger: "User wants to act on findings with a structured deliverable.",
      action: "recommend_workspace",
      targetWorkspace: "artifacts",
    },
    {
      id: "deep_research.escalate.brainstorm",
      trigger: "User wants to brainstorm angles from findings.",
      action: "recommend_workspace",
      targetWorkspace: "brainstorm",
    },
    {
      id: "deep_research.escalate.projects",
      trigger:
        "Findings reveal a longer-running investigation that warrants a project.",
      action: "log_promotion_suggestion",
      targetWorkspace: "projects",
    },
  ],
  outputFormattingHints: {
    summary:
      "Return a structured brief with required section headings in order. Tag every finding with [Verified], [Inferred], or [Speculative].",
    markers: [
      "[Verified] — finding directly supported by a cited source",
      "[Inferred] — reasonable inference from cited sources",
      "[Speculative] — hypothesis not directly supported",
    ],
    sectionHeadings: [
      "## Thesis",
      "## Evidence",
      "## Contradictions",
      "## What we don't know yet",
      "## Recommended next questions",
    ],
  },
};

// ─── Refine ───────────────────────────────────────────────────────

const REFINE: WorkspaceContract = {
  workspace: "refine",
  version: CONTRACT_VERSION,
  mission:
    "Tighten, sharpen, and elevate something the user has already drafted — preserving voice and intent while raising the quality ceiling. Default is one best version; limited targeted variants are allowed when useful.",
  cognitivePosture:
    "Editorial precision. Edit, don't replace. Default action is reduction, not expansion. Variants are tonal/structural levers on the same underlying intent — never broad ideation.",
  useCases: [
    "Tighten a cold email that feels too long",
    "Sharpen the thesis of a discovery brief",
    "Restructure a paragraph that buries the lede",
    "Elevate a LinkedIn post from competent to memorable",
    "Produce a tonal variant (Shorter, Sharper, Warmer, More executive, More direct) of the same draft",
  ],
  nonGoals: [
    "Generating new content from scratch (→ Brainstorm or Artifacts)",
    "Adding facts or claims the user didn't include (→ Deep Research)",
    "Broad ideation or alternative angles (→ Brainstorm)",
    "Rewriting in a generic AI voice",
  ],
  reasoningPath: [
    "Read the draft and identify the author's intent (what are they trying to do?)",
    "Diagnose the top 2–3 weaknesses (buried lede, weak verbs, hedge words, structural drift, weak close)",
    "Apply targeted edits — minimum-viable changes for maximum lift — to produce one best version under '## Improved version'",
    "Re-read the edited version against original intent — is voice preserved?",
    "If a tonal/structural variant would meaningfully serve the user (or they asked), produce up to 2 labeled variants under '## Variant: <Label>' using only allowed labels",
    "Output the improved version + a '## Changes' diff explaining the 2–3 key changes",
  ],
  retrievalRules: {
    libraryUse: "background",
    webMode: "off",
    citationMode: "none",
    contextMode: "draft_first",
  },
  qualityGates: [
    {
      id: "refine.no_new_facts",
      description:
        "No new factual claims appear that weren't in the original draft.",
      checkRef: "refine.no_new_facts",
      enforcementType: "heuristic",
      severity: "blocking",
      shadow: true,
    },
    {
      id: "refine.diff_present",
      description:
        "A '## Changes' section accompanies the improved version.",
      checkRef: "refine.diff_present",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "refine.length_reduced_unless_expand_requested",
      description:
        "Improved version is shorter than the original unless the user asked to expand.",
      checkRef: "refine.length_reduced_unless_expand_requested",
      enforcementType: "deterministic",
      severity: "info",
      shadow: true,
    },
    {
      id: "refine.voice_match_proxy",
      description:
        "Hedge-word density and average sentence length stay within ±25% of the original draft.",
      checkRef: "refine.voice_match_proxy",
      enforcementType: "heuristic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "refine.variant_count_and_labels",
      description:
        "At most 2 variants; every variant label is one of {Shorter, Sharper, Warmer, More executive, More direct}.",
      checkRef: "refine.variant_count_and_labels",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
  ],
  failureModes: [
    "Rewriting in generic AI-polish voice (loses the user's edge)",
    "Adding fabricated stats or examples to 'strengthen' the piece",
    "Over-editing — turning a good draft into a different draft",
    "Producing the new version with no explanation of what changed",
    "Variant sprawl — drifting into broad ideation instead of tonal/structural levers",
  ],
  escalationRules: [
    {
      id: "refine.escalate.deep_research",
      trigger: "Draft needs facts the user didn't provide.",
      action: "recommend_workspace",
      targetWorkspace: "deep_research",
    },
    {
      id: "refine.escalate.brainstorm",
      trigger: "User wants alternative angles or new directions.",
      action: "recommend_workspace",
      targetWorkspace: "brainstorm",
    },
  ],
  outputFormattingHints: {
    summary:
      "Always include '## Improved version' and '## Changes'. If producing variants, add '## Variant: <Label>' for each, using only allowed labels. Maximum 2 variants.",
    markers: [
      "## Improved version — required, contains the single best edit",
      "## Changes — required, lists 2–3 key changes",
      "## Variant: Shorter | Sharper | Warmer | More executive | More direct — optional, max 2",
    ],
    sectionHeadings: ["## Improved version", "## Changes"],
  },
  refineConfig: {
    maxVariants: 2,
    allowedVariantLabels: [
      "Shorter",
      "Sharper",
      "Warmer",
      "More executive",
      "More direct",
    ],
  },
};

// ─── Library ──────────────────────────────────────────────────────

const LIBRARY: WorkspaceContract = {
  workspace: "library",
  version: CONTRACT_VERSION,
  mission:
    "Activate, retrieve, organize, and operationalize the user's saved knowledge — making their library a working surface, not a passive archive.",
  cognitivePosture:
    "Knowledge activation. Treat the user's saved resources as the primary working material — surface them, structure them, apply them.",
  useCases: [
    "Find what I've saved about a topic",
    "Organize related resources into a coherent map or theme set",
    "Apply a saved framework or playbook to a current situation",
    "Synthesize themes across multiple saved resources",
    "Surface forgotten or underused resources that are relevant now",
  ],
  nonGoals: [
    "Open-web research when the library has coverage (→ Deep Research)",
    "Free-form ideation untethered from saved knowledge (→ Brainstorm)",
    "Editing existing drafts (→ Refine)",
    "Producing templated artifacts (→ Artifacts)",
  ],
  reasoningPath: [
    "Identify the user's intent — retrieve, organize, apply, or synthesize?",
    "Query the library for matching resources (titles, tags, account/opp links)",
    "Triage hits by relevance; surface the strongest 2–5 with one-line 'why this matters here'",
    "If applying or synthesizing: extract the relevant frameworks/quotes preserving exact phrasing where meaningful",
    "Compose output with inline [Source: <resource title>] attribution for meaningful borrowings only",
    "Surface gaps in '## Gaps' and recommend next move",
  ],
  retrievalRules: {
    libraryUse: "required",
    webMode: "off",
    citationMode: "strict",
    contextMode: "thread_first",
  },
  qualityGates: [
    {
      id: "library.attribution_for_meaningful_borrowings",
      description:
        "Verbatim quotes (≥8 words) and named-framework references carry an inline [Source: ...] citation.",
      checkRef: "library.attribution_for_meaningful_borrowings",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "library.no_padding_on_generic_concepts",
      description:
        "Citation density stays at most 1 per 60 words to prevent over-citing of generic concepts.",
      checkRef: "library.no_padding_on_generic_concepts",
      enforcementType: "deterministic",
      severity: "info",
      shadow: true,
    },
    {
      id: "library.empty_library_disclosed",
      description:
        "When library returns zero hits, output explicitly says so rather than falling back to generic content.",
      checkRef: "library.empty_library_disclosed",
      enforcementType: "deterministic",
      severity: "blocking",
      shadow: true,
    },
    {
      id: "library.sources_used_summary",
      description:
        "Output ends with a '## Sources used' block enumerating each cited resource.",
      checkRef: "library.sources_used_summary",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "library.gaps_section_present",
      description:
        "Output contains a '## Gaps' section flagging non-coverage.",
      checkRef: "library.gaps_section_present",
      enforcementType: "deterministic",
      severity: "info",
      shadow: true,
    },
  ],
  failureModes: [
    "Citation hallucination — citing resources that don't exist or don't say what's claimed",
    "Citation padding — attributing every generic concept until the output reads as noise",
    "Cherry-picking one resource and ignoring contradicting ones",
    "Generic prose that could have been written without the library (defeats the purpose)",
    "Over-quoting — output becomes a montage instead of synthesis",
  ],
  escalationRules: [
    {
      id: "library.escalate.deep_research",
      trigger: "Library has zero relevant hits.",
      action: "recommend_workspace",
      targetWorkspace: "deep_research",
    },
    {
      id: "library.escalate.refine",
      trigger: "User wants to refine the synthesized output.",
      action: "recommend_workspace",
      targetWorkspace: "refine",
    },
    {
      id: "library.escalate.artifacts",
      trigger: "User wants to turn the synthesis into a deliverable.",
      action: "recommend_workspace",
      targetWorkspace: "artifacts",
    },
  ],
  outputFormattingHints: {
    summary:
      "Use inline [Source: <resource title>] for meaningful borrowings only. Always include '## Sources used' and '## Gaps' tail sections.",
    markers: [
      "[Source: <resource title>] — inline citation for meaningful borrowings",
      "## Sources used — tail block listing each cited resource",
      "## Gaps — tail block flagging library coverage gaps",
    ],
    sectionHeadings: ["## Sources used", "## Gaps"],
  },
};

// ─── Artifacts ────────────────────────────────────────────────────

const ARTIFACTS: WorkspaceContract = {
  workspace: "artifacts",
  version: CONTRACT_VERSION,
  mission:
    "Produce reusable, structured deliverables that conform to a defined shape and can be operationalized immediately — regardless of the specific artifact type.",
  cognitivePosture:
    "Structured assembly. Structure first, prose second. Optimize for re-use, glanceability, and operational fit.",
  useCases: [
    "Generate any artifact whose shape is defined by a pill task config (briefs, plans, decks, frameworks)",
    "Convert raw inputs into a structured, copy-pasteable deliverable",
    "Re-generate or update an existing artifact with new inputs",
  ],
  nonGoals: [
    "Free-form thinking or exploration (→ Brainstorm or Deep Research)",
    "One-off prose that won't be reused (→ Work)",
    "Editing existing drafts (→ Refine)",
    "Defining the artifact's required sections (those belong to the pill task config, not this SOP)",
  ],
  reasoningPath: [
    "Read the artifact contract from the pill task config (sections, ordering, required fields, optional headers like TL;DR / next-actions)",
    "Map available inputs (prompt, account/opp context, library, prior outputs) to each contract section",
    "For sections with sufficient input → compose; for sections without → mark with explicit 'needs: <X>' placeholder",
    "Apply the contract's formatting (headers, bullets, tables) for glanceability",
    "Add a TL;DR/thesis line and/or next-actions block ONLY when the pill task config requires them or they would materially improve usability",
    "Verify the output conforms to the contract before returning",
  ],
  retrievalRules: {
    libraryUse: "primary",
    webMode: "opportunistic",
    citationMode: "strict",
    contextMode: "artifact_first",
  },
  qualityGates: [
    {
      id: "artifacts.required_sections_present",
      description:
        "Every section listed in the pill task config's requiredSections appears as a heading in the output.",
      checkRef: "artifacts.required_sections_present",
      enforcementType: "deterministic",
      severity: "blocking",
      shadow: true,
    },
    {
      id: "artifacts.gaps_marked_explicitly",
      description:
        "Sections lacking input contain a 'needs: <X>' placeholder, not fabricated filler.",
      checkRef: "artifacts.gaps_marked_explicitly",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "artifacts.tldr_only_when_required_or_helpful",
      description:
        "TL;DR and next-actions appear only when required by the pill task config or when materially helpful — never as workspace-level boilerplate.",
      checkRef: "artifacts.tldr_only_when_required_or_helpful",
      enforcementType: "heuristic",
      severity: "info",
      shadow: true,
    },
    {
      id: "artifacts.format_matches_contract",
      description:
        "Heading levels and ordering match the pill task config's sectionOrder.",
      checkRef: "artifacts.format_matches_contract",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
  ],
  failureModes: [
    "Padding sections with generic filler to look complete",
    "Silently skipping required sections when inputs are thin",
    "Adding boilerplate TL;DR or next-actions to artifacts that don't need them",
    "Producing a prose blob instead of structured, scannable sections",
    "Overriding the pill task config's section requirements with workspace assumptions",
  ],
  escalationRules: [
    {
      id: "artifacts.escalate.deep_research",
      trigger: "A research gap blocks a section.",
      action: "recommend_workspace",
      targetWorkspace: "deep_research",
    },
    {
      id: "artifacts.escalate.refine",
      trigger: "User wants to sharpen the prose after generation.",
      action: "recommend_workspace",
      targetWorkspace: "refine",
    },
    {
      id: "artifacts.escalate.projects",
      trigger: "Artifact represents ongoing work.",
      action: "log_promotion_suggestion",
      targetWorkspace: "projects",
    },
  ],
  outputFormattingHints: {
    summary:
      "All required section headings come from the pill task config. Use 'needs: <X>' for missing inputs. Do not add TL;DR or next-actions unless required by the task config.",
    markers: [
      "needs: <X> — placeholder for sections lacking sufficient input",
    ],
  },
  artifactsConfig: {
    deferRequiredSectionsToTaskConfig: true,
  },
};

// ─── Projects ─────────────────────────────────────────────────────

const PROJECTS: WorkspaceContract = {
  workspace: "projects",
  version: CONTRACT_VERSION,
  mission:
    "Provide a workspace for sustained, multi-touch work — grouping related threads, artifacts, and resources around a long-running effort.",
  cognitivePosture:
    "Continuity orientation. Treat the project as the unit of work; respond with awareness of what already exists in the project's scope.",
  useCases: [
    "Strategic account plan executed over a quarter",
    "Multi-stakeholder deal worked across months",
    "Ongoing competitive intelligence stream",
    "Long-form thought leadership project with multiple drafts",
  ],
  nonGoals: [
    "One-off tasks (→ any other workspace)",
    "Throwaway exploration (→ Brainstorm)",
    "Static deliverables (→ Artifacts)",
    "Acting as a generic chat history viewer",
  ],
  reasoningPath: [
    "Load whatever project context is available (linked threads, artifacts, resources, latest rollup)",
    "Place the user's request in that context — is this new, refining, or contradicting prior work?",
    "Respond to the immediate request grounded in available project context only",
    "If meaningful new decisions or commitments emerge, surface them with 'Decision:' or 'Commit:' markers",
    "Recommend a next move grounded in project context, not a generic best practice",
  ],
  retrievalRules: {
    libraryUse: "primary",
    webMode: "opportunistic",
    citationMode: "strict",
    contextMode: "project_first",
  },
  qualityGates: [
    {
      id: "projects.references_available_context",
      description:
        "When project context exists, the response contains at least one explicit reference to a linked thread/artifact/resource.",
      checkRef: "projects.references_available_context",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
    {
      id: "projects.no_fabricated_continuity",
      description:
        "The response must not claim to remember prior sessions beyond what is actually in retrieved context.",
      checkRef: "projects.no_fabricated_continuity",
      enforcementType: "heuristic",
      severity: "blocking",
      shadow: true,
    },
    {
      id: "projects.decisions_surfaced",
      description:
        "Decisions and commitments are surfaced as 'Decision:' or 'Commit:' lines.",
      checkRef: "projects.decisions_surfaced",
      enforcementType: "deterministic",
      severity: "info",
      shadow: true,
    },
    {
      id: "projects.recommendation_grounded_in_context",
      description:
        "Recommended next move references a concrete project artifact/thread when project context exists.",
      checkRef: "projects.recommendation_grounded_in_context",
      enforcementType: "heuristic",
      severity: "warning",
      shadow: true,
    },
  ],
  failureModes: [
    "Fabricated continuity — claiming to remember things not in context",
    "Treating each turn as fully stateless when project context exists",
    "Generic recommendations ignoring linked records",
    "Conflating future-capability behavior with current behavior",
  ],
  escalationRules: [
    {
      id: "projects.escalate.artifacts",
      trigger: "User needs a structured deliverable for the project.",
      action: "recommend_workspace",
      targetWorkspace: "artifacts",
    },
    {
      id: "projects.escalate.deep_research",
      trigger: "Project work needs evidence the chat can't supply.",
      action: "recommend_workspace",
      targetWorkspace: "deep_research",
    },
  ],
  outputFormattingHints: {
    summary:
      "Reference linked records explicitly when context exists. Mark decisions and commitments inline. Do not claim memory beyond what is in retrieved context.",
    markers: [
      "Decision: <text> — inline marker for a project decision",
      "Commit: <text> — inline marker for a stated commitment",
    ],
  },
  projectsConfig: {
    enforceContinuityGuardrail: true,
    futureCapabilityFlags: [],
  },
};

// ─── Work ─────────────────────────────────────────────────────────

const WORK: WorkspaceContract = {
  workspace: "work",
  version: CONTRACT_VERSION,
  mission:
    "The fast sales/operator execution lane — produce immediate, usable output for live, in-the-moment work without specialized-workspace overhead.",
  cognitivePosture:
    "Operator mode. Right-sized, action-oriented, time-to-useful-answer above all. Answer first; route only when it would materially improve the result.",
  useCases: [
    "Quick follow-up email between meetings",
    "Fast reply to a stakeholder message",
    "On-the-fly call prep one-pager",
    "Rapid one-line clarification or rewrite",
    "Ad-hoc thinking partner moment during execution",
  ],
  nonGoals: [
    "Heavy investigation (→ Deep Research)",
    "Sustained multi-session work (→ Projects)",
    "Large templated deliverables (→ Artifacts)",
    "Library-grounded synthesis (→ Library)",
    "Acting as a generalist that competes with specialized workspaces by doing everything mediocrely",
  ],
  reasoningPath: [
    "Classify the request — is this a fast operator task, or does it warrant a specialized workspace?",
    "Match output size and structure to prompt scale (one-liner gets a one-liner, paragraph gets a paragraph)",
    "Produce the immediate usable output",
    "Recommend a specialized workspace ONLY if it would materially improve the result; use 'Consider: <workspace> — <reason>' format",
    "If a tail next-step adds value, append 'Next move: <one line>' — otherwise omit",
  ],
  retrievalRules: {
    libraryUse: "relevant",
    webMode: "opportunistic",
    citationMode: "light",
    contextMode: "thread_first",
  },
  qualityGates: [
    {
      id: "work.answer_stands_alone",
      description:
        "The answer is usable without any 'Consider:' recommendation appended.",
      checkRef: "work.answer_stands_alone",
      enforcementType: "deterministic",
      severity: "blocking",
      shadow: true,
    },
    {
      id: "work.length_proportional",
      description:
        "Response length is proportional to prompt scale (no bloating short prompts into long structured answers).",
      checkRef: "work.length_proportional",
      enforcementType: "heuristic",
      severity: "info",
      shadow: true,
    },
    {
      id: "work.recommendation_only_when_material",
      description:
        "A 'Consider: <workspace>' recommendation appears only when at least one materiality rule has triggered.",
      checkRef: "work.recommendation_only_when_material",
      enforcementType: "deterministic",
      severity: "warning",
      shadow: true,
    },
  ],
  failureModes: [
    "Bloating short prompts into long structured answers",
    "Routing noise — recommending workspaces on every response regardless of whether it helps",
    "Recommending a workspace switch instead of producing an answer",
    "Over-doing what a specialized workspace would do better, when a recommendation truly would help",
    "Producing thinking-partner prose when the user needed an executable artifact",
  ],
  escalationRules: [
    {
      id: "work.escalate.deep_research",
      trigger: "The answer cannot be defended without sourced evidence.",
      action: "recommend_workspace",
      targetWorkspace: "deep_research",
    },
    {
      id: "work.escalate.brainstorm",
      trigger: "Request needs broad ideation beyond operator scope.",
      action: "recommend_workspace",
      targetWorkspace: "brainstorm",
    },
    {
      id: "work.escalate.artifacts",
      trigger: "Request implies a structured, reusable deliverable.",
      action: "recommend_workspace",
      targetWorkspace: "artifacts",
    },
    {
      id: "work.escalate.projects",
      trigger: "Request reveals an ongoing multi-session thread.",
      action: "log_promotion_suggestion",
      targetWorkspace: "projects",
    },
  ],
  outputFormattingHints: {
    summary:
      "Answer first. Append 'Consider: <workspace> — <reason>' only when a materiality rule fires. Optionally end with 'Next move: <one line>' when it adds value.",
    markers: [
      "Consider: <workspace> — <reason> — optional tail recommendation",
      "Next move: <one line> — optional tail next step",
    ],
  },
  workConfig: {
    materialityRules: [
      {
        id: "work.materiality.needs_evidence",
        condition:
          "The answer makes a claim that cannot be defended without sourced evidence.",
        recommend: "deep_research",
      },
      {
        id: "work.materiality.scope_exceeds_operator",
        condition:
          "Request scope clearly exceeds operator-mode fit (multi-section deliverable, sustained investigation).",
        recommend: "artifacts",
      },
      {
        id: "work.materiality.needs_broad_ideation",
        condition:
          "Request asks for many distinct angles or options the operator answer can't reasonably enumerate.",
        recommend: "brainstorm",
      },
      {
        id: "work.materiality.ongoing_thread",
        condition:
          "Request reveals an ongoing multi-session effort that would benefit from project grouping.",
        recommend: "projects",
      },
    ],
  },
};

// ─── Registry ─────────────────────────────────────────────────────

export const WORKSPACE_CONTRACTS: Readonly<
  Record<WorkspaceKey, WorkspaceContract>
> = Object.freeze({
  brainstorm: BRAINSTORM,
  deep_research: DEEP_RESEARCH,
  refine: REFINE,
  library: LIBRARY,
  artifacts: ARTIFACTS,
  projects: PROJECTS,
  work: WORK,
});

/** Accessor used by W2+ phases. Throws on unknown workspace. */
export function getWorkspaceContract(key: WorkspaceKey): WorkspaceContract {
  const c = WORKSPACE_CONTRACTS[key];
  if (!c) throw new Error(`Unknown workspace contract: ${key}`);
  return c;
}

/** All seven workspace keys, in canonical order. */
export const ALL_WORKSPACE_KEYS: ReadonlyArray<WorkspaceKey> = [
  "brainstorm",
  "deep_research",
  "refine",
  "library",
  "artifacts",
  "projects",
  "work",
];

// ─── Workspace key normalization (server mirror of W2) ──────────────
//
// Server-side mirror of `src/lib/strategy/workspaceContracts.ts`'s
// normalizeWorkspaceKey. Used by retrieval enforcement (W3) to never
// trust arbitrary client-provided workspace strings — we always re-
// resolve through this function and fall back to `work` on unknown
// keys, surfacing a structured note for telemetry.

const WORKSPACE_KEY_ALIASES: Readonly<Record<string, WorkspaceKey>> =
  Object.freeze({
    research: "deep_research",
    deepresearch: "deep_research",
    "deep-research": "deep_research",
    deep_research: "deep_research",
    brainstorm: "brainstorm",
    refine: "refine",
    library: "library",
    artifacts: "artifacts",
    artifact: "artifacts",
    projects: "projects",
    project: "projects",
    work: "work",
  });

export interface NormalizeWorkspaceKeyResult {
  /** The canonical workspace key chosen. Always a valid WorkspaceKey. */
  key: WorkspaceKey;
  /** True when the input had to be coerced (alias mapped, or fallback used). */
  fellBack: boolean;
  /** Structured telemetry note. Null when the input was already canonical. */
  note: {
    code: "workspace_key_alias" | "workspace_key_fallback";
    rawInput: unknown;
  } | null;
}

/**
 * Normalize a (potentially client-supplied) workspace identifier into
 * a canonical WorkspaceKey. Unknown keys, null, undefined, and any
 * `custom:*` value all fall back to `work` so retrieval/composition
 * never silently runs against an undefined contract.
 */
export function normalizeWorkspaceKey(
  raw: unknown,
): NormalizeWorkspaceKeyResult {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();
    if ((WORKSPACE_CONTRACTS as Record<string, unknown>)[trimmed]) {
      return { key: trimmed as WorkspaceKey, fellBack: false, note: null };
    }
    const aliased = WORKSPACE_KEY_ALIASES[lower];
    if (aliased) {
      const wasCanonical = lower === aliased;
      return {
        key: aliased,
        fellBack: !wasCanonical,
        note: wasCanonical
          ? null
          : { code: "workspace_key_alias", rawInput: raw },
      };
    }
  }
  return {
    key: "work",
    fellBack: true,
    note: { code: "workspace_key_fallback", rawInput: raw },
  };
}

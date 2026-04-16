// ════════════════════════════════════════════════════════════════
// Strategy Task Orchestrator — shared types
// Discovery Prep is the first consumer; future tasks (recap email,
// follow-up, etc.) plug into the same pipeline via TaskHandler.
// ════════════════════════════════════════════════════════════════

export type TaskType = "discovery_prep"; // expand: "recap_email" | "followup" | ...

export interface TaskInputs {
  company_name?: string;
  rep_name?: string;
  participants?: { name: string; title?: string; role?: string; side?: "internal" | "prospect" }[];
  opportunity?: string;
  stage?: string;
  prior_notes?: string;
  scale?: string;
  desired_next_step?: string;
  website?: string;
  thread_id?: string;
  account_id?: string;
  opportunity_id?: string;
  [k: string]: unknown;
}

/** A single retrieved Knowledge Item from the user's library. */
export interface RetrievedKI {
  id: string;
  title: string;
  chapter?: string | null;
  knowledge_type?: string | null;
  tactic_summary?: string | null;
  why_it_matters?: string | null;
  when_to_use?: string | null;
  how_to_execute?: string | null;
  framework?: string | null;
  confidence_score?: number;
  score: number; // relevance score
}

/** A single retrieved Playbook from the user's library. */
export interface RetrievedPlaybook {
  id: string;
  title: string;
  problem_type?: string;
  when_to_use?: string;
  why_it_matters?: string;
  tactic_steps?: string[];
  talk_tracks?: string[];
  key_questions?: string[];
  traps?: string[];
  anti_patterns?: string[];
  what_great_looks_like?: string[];
  common_mistakes?: string[];
  confidence_score?: number;
  score: number;
}

export interface LibraryRetrievalResult {
  knowledgeItems: RetrievedKI[];
  playbooks: RetrievedPlaybook[];
  /** Compact context string ready to inject into prompts. */
  contextString: string;
  /** Counts for telemetry / source attribution. */
  counts: { kis: number; playbooks: number };
}

export interface ResearchBundle {
  results: Record<string, { text: string; citations: string[] }>;
  totalChars: number;
}

export interface OrchestrationContext {
  userId: string;
  supabase: any; // SupabaseClient — kept loose to avoid Deno import gymnastics
  inputs: TaskInputs;
  taskType: TaskType;
}

export interface OrchestrationResult {
  run_id: string;
  draft: any;
  review: any;
  meta: {
    research_chars: number;
    library_kis: number;
    library_playbooks: number;
    sections: number;
    redlines: number;
  };
}

/**
 * A TaskHandler is a pluggable contract. Each task type provides:
 *  - which research queries to run
 *  - which library scopes to retrieve
 *  - the locked template + few-shot used by Claude
 *  - the review focus
 */
export interface TaskHandler {
  taskType: TaskType;
  buildResearchQueries(inputs: TaskInputs): { key: string; prompt: string }[];
  libraryScopes(inputs: TaskInputs): string[];
  buildSynthesisPrompt(inputs: TaskInputs, research: ResearchBundle, library: LibraryRetrievalResult): string;
  buildDocumentSystemPrompt(): string;
  buildDocumentUserPrompt(inputs: TaskInputs, synthesis: any, library: LibraryRetrievalResult): string;
  buildReviewPrompt(inputs: TaskInputs, draft: any, library: LibraryRetrievalResult): string;
}

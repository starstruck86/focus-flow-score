export interface StrategyThread {
  id: string;
  user_id: string;
  title: string;
  lane: string;
  thread_type: string;
  linked_account_id: string | null;
  linked_opportunity_id: string | null;
  linked_territory_id: string | null;
  linked_artifact_id: string | null;
  status: string;
  summary: string | null;
  latest_rollup: Record<string, unknown> | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface StrategyMessage {
  id: string;
  thread_id: string;
  user_id: string;
  role: string;
  message_type: string;
  content_json: Record<string, unknown>;
  citations_json: Record<string, unknown> | null;
  created_at: string;
}

export interface StrategyOutput {
  id: string;
  user_id: string;
  thread_id: string | null;
  workflow_run_id: string | null;
  output_type: string;
  title: string;
  content_json: Record<string, unknown>;
  rendered_text: string | null;
  linked_account_id: string | null;
  linked_opportunity_id: string | null;
  linked_territory_id: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export type StrategyLane = 'research' | 'evaluate' | 'build' | 'strategy' | 'brainstorm';
export type StrategyThreadType = 'freeform' | 'account_linked' | 'opportunity_linked' | 'territory_linked' | 'artifact_linked';
export type MemoryType = 'fact' | 'hypothesis' | 'risk' | 'priority' | 'stakeholder_note' | 'messaging_note' | 'next_step';

export const LANES: { value: StrategyLane; label: string }[] = [
  { value: 'research', label: 'Research' },
  { value: 'evaluate', label: 'Evaluate' },
  { value: 'build', label: 'Build' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'brainstorm', label: 'Brainstorm' },
];

export const LANE_FILTERS = [
  'all', 'research', 'evaluate', 'build', 'strategy', 'brainstorm',
  'has_uploads', 'has_outputs', 'pinned',
] as const;

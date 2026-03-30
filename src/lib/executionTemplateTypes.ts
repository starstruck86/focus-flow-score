/**
 * Execution Template & Output types + constants
 */

export const OUTPUT_TYPES = [
  'demo_followup_email',
  'discovery_recap_email',
  'executive_followup_email',
  'pricing_followup_email',
  'renewal_followup_email',
  'meeting_agenda',
  'discovery_prep_sheet',
  'demo_prep_sheet',
  'executive_brief',
  'cadence_sequence',
  'objection_handling_draft',
  'competitive_followup',
  'mutual_action_plan',
  'expansion_upsell_followup',
  'custom',
] as const;

export type OutputType = (typeof OUTPUT_TYPES)[number];

export const OUTPUT_TYPE_LABELS: Record<OutputType, string> = {
  demo_followup_email: 'Demo Follow-Up Email',
  discovery_recap_email: 'Discovery Recap Email',
  executive_followup_email: 'Executive Follow-Up Email',
  pricing_followup_email: 'Pricing Follow-Up Email',
  renewal_followup_email: 'Renewal Follow-Up Email',
  meeting_agenda: 'Meeting Agenda',
  discovery_prep_sheet: 'Discovery Prep Sheet',
  demo_prep_sheet: 'Demo Prep Sheet',
  executive_brief: 'Executive Brief',
  cadence_sequence: 'Cadence / Sequence',
  objection_handling_draft: 'Objection Handling Draft',
  competitive_followup: 'Competitive Follow-Up',
  mutual_action_plan: 'Mutual Action Plan Draft',
  expansion_upsell_followup: 'Expansion / Upsell Follow-Up',
  custom: 'Custom',
};

export const TEMPLATE_TYPES = [
  'email', 'prep_sheet', 'cadence', 'agenda', 'recap',
  'brief', 'draft', 'plan', 'other',
] as const;

export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export type TemplateOrigin = 'uploaded' | 'generated' | 'promoted_from_resource' | 'promoted_from_output';

export interface ExecutionTemplate {
  id: string;
  user_id: string;
  title: string;
  template_type: TemplateType;
  output_type: OutputType;
  source_resource_id: string | null;
  source_output_id: string | null;
  body: string;
  subject_line: string | null;
  structure_json: Record<string, unknown>;
  tags: string[];
  tone: string | null;
  persona: string | null;
  stage: string | null;
  competitor: string | null;
  use_case: string | null;
  is_favorite: boolean;
  is_pinned: boolean;
  times_used: number;
  times_selected: number;
  times_successful: number;
  last_used_at: string | null;
  created_by_user: boolean;
  quality_score: number | null;
  confidence_score: number | null;
  template_origin: TemplateOrigin;
  status: 'draft' | 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface ExecutionOutput {
  id: string;
  user_id: string;
  title: string;
  output_type: OutputType;
  content: string;
  subject_line: string | null;
  account_id: string | null;
  account_name: string | null;
  opportunity_id: string | null;
  stage: string | null;
  persona: string | null;
  competitor: string | null;
  template_id_used: string | null;
  reference_resource_ids: string[];
  transcript_resource_ids: string[];
  custom_instructions: string | null;
  times_reused: number;
  is_promoted_to_template: boolean;
  is_strong_example: boolean;
  created_at: string;
  updated_at: string;
}

export interface GenerateContext {
  outputType: OutputType;
  accountId?: string;
  accountName?: string;
  opportunityId?: string;
  stage?: string;
  persona?: string;
  competitor?: string;
  tone?: string;
  templateId?: string;
  templateBody?: string;
  referenceIds?: string[];
  transcriptIds?: string[];
  customInstructions?: string;
}

export interface TemplateRecommendation {
  template: ExecutionTemplate;
  score: number;
  reasons: string[];
}

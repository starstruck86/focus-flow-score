/**
 * Structured output schemas for Strategy workflows.
 * Used for both AI tool-calling extraction and UI rendering.
 */

export interface DeepResearchOutput {
  summary: string;
  company_overview: string;
  key_findings: string[];
  strategic_implications: string[];
  risks: string[];
  opportunities: string[];
  recommended_actions: string[];
  cited_sources: string[];
}

export interface EmailEvaluationOutput {
  overall_score: number;
  strengths: string[];
  weaknesses: string[];
  subject_line_feedback: string;
  opening_feedback: string;
  value_prop_feedback: string;
  cta_feedback: string;
  rewrite: string;
}

export interface TerritoryTieringOutput {
  methodology: string;
  tiers: Array<{
    account_name: string;
    tier: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4';
    rationale: string;
    next_action: string;
  }>;
  summary: string;
}

export interface AccountPlanOutput {
  executive_summary: string;
  account_overview: string;
  stakeholder_map: string[];
  strategic_objectives: string[];
  action_plan: string[];
  risk_factors: string[];
  success_metrics: string[];
}

export interface OpportunityStrategyOutput {
  deal_summary: string;
  decision_process: string;
  champion_status: string;
  competition_analysis: string;
  value_alignment: string;
  risks: string[];
  next_actions: string[];
  close_plan: string;
}

export interface BrainstormOutput {
  key_insights: string[];
  bold_ideas: string[];
  quick_wins: string[];
  strategic_bets: string[];
  summary: string;
}

export interface StrategyRollup {
  summary: string;
  key_facts: string[];
  hypotheses: string[];
  risks: string[];
  open_questions: string[];
  next_steps: string[];
  updated_at: string;
}

export interface MemorySuggestion {
  memory_type: string;
  content: string;
  confidence: number;
}

export type WorkflowOutputType =
  | DeepResearchOutput
  | EmailEvaluationOutput
  | TerritoryTieringOutput
  | AccountPlanOutput
  | OpportunityStrategyOutput
  | BrainstormOutput;

/** Tool-calling schemas for structured extraction */
export const WORKFLOW_TOOL_SCHEMAS: Record<string, any> = {
  deep_research: {
    name: 'deep_research_result',
    description: 'Return structured deep research findings.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        company_overview: { type: 'string' },
        key_findings: { type: 'array', items: { type: 'string' } },
        strategic_implications: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        opportunities: { type: 'array', items: { type: 'string' } },
        recommended_actions: { type: 'array', items: { type: 'string' } },
        cited_sources: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary', 'company_overview', 'key_findings', 'strategic_implications', 'risks', 'opportunities', 'recommended_actions', 'cited_sources'],
      additionalProperties: false,
    },
  },
  email_evaluation: {
    name: 'email_evaluation_result',
    description: 'Return structured email evaluation.',
    parameters: {
      type: 'object',
      properties: {
        overall_score: { type: 'number' },
        strengths: { type: 'array', items: { type: 'string' } },
        weaknesses: { type: 'array', items: { type: 'string' } },
        subject_line_feedback: { type: 'string' },
        opening_feedback: { type: 'string' },
        value_prop_feedback: { type: 'string' },
        cta_feedback: { type: 'string' },
        rewrite: { type: 'string' },
      },
      required: ['overall_score', 'strengths', 'weaknesses', 'subject_line_feedback', 'opening_feedback', 'value_prop_feedback', 'cta_feedback', 'rewrite'],
      additionalProperties: false,
    },
  },
  territory_tiering: {
    name: 'territory_tiering_result',
    description: 'Return structured territory tiering analysis.',
    parameters: {
      type: 'object',
      properties: {
        methodology: { type: 'string' },
        tiers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              account_name: { type: 'string' },
              tier: { type: 'string', enum: ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'] },
              rationale: { type: 'string' },
              next_action: { type: 'string' },
            },
            required: ['account_name', 'tier', 'rationale', 'next_action'],
            additionalProperties: false,
          },
        },
        summary: { type: 'string' },
      },
      required: ['methodology', 'tiers', 'summary'],
      additionalProperties: false,
    },
  },
  account_plan: {
    name: 'account_plan_result',
    description: 'Return structured account plan.',
    parameters: {
      type: 'object',
      properties: {
        executive_summary: { type: 'string' },
        account_overview: { type: 'string' },
        stakeholder_map: { type: 'array', items: { type: 'string' } },
        strategic_objectives: { type: 'array', items: { type: 'string' } },
        action_plan: { type: 'array', items: { type: 'string' } },
        risk_factors: { type: 'array', items: { type: 'string' } },
        success_metrics: { type: 'array', items: { type: 'string' } },
      },
      required: ['executive_summary', 'account_overview', 'stakeholder_map', 'strategic_objectives', 'action_plan', 'risk_factors', 'success_metrics'],
      additionalProperties: false,
    },
  },
  opportunity_strategy: {
    name: 'opportunity_strategy_result',
    description: 'Return structured opportunity strategy.',
    parameters: {
      type: 'object',
      properties: {
        deal_summary: { type: 'string' },
        decision_process: { type: 'string' },
        champion_status: { type: 'string' },
        competition_analysis: { type: 'string' },
        value_alignment: { type: 'string' },
        risks: { type: 'array', items: { type: 'string' } },
        next_actions: { type: 'array', items: { type: 'string' } },
        close_plan: { type: 'string' },
      },
      required: ['deal_summary', 'decision_process', 'champion_status', 'competition_analysis', 'value_alignment', 'risks', 'next_actions', 'close_plan'],
      additionalProperties: false,
    },
  },
  brainstorm: {
    name: 'brainstorm_result',
    description: 'Return structured brainstorm output.',
    parameters: {
      type: 'object',
      properties: {
        key_insights: { type: 'array', items: { type: 'string' } },
        bold_ideas: { type: 'array', items: { type: 'string' } },
        quick_wins: { type: 'array', items: { type: 'string' } },
        strategic_bets: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
      required: ['key_insights', 'bold_ideas', 'quick_wins', 'strategic_bets', 'summary'],
      additionalProperties: false,
    },
  },
};

/** Rollup tool schema for auto-rollup generation */
export const ROLLUP_TOOL_SCHEMA = {
  name: 'generate_rollup',
  description: 'Generate a structured thread rollup summarizing the conversation.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      key_facts: { type: 'array', items: { type: 'string' } },
      hypotheses: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
      open_questions: { type: 'array', items: { type: 'string' } },
      next_steps: { type: 'array', items: { type: 'string' } },
      memory_suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            memory_type: { type: 'string', enum: ['fact', 'hypothesis', 'risk', 'priority', 'stakeholder_note', 'messaging_note', 'next_step'] },
            content: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['memory_type', 'content', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['summary', 'key_facts', 'hypotheses', 'risks', 'open_questions', 'next_steps', 'memory_suggestions'],
    additionalProperties: false,
  },
};

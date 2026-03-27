/**
 * Voice Workflow Chains
 *
 * Supports chained voice commands like:
 * "prep me for this call, then roleplay the CFO"
 * "walk me through my top three deals"
 *
 * Parses compound requests and sequences them through existing tools.
 */

import { updateVoiceContext, getVoiceContext } from './voiceContext';

export interface WorkflowStep {
  /** Tool or action to execute */
  action: string;
  /** Natural language description */
  description: string;
  /** Params extracted from input */
  params?: Record<string, any>;
}

export interface ChainedWorkflow {
  steps: WorkflowStep[];
  currentStep: number;
  originalInput: string;
}

// ── Chain detection patterns ───────────────────────────────

const CHAIN_SEPARATORS = /\b(then|after that|and then|next|also|followed by)\b/i;

const STEP_PATTERNS: [string, RegExp, (match: RegExpMatchArray) => Record<string, any>][] = [
  ['prep_meeting', /\bprep\s+(?:me\s+)?for\s+(?:my\s+)?(?:call|meeting)\s*(?:with\s+(.+?))?(?:\s*,|\s*$)/i,
    (m) => m[1] ? { accountName: m[1].trim() } : {}],
  ['start_roleplay', /\b(?:roleplay|practice|simulate)\s+(?:the\s+)?(.+?)(?:\s*,|\s*$)/i,
    (m) => ({ persona: m[1]?.trim() })],
  ['query_opportunities', /\b(?:walk\s+(?:me\s+)?through|show\s+me|review)\s+(?:my\s+)?(?:top\s+)?(?:\d+\s+)?deals?\b/i,
    () => ({})],
  ['generate_content', /\b(?:draft|write|compose)\s+(?:my\s+|a\s+)?follow.?up\b/i,
    () => ({ contentType: 'follow-up-email' })],
  ['log_touch', /\blog\s+(?:that|the\s+(?:outcome|call|conversation))\b/i,
    () => ({})],
  ['daily_game_plan', /\bwalk\s+(?:me\s+)?through\s+my\s+day\b/i,
    () => ({})],
  ['create_task', /\b(?:set\s+a?\s*reminder|remind\s+me)\b/i,
    () => ({})],
];

/**
 * Parse a compound voice command into a sequence of workflow steps.
 */
export function parseChainedWorkflow(input: string): ChainedWorkflow | null {
  // Split by chain separators
  const parts = input.split(CHAIN_SEPARATORS).filter(p => !CHAIN_SEPARATORS.test(p) && p.trim());

  if (parts.length <= 1) {
    // Single command — not a chain
    return null;
  }

  const steps: WorkflowStep[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    let matched = false;

    for (const [action, pattern, extractParams] of STEP_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        steps.push({
          action,
          description: trimmed,
          params: extractParams(match),
        });
        matched = true;
        break;
      }
    }

    if (!matched && trimmed.length > 3) {
      // Unrecognized step — pass through as a generic ask
      steps.push({ action: 'ask', description: trimmed });
    }
  }

  if (steps.length < 2) return null;

  const workflow: ChainedWorkflow = {
    steps,
    currentStep: 0,
    originalInput: input,
  };

  // Persist to context — include descriptions for smooth transitions
  updateVoiceContext({
    chainedWorkflow: {
      steps: steps.map(s => s.action),
      descriptions: steps.map(s => s.description),
      currentStep: 0,
    },
  });

  return workflow;
}

/**
 * Advance to the next step in an active chain.
 * Returns the next step or null if complete.
 */
export function advanceChain(): WorkflowStep | null {
  const ctx = getVoiceContext();
  if (!ctx.chainedWorkflow) return null;

  const nextIdx = ctx.chainedWorkflow.currentStep + 1;
  if (nextIdx >= ctx.chainedWorkflow.steps.length) {
    updateVoiceContext({ chainedWorkflow: null });
    return null;
  }

  updateVoiceContext({
    chainedWorkflow: {
      ...ctx.chainedWorkflow,
      currentStep: nextIdx,
    },
  });

  // Use the original description for natural transitions
  const description = ctx.chainedWorkflow.descriptions?.[nextIdx] || `Step ${nextIdx + 1}`;

  return {
    action: ctx.chainedWorkflow.steps[nextIdx],
    description,
  };
}

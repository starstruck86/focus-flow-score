/**
 * Voice Confirmation Policy
 *
 * Defines which actions require confirmation before execution,
 * and at what level.
 */

export type ConfirmationLevel = 'none' | 'light' | 'strong';

export interface ConfirmationPolicy {
  level: ConfirmationLevel;
  /** Spoken confirmation prompt (null = no confirmation) */
  prompt: string | null;
}

// ── Policy definitions ─────────────────────────────────────

const NONE_TOOLS = new Set([
  // Read / summarize / explain / prep / roleplay
  'navigate', 'open_copilot', 'operating_state', 'primary_action',
  'momentum_check', 'next_action', 'behavior_summary', 'energy_match',
  'execution_brief', 'meeting_brief', 'execution_next', 'execution_next_live',
  'daily_game_plan', 'daily_game_plan_detailed', 'daily_briefing',
  'daily_briefing_detailed', 'query_daily_plan',
  'query_opportunities', 'query_renewals', 'query_tasks',
  'query_quota', 'query_pipeline', 'query_dashboard',
  'compare_trends', 'personal_insights', 'new_logo_targets',
  'whoop_performance_insights', 'whoop_today_context',
  'start_roleplay', 'start_drill', 'grade_call',
  'prep_meeting', 'open_content_builder',
  // Explain intent
  'explain',
]);

const LIGHT_TOOLS = new Set([
  // Write-light: logging, creating, drafting
  'log_touch', 'add_note', 'debrief', 'save_commitment',
  'create_task', 'set_task_reminder', 'complete_task',
  'update_daily_metrics', 'log_activity',
  'generate_content',
  'start_power_hour', 'start_focus_timer',
  'complete_action', 'defer_action',
  'confirm_execution', 'skip_execution', 'snooze_execution',
  'recast_today',
]);

const STRONG_TOOLS = new Set([
  // Destructive or governance-level
  'kill_switch', 'block_execution',
  'update_account', 'update_opportunity', 'update_methodology',
  'move_deal', 'create_opportunity', 'create_account',
  'update_renewal', 'add_contact',
]);

export function getConfirmationPolicy(toolName: string): ConfirmationPolicy {
  if (NONE_TOOLS.has(toolName)) {
    return { level: 'none', prompt: null };
  }

  if (LIGHT_TOOLS.has(toolName)) {
    return {
      level: 'light',
      prompt: formatLightPrompt(toolName),
    };
  }

  if (STRONG_TOOLS.has(toolName)) {
    return {
      level: 'strong',
      prompt: formatStrongPrompt(toolName),
    };
  }

  // Unknown tools default to light confirmation
  return { level: 'light', prompt: `Should I go ahead with that?` };
}

function formatLightPrompt(tool: string): string {
  const labels: Record<string, string> = {
    log_touch: 'Log that activity?',
    create_task: 'Create that task?',
    set_task_reminder: 'Set that reminder?',
    complete_task: 'Mark that task done?',
    generate_content: 'Draft that for you?',
    debrief: 'Log the debrief?',
    recast_today: 'Recast your plan for today?',
  };
  return labels[tool] || 'Got it. Should I go ahead?';
}

function formatStrongPrompt(tool: string): string {
  const labels: Record<string, string> = {
    kill_switch: 'This will flag a deal for removal. Are you sure?',
    update_account: 'Update this account record. Confirm?',
    update_opportunity: 'Update this deal. Confirm?',
    move_deal: 'Move this deal to a new stage. Confirm?',
    create_opportunity: 'Create a new opportunity. Confirm?',
    create_account: 'Create a new account. Confirm?',
  };
  return labels[tool] || 'This is a significant change. Are you sure?';
}

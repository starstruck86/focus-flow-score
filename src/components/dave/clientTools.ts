import { NavigateFunction } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { AskCopilot, ToolContext } from './toolTypes';
import { createNavigationTools } from './tools/navigation';
import { createAccountTools } from './tools/accounts';
import { createOpportunityTools } from './tools/opportunities';
import { createTaskTools } from './tools/tasks';
import { createJournalTools } from './tools/journal';
import { createPipelineTools } from './tools/pipeline';
import { createIntelligenceTools } from './tools/intelligence';
import { createProspectingTools } from './tools/prospecting';
import { createSynthesisTools } from './tools/synthesis';
import { createIntegrationTools } from './tools/integrations';

async function getUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export function createClientTools(navigate: NavigateFunction, askCopilot: AskCopilot) {
  const ctx: ToolContext = { navigate, askCopilot, getUserId };

  const allTools: Record<string, any> = {
    ...createNavigationTools(ctx),
    ...createAccountTools(ctx),
    ...createOpportunityTools(ctx),
    ...createTaskTools(ctx),
    ...createJournalTools(ctx),
    ...createPipelineTools(ctx),
    ...createIntelligenceTools(ctx),
    ...createIntegrationTools(ctx),
    ...createProspectingTools(ctx),
  };

  // Synthesis tools need access to allTools for execution_brief composition
  Object.assign(allTools, createSynthesisTools(ctx, allTools));

  // ── Wrap DB-writing tools with activity log ────────────────────
  const DB_WRITE_TOOLS = [
    'create_task', 'update_account', 'update_opportunity', 'update_methodology',
    'log_touch', 'move_deal', 'debrief', 'add_note', 'update_daily_metrics',
    'add_contact', 'create_opportunity', 'create_account', 'update_renewal',
    'complete_task', 'set_task_reminder', 'save_commitment',
    'complete_action', 'defer_action',
  ];

  const today = new Date().toISOString().split('T')[0];
  const logKey = `dave-activity-${today}`;

  for (const toolName of DB_WRITE_TOOLS) {
    if (toolName in allTools) {
      const original = (allTools as any)[toolName];
      (allTools as any)[toolName] = async (...args: any[]) => {
        const result = await original(...args);
        try {
          const existing = JSON.parse(localStorage.getItem(logKey) || '[]');
          existing.push({ tool: toolName, result: typeof result === 'string' ? result.slice(0, 200) : '', ts: Date.now() });
          localStorage.setItem(logKey, JSON.stringify(existing.slice(-100)));
        } catch {}
        return result;
      };
    }
  }

  return allTools;
}

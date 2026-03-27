import { NavigateFunction } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { todayET } from '@/lib/timeFormat';
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
import { updateVoiceContext } from '@/lib/voiceContext';
import { getConfirmationPolicy, type ConfirmationLevel } from '@/lib/voiceConfirmation';
import { isVoiceOSEnabled } from '@/lib/featureFlags';
import { recordFriction } from '@/lib/frictionSignals';
import { createAccountTools } from './tools/accounts';
import { createOpportunityTools } from './tools/opportunities';
import { createTaskTools } from './tools/tasks';
import { createJournalTools } from './tools/journal';
import { createPipelineTools } from './tools/pipeline';
import { createIntelligenceTools } from './tools/intelligence';
import { createProspectingTools } from './tools/prospecting';
import { createSynthesisTools } from './tools/synthesis';
import { createIntegrationTools } from './tools/integrations';
import { updateVoiceContext } from '@/lib/voiceContext';
import { getConfirmationPolicy } from '@/lib/voiceConfirmation';

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

  const today = todayET();
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

  // ── Wrap context-updating tools for voice operating memory ─────
  const CONTEXT_TRACKERS: Record<string, (args: any[], result: any) => void> = {
    query_opportunities: (_args, result) => {
      // Try to extract first deal mentioned
      const match = typeof result === 'string' ? result.match(/\*\*(.+?)\*\*.*?—\s*(.+?)[\n|]/) : null;
      if (match) updateVoiceContext({ currentDeal: { id: '', name: match[1], accountName: match[2] } });
    },
    primary_action: (_args, result) => {
      if (typeof result === 'string') {
        updateVoiceContext({ pendingAction: { tool: 'primary_action', description: result.slice(0, 200) } });
      }
    },
    start_roleplay: (args) => {
      const p = args[0] || {};
      updateVoiceContext({ lastRoleplay: { callType: p.call_type || 'discovery', persona: p.persona, difficulty: p.difficulty } });
    },
    prep_meeting: (args) => {
      const p = args[0] || {};
      if (p.accountName) updateVoiceContext({ currentAccount: { id: '', name: p.accountName } });
    },
    create_task: (_args, result) => {
      if (typeof result === 'string') {
        updateVoiceContext({ currentTask: { id: '', title: result.slice(0, 100) } });
      }
    },
  };

  for (const [toolName, tracker] of Object.entries(CONTEXT_TRACKERS)) {
    if (toolName in allTools) {
      const original = (allTools as any)[toolName];
      (allTools as any)[toolName] = async (...args: any[]) => {
        const result = await original(...args);
        try { tracker(args, result); } catch {}
        return result;
      };
    }
  }

  // ── Attach confirmation policy lookup ─────────────────────────
  (allTools as any).__getConfirmationPolicy = getConfirmationPolicy;

  return allTools;
}

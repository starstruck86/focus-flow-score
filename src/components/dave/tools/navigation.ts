import { toast } from 'sonner';
import type { ToolContext, ToolMap } from '../toolTypes';

type CopilotMode = 'quick' | 'meeting' | 'research' | 'coaching';

// Route-alias map — every legacy/short voice target must resolve to an existing route.
// Additive only: zero removals. New in P1c: 'work' and 'train' aliases (destinations
// stay pointed at the current homes /strategy and /study until /work + /train-hub ship).
const ROUTE_ALIASES: Record<string, string> = {
  today: '/today',
  dashboard: '/dashboard',
  tasks: '/tasks',
  outreach: '/outreach',
  territory: '/outreach',
  renewals: '/renewals',
  deals: '/deals',
  strategy: '/strategy',
  quota: '/quota',
  trends: '/trends',
  prep: '/prep',
  library: '/prep',
  coach: '/grade',
  grade: '/grade',
  'game-film': '/grade',
  dojo: '/dojo',
  skills: '/skills',
  study: '/study',
  learn: '/study',
  flash: '/flash',
  'car-mode': '/car-mode',
  car: '/car-mode',
  brief: '/brief',
  meeting: '/meeting',
  'post-call': '/post-call',
  settings: '/settings',
  // New P1c aliases (destinations will flip once /work + /train-hub are live)
  // P1c-REAL: hubs live at /work and /train-hub
  work: '/work',
  train: '/train-hub',
};
function resolveAlias(path: string): string {
  if (!path) return path;
  if (path.startsWith('/')) return path;
  const key = path.toLowerCase().trim();
  return ROUTE_ALIASES[key] ?? (key.startsWith('/') ? key : `/${key}`);
}

export function createNavigationTools(ctx: ToolContext): ToolMap {
  return {
    navigate: (params: { path: string }) => {
      const dest = resolveAlias(params.path);
      ctx.navigate(dest);
      return `Navigated to ${dest}`;
    },


    open_copilot: (params: { question: string; mode?: string }) => {
      ctx.askCopilot(params.question, (params.mode || 'quick') as CopilotMode);
      return `Opened copilot with: ${params.question}`;
    },

    prep_meeting: (params: { accountName?: string; meetingTitle?: string }) => {
      const q = params.accountName
        ? `Prep me for my meeting with ${params.accountName}${params.meetingTitle ? ` — ${params.meetingTitle}` : ''}`
        : 'Prep me for my next meeting';
      ctx.askCopilot(q, 'meeting');
      return `Preparing meeting brief`;
    },

    daily_briefing: async () => {
      const { dailyGamePlanSummary } = await import('./synthesis/dailyGamePlan');
      return dailyGamePlanSummary(ctx);
    },

    daily_briefing_detailed: async () => {
      const { dailyGamePlanDetailed } = await import('./synthesis/dailyGamePlan');
      return dailyGamePlanDetailed(ctx);
    },

    start_roleplay: (params: { call_type?: string; difficulty?: number; industry?: string }) => {
      ctx.navigate('/coach');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('voice-start-roleplay', { detail: params }));
      }, 500);
      return `Launching ${params.call_type || 'discovery'} roleplay`;
    },

    start_drill: () => {
      // Check for active training context to preserve the learning loop
      const lastSkill = localStorage.getItem('dave-last-skill');
      const lastBlocker = localStorage.getItem('dave-last-blocker');

      if (lastSkill) {
        const skillSession = {
          skillId: lastSkill,
          skillName: lastSkill.replace(/_/g, ' '),
          currentTier: 3,
          currentLevel: 3,
          targetTier: 4,
          topBlocker: lastBlocker || undefined,
        };
        ctx.navigate('/dojo/session', { state: { skillSession, skillFocus: lastSkill } });
        return `Launching drill for ${lastSkill.replace(/_/g, ' ')}${lastBlocker ? ` — targeting ${lastBlocker}` : ''}`;
      }

      // No context available — fall back to hub
      ctx.navigate('/dojo');
      return 'Opening the Dojo — pick your rep or I\'ll choose one for you.';
    },

    start_training: (params: { skill?: string }) => {
      if (params?.skill) {
        ctx.navigate('/dojo/session', { state: { skillFocus: params.skill, mode: 'custom' } });
        return `Starting ${params.skill} drill in the Dojo.`;
      }
      ctx.navigate('/dojo/session');
      return 'Opening the Dojo — let\'s get a rep in.';
    },

    grade_call: () => {
      ctx.navigate('/coach');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('voice-grade-call'));
      }, 500);
      return 'Grading latest transcript';
    },

    log_activity: () => {
      window.dispatchEvent(new CustomEvent('voice-quick-log'));
      return 'Opening quick log';
    },

    start_power_hour: () => {
      window.dispatchEvent(new CustomEvent('voice-start-power-hour'));
      return 'Starting power hour timer. Go get it.';
    },

    start_focus_timer: (params: { duration_minutes?: number; focus_type?: string; accountName?: string }) => {
      window.dispatchEvent(new CustomEvent('voice-start-focus-timer', {
        detail: {
          duration: params.duration_minutes || 25,
          type: params.focus_type || 'prospecting',
          account: params.accountName,
        },
      }));
      toast.success('Focus timer started', {
        description: `${params.duration_minutes || 25} min ${params.focus_type || 'prospecting'} block${params.accountName ? ` — ${params.accountName}` : ''}`,
      });
      return `Started ${params.duration_minutes || 25}-minute ${params.focus_type || 'prospecting'} block${params.accountName ? ` for ${params.accountName}` : ''}`;
    },

    open_content_builder: (params: { accountName?: string; opportunityName?: string; contentType?: string; customInstructions?: string }) => {
      ctx.navigate('/prep');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('dave-open-content-builder', {
          detail: {
            accountName: params.accountName,
            opportunityName: params.opportunityName,
            contentType: params.contentType || 'email',
            customInstructions: params.customInstructions,
          },
        }));
      }, 500);
      toast.info('Opening Sales Brain OS', { description: params.contentType || 'Content builder' });
      return `Opened Sales Brain OS${params.accountName ? ` for ${params.accountName}` : ''}`;
    },
  };
}

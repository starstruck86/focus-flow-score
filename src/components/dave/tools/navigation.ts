import { toast } from 'sonner';
import type { ToolContext, ToolMap } from '../toolTypes';

export function createNavigationTools(ctx: ToolContext): ToolMap {
  return {
    navigate: (params: { path: string }) => {
      ctx.navigate(params.path);
      return `Navigated to ${params.path}`;
    },

    open_copilot: (params: { question: string; mode?: string }) => {
      ctx.askCopilot(params.question, (params.mode as any) || 'quick');
      return `Opened copilot with: ${params.question}`;
    },

    prep_meeting: (params: { accountName?: string; meetingTitle?: string }) => {
      const q = params.accountName
        ? `Prep me for my meeting with ${params.accountName}${params.meetingTitle ? ` — ${params.meetingTitle}` : ''}`
        : 'Prep me for my next meeting';
      ctx.askCopilot(q, 'meeting');
      return `Preparing meeting brief`;
    },

    daily_briefing: () => {
      ctx.askCopilot('Walk me through my day — priorities, meetings, risks, and what I should focus on', 'quick');
      return 'Building daily briefing in copilot';
    },

    start_roleplay: (params: { call_type?: string; difficulty?: number; industry?: string }) => {
      ctx.navigate('/coach');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('voice-start-roleplay', { detail: params }));
      }, 500);
      return `Launching ${params.call_type || 'discovery'} roleplay`;
    },

    start_drill: () => {
      ctx.navigate('/coach');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('voice-start-drill'));
      }, 500);
      return 'Opening objection drills';
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
      toast.info('Opening Prep Hub', { description: params.contentType || 'Content builder' });
      return `Opened Prep Hub content builder${params.accountName ? ` for ${params.accountName}` : ''}`;
    },
  };
}

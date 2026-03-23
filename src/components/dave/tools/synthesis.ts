import type { ToolContext, ToolMap } from '../toolTypes';
import { operatingState } from './synthesis/operatingState';
import { primaryAction, completeAction, deferAction } from './synthesis/primaryAction';
import { momentumCheck, nextAction, killSwitch } from './synthesis/momentum';
import { behaviorSummary, energyMatch } from './synthesis/behaviorEnergy';
import { generateContent, meetingBrief } from './synthesis/contentBrief';
import { executionNext, confirmExecution, blockExecution, skipExecution, snoozeExecution } from './synthesis/executionBinding';
import { whoopPerformanceInsights, whoopTodayContext } from './synthesis/whoopInsights';
import { dailyGamePlanSummary, dailyGamePlanDetailed, dailyGamePlanWalkthrough, queryDailyPlan, newLogoTargetsTool } from './synthesis/dailyGamePlan';
import { queryOpportunities, queryRenewals, queryTasks, queryQuota, queryPipeline, queryDashboard } from './synthesis/walkthroughs';
import { compareTrends } from './synthesis/trendComparison';

export function createSynthesisTools(ctx: ToolContext, allTools: Record<string, any>): ToolMap {
  return {
    operating_state: () => operatingState(ctx),
    primary_action: () => primaryAction(ctx),
    complete_action: (params: { actionId: string }) => completeAction(params),
    defer_action: (params: { actionId: string; reason?: string }) => deferAction(params),
    execution_brief: async () => {
      const stateResult = await allTools.operating_state();
      const actionResult = await allTools.primary_action();
      return `${stateResult}\n\n${actionResult}`;
    },
    momentum_check: () => momentumCheck(ctx),
    next_action: () => nextAction(ctx),
    kill_switch: () => killSwitch(ctx),
    behavior_summary: () => behaviorSummary(),
    energy_match: () => energyMatch(ctx),
    generate_content: (params: { contentType: string; accountName?: string; opportunityName?: string; contactName?: string; customInstructions?: string }) => generateContent(ctx, params),
    meeting_brief: (params: { meetingTitle?: string }) => meetingBrief(ctx, params),
    execution_next: (params?: { liveMode?: boolean }) => executionNext(ctx, params),
    execution_next_live: () => executionNext(ctx, { liveMode: true }),
    confirm_execution: (params: { actionId: string }) => confirmExecution(params),
    block_execution: (params: { actionId: string; reason?: string }) => blockExecution(params),
    skip_execution: (params: { actionId: string; reason?: string }) => skipExecution(params),
    snooze_execution: (params: { actionId: string; minutes?: number }) => snoozeExecution(params),
    whoop_performance_insights: () => whoopPerformanceInsights(ctx),
    whoop_today_context: () => whoopTodayContext(ctx),
    daily_game_plan: () => dailyGamePlanSummary(ctx),
    daily_game_plan_detailed: () => dailyGamePlanDetailed(ctx),
    query_daily_plan: (params: { question: string }) => queryDailyPlan(ctx, params),
    new_logo_targets: () => newLogoTargetsTool(ctx),

    // Universal walkthrough tools
    query_opportunities: (params: { question?: string }) => queryOpportunities(ctx, params),
    query_renewals: (params: { question?: string }) => queryRenewals(ctx, params),
    query_tasks: (params: { question?: string }) => queryTasks(ctx, params),
    query_quota: (params: { question?: string }) => queryQuota(ctx, params),
    query_pipeline: (params: { question?: string }) => queryPipeline(ctx, params),
    query_dashboard: (params: { question?: string }) => queryDashboard(ctx, params),

    // Trend & comparison
    compare_trends: (params: { question?: string }) => compareTrends(ctx, params),
  };
}

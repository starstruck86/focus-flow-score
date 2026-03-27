import type { ToolContext, ToolMap } from '../toolTypes';
import { searchCrm, competitiveIntel } from './intelligence/search';
import { lookupContact, addContact, stakeholderQuery, contactTimeline } from './intelligence/contacts';
import { lookupRenewal, updateRenewal } from './intelligence/renewals';
import { readResource, searchResources, lookupTranscript, trendQuery } from './intelligence/resources';
import { bulkUpdate } from './intelligence/bulk';
import { citeInsight, knowledgeTrends, insightReliability, recommendStrategy, recordStrategyOutcome, strategyPerformance, pipelineImpact, recordPipelineEvent, pipelineForecast } from './intelligence/knowledge';
import { getPlaybookRecommendation } from './intelligence/playbooks';
import { startPlaybookRoleplay, endPlaybookRoleplay } from './intelligence/playbookRoleplay';

export function createIntelligenceTools(ctx: ToolContext): ToolMap {
  return {
    search_crm: (params: { query: string }) => searchCrm(ctx, params),
    lookup_contact: (params: { accountName: string }) => lookupContact(ctx, params),
    add_contact: (params: { name: string; title?: string; email?: string; accountName?: string; department?: string }) => addContact(ctx, params),
    lookup_transcript: (params: { accountName: string }) => lookupTranscript(ctx, params),
    lookup_renewal: (params: { timeframe?: string }) => lookupRenewal(ctx, params),
    update_renewal: (params: { accountName: string; field: string; value: string }) => updateRenewal(ctx, params),
    stakeholder_query: (params: { accountName: string; role?: string }) => stakeholderQuery(ctx, params),
    contact_timeline: (params: { contactName: string }) => contactTimeline(ctx, params),
    competitive_intel: (params: { query: string }) => competitiveIntel(ctx, params),
    trend_query: (params: { metric: string; period?: string }) => trendQuery(ctx, params),
    read_resource: (params: { title: string }) => readResource(ctx, params),
    search_resources: (params: { query: string }) => searchResources(ctx, params),
    bulk_update: (params: { entity: string; filter_field: string; filter_value: string; update_field: string; update_value: string }) => bulkUpdate(ctx, params),
    cite_insight: (params: { topic: string }) => citeInsight(ctx, params),
    knowledge_trends: (params: { category?: string }) => knowledgeTrends(ctx, params),
    insight_reliability: (params: { claim: string }) => insightReliability(ctx, params),
    recommend_strategy: (params: { topic: string; dealStage?: string; executionState?: string; accountType?: string; industry?: string }) => recommendStrategy(ctx, params),
    record_strategy_outcome: (params: { insightId: string; outcome: string; dealStage?: string; feedback?: string }) => recordStrategyOutcome(ctx, params),
    strategy_performance: (params: { topic?: string }) => strategyPerformance(ctx, params),
    pipeline_impact: () => pipelineImpact(ctx),
    record_pipeline_outcome: (params: { insightId: string; outcomeType: string; opportunityId?: string; dealValue?: number; fromStage?: string; toStage?: string }) => recordPipelineEvent(ctx, params),
    pipeline_forecast: () => pipelineForecast(ctx),
    get_playbook_recommendation: (params: { blockType?: string; dealStage?: string; dealStatus?: string; accountName?: string }) => getPlaybookRecommendation(ctx, params),
    start_playbook_roleplay: (params: { playbookTitle?: string; accountName?: string; dealStage?: string; dealStatus?: string; objection?: string }) => startPlaybookRoleplay(ctx, params),
    end_playbook_roleplay: () => endPlaybookRoleplay(ctx),
    start_daily_roleplay: async (params: { scenarioType?: string; persona?: string; industry?: string }) => {
      const { getRoleplayBlockConfig, recordRoleplayBlockEvent, buildDaveConfirmationPrompt } = await import('@/lib/dailyRoleplayBlock');
      const { todayInAppTz } = await import('@/lib/timeFormat');
      const config = getRoleplayBlockConfig();
      const scenario = params.scenarioType || config.defaultScenarioType;
      const persona = params.persona || config.defaultPersona;
      const industry = params.industry || config.defaultIndustry;
      recordRoleplayBlockEvent({
        date: todayInAppTz(),
        status: 'started',
        scenarioType: scenario,
        persona,
        industry,
        startedAt: new Date().toISOString(),
      });
      // Return confirmation prompt for Dave to speak
      return buildDaveConfirmationPrompt({ ...config, defaultScenarioType: scenario, defaultPersona: persona, defaultIndustry: industry });
    },
    complete_daily_roleplay: async (params: { durationUsed?: number }) => {
      const { getRoleplayBlockConfig, recordRoleplayBlockEvent } = await import('@/lib/dailyRoleplayBlock');
      const { todayInAppTz } = await import('@/lib/timeFormat');
      const config = getRoleplayBlockConfig();
      recordRoleplayBlockEvent({
        date: todayInAppTz(),
        status: 'completed',
        scenarioType: config.defaultScenarioType,
        persona: config.defaultPersona,
        industry: config.defaultIndustry,
        durationUsed: params.durationUsed,
        completedAt: new Date().toISOString(),
      });
      return 'Daily roleplay completed. Nice work — that\'s one more rep in the bank.';
    },
  };
}

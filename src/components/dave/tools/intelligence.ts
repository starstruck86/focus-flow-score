import type { ToolContext, ToolMap } from '../toolTypes';
import { searchCrm, competitiveIntel } from './intelligence/search';
import { lookupContact, addContact, stakeholderQuery, contactTimeline } from './intelligence/contacts';
import { lookupRenewal, updateRenewal } from './intelligence/renewals';
import { readResource, searchResources, lookupTranscript, trendQuery } from './intelligence/resources';
import { bulkUpdate } from './intelligence/bulk';
import { citeInsight, knowledgeTrends, insightReliability, recommendStrategy, recordStrategyOutcome, strategyPerformance, pipelineImpact, recordPipelineEvent } from './intelligence/knowledge';

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
  };
}

/**
 * Knowledge Extraction Pipeline
 *
 * Extracts structured knowledge items from resource content using AI.
 * Falls back to heuristic extraction when AI is unavailable.
 */

import type { KnowledgeItemInsert } from '@/hooks/useKnowledgeItems';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { createLogger } from '@/lib/logger';
import { inferTags, mergeTags } from '@/lib/resourceTags';

const log = createLogger('KnowledgeExtraction');

export interface ExtractionSource {
  resourceId: string;
  userId: string;
  title: string;
  content: string | null;
  description: string | null;
  tags: string[];
  resourceType: string;
}

const CHAPTER_SIGNALS: Array<{
  chapter: string;
  subChapters: string[];
  patterns: RegExp[];
  knowledgeType: 'skill' | 'product' | 'competitive';
}> = [
  {
    chapter: 'cold_calling',
    subChapters: ['openers', 'pattern_interrupts', 'personalization', 'call_structure', 'voicemail', 'tone_pacing'],
    patterns: [/cold call/i, /outbound/i, /opener/i, /dial/i, /prospecting call/i, /gatekeeper/i, /voicemail/i],
    knowledgeType: 'skill',
  },
  {
    chapter: 'discovery',
    subChapters: ['agenda_setting', 'excavating_pain', 'quantifying_impact', 'persona_questions', 'change_drivers'],
    patterns: [/discovery/i, /pain point/i, /qualifying/i, /open.ended question/i, /excavat/i, /impact/i],
    knowledgeType: 'skill',
  },
  {
    chapter: 'objection_handling',
    subChapters: ['price_objections', 'timing_objections', 'authority_objections', 'need_objections', 'rebuttal_frameworks'],
    patterns: [/objection/i, /pushback/i, /rebuttal/i, /overcome/i, /handle.*concern/i, /too expensive/i],
    knowledgeType: 'skill',
  },
  {
    chapter: 'negotiation',
    subChapters: ['anchoring', 'concessions', 'walk_away', 'pricing_tactics', 'bundling'],
    patterns: [/negotiat/i, /discount/i, /pricing/i, /concession/i, /anchor/i, /walk away/i],
    knowledgeType: 'skill',
  },
  {
    chapter: 'competitors',
    subChapters: ['pricing_traps', 'feature_gaps', 'positioning_angles', 'competitive_framing', 'win_stories'],
    patterns: [/competitor/i, /versus/i, /alternative/i, /compete/i, /battlecard/i, /displacement/i],
    knowledgeType: 'competitive',
  },
  {
    chapter: 'personas',
    subChapters: ['buyer_profiles', 'stakeholder_mapping', 'champion_building', 'economic_buyer'],
    patterns: [/persona/i, /buyer.*profile/i, /stakeholder/i, /champion/i, /economic.*buyer/i, /decision.*maker/i],
    knowledgeType: 'skill',
  },
  {
    chapter: 'messaging',
    subChapters: ['value_proposition', 'positioning', 'pitch_structure', 'narrative', 'email_templates'],
    patterns: [/messaging/i, /value.*prop/i, /positioning/i, /pitch/i, /narrative/i, /email.*template/i],
    knowledgeType: 'product',
  },
  {
    chapter: 'closing',
    subChapters: ['closing_techniques', 'urgency_creation', 'trial_close', 'commitment_getting'],
    patterns: [/clos(e|ing)/i, /ask.*for.*business/i, /urgency/i, /close.*deal/i, /commitment/i],
    knowledgeType: 'skill',
  },
  {
    chapter: 'stakeholder_navigation',
    subChapters: ['multi_threading', 'executive_engagement', 'internal_champions', 'buying_committee'],
    patterns: [/stakeholder/i, /multi.thread/i, /executive/i, /buying committee/i, /power map/i],
    knowledgeType: 'skill',
  },
  {
    chapter: 'expansion',
    subChapters: ['upsell', 'cross_sell', 'renewal_strategy', 'expansion_signals'],
    patterns: [/expan(d|sion)/i, /upsell/i, /cross.sell/i, /renewal/i, /grow.*account/i],
    knowledgeType: 'skill',
  },
];

// Product knowledge detection
const PRODUCT_PATTERNS = [
  /product capabilit/i, /feature/i, /differentiator/i, /implementation/i,
  /use case/i, /integration/i, /roadmap/i, /platform/i, /capability/i,
];

function detectCompetitor(text: string): string | null {
  const competitors = [
    'klaviyo', 'salesforce', 'hubspot', 'outreach', 'salesloft',
    'gong', 'chorus', 'clari', 'drift', 'intercom', 'zendesk',
    'marketo', 'pardot', 'mailchimp', 'braze', 'iterable',
    'attentive', 'postscript', 'yotpo', 'smile.io', 'nosto',
  ];
  const lower = text.toLowerCase();
  return competitors.find(c => lower.includes(c)) ?? null;
}

function detectProductArea(text: string): string | null {
  const areas = [
    { pattern: /email|sms|push notification/i, area: 'messaging_channels' },
    { pattern: /segment|audience|cohort/i, area: 'segmentation' },
    { pattern: /automat|flow|workflow|journey/i, area: 'automation' },
    { pattern: /analytic|report|dashboard|metric/i, area: 'analytics' },
    { pattern: /integrat|api|connect/i, area: 'integrations' },
    { pattern: /loyalt|reward|retention/i, area: 'loyalty' },
    { pattern: /personali[sz]/i, area: 'personalization' },
  ];
  return areas.find(a => a.pattern.test(text))?.area ?? null;
}

function classifySubChapter(text: string, subChapters: string[]): string | null {
  const lower = text.toLowerCase();
  for (const sub of subChapters) {
    const readable = sub.replace(/_/g, ' ');
    if (lower.includes(readable)) return sub;
  }
  return subChapters[0] ?? null;
}

/**
 * Heuristic extraction — produces knowledge items from resource content
 */
export function extractKnowledgeHeuristic(source: ExtractionSource): KnowledgeItemInsert[] {
  const { resourceId, userId, title, content, description, tags } = source;
  const text = [title, description, content].filter(Boolean).join('\n');
  const lower = text.toLowerCase();
  const items: KnowledgeItemInsert[] = [];

  if (text.length < 100) return items;

  // Detect competitor
  const competitor = detectCompetitor(text);
  const productArea = detectProductArea(text);

  // Check for product knowledge
  const isProductKnowledge = PRODUCT_PATTERNS.some(p => p.test(text));

  for (const signal of CHAPTER_SIGNALS) {
    const matches = signal.patterns.filter(p => p.test(lower));
    if (matches.length === 0) continue;

    const knowledgeType = competitor ? 'competitive' : isProductKnowledge ? 'product' : signal.knowledgeType;
    const confidence = Math.min(0.85, 0.35 + matches.length * 0.12);
    const subChapter = classifySubChapter(text, signal.subChapters);

    // Extract meaningful summary from content
    const summary = extractBestSummary(text, signal.patterns);

    // Build structured tags
    const baseTags = [...tags, knowledgeType, signal.chapter];
    const inferred = inferTags(text);
    const structuredTags = mergeTags(baseTags, inferred);

    items.push({
      user_id: userId,
      source_resource_id: resourceId,
      source_doctrine_id: null,
      title: `${title} — ${signal.chapter.replace(/_/g, ' ')}`,
      knowledge_type: knowledgeType,
      chapter: signal.chapter,
      sub_chapter: subChapter,
      competitor_name: competitor,
      product_area: productArea,
      applies_to_contexts: buildContexts(signal.chapter, knowledgeType),
      tactic_summary: summary,
      why_it_matters: null,
      when_to_use: null,
      when_not_to_use: null,
      example_usage: null,
      confidence_score: confidence,
      status: confidence >= 0.6 ? 'extracted' : 'review_needed',
      active: false,
      user_edited: false,
      tags: structuredTags,
    });
  }

  // If no chapter matched but content is substantial, create a general item
  if (items.length === 0 && text.length > 300) {
    const knowledgeType = competitor ? 'competitive' : isProductKnowledge ? 'product' : 'skill';
    const baseTags = [...tags, knowledgeType];
    const inferred = inferTags(text);
    const structuredTags = mergeTags(baseTags, inferred);

    items.push({
      user_id: userId,
      source_resource_id: resourceId,
      source_doctrine_id: null,
      title,
      knowledge_type: knowledgeType,
      chapter: 'messaging',
      sub_chapter: null,
      competitor_name: competitor,
      product_area: productArea,
      applies_to_contexts: ['dave', 'prep'],
      tactic_summary: description || text.slice(0, 300),
      why_it_matters: null,
      when_to_use: null,
      when_not_to_use: null,
      example_usage: null,
      confidence_score: 0.3,
      status: 'review_needed',
      active: false,
      user_edited: false,
      tags: structuredTags,
    });
  }

  return items;
}

function extractBestSummary(text: string, patterns: RegExp[]): string {
  const sentences = text.split(/[.!?]\s+/).filter(s => s.length > 20 && s.length < 500);
  // Find sentences matching the patterns
  const relevant = sentences.filter(s => patterns.some(p => p.test(s)));
  if (relevant.length > 0) return relevant.slice(0, 3).join('. ') + '.';
  // Fall back to first meaningful sentences
  return sentences.slice(0, 3).join('. ') + '.';
}

function buildContexts(chapter: string, type: string): string[] {
  const contexts = ['dave'];
  if (['cold_calling', 'discovery', 'objection_handling', 'negotiation', 'closing'].includes(chapter)) {
    contexts.push('roleplay', 'coaching');
  }
  if (type === 'competitive' || type === 'product') {
    contexts.push('prep');
  }
  contexts.push('playbooks');
  return contexts;
}

/**
 * AI-powered extraction using edge function
 */
export async function extractKnowledgeAI(source: ExtractionSource): Promise<KnowledgeItemInsert[]> {
  try {
    const result = await trackedInvoke<{ items?: any[] }>('extract-knowledge', {
      body: {
        resourceId: source.resourceId,
        title: source.title,
        content: source.content?.slice(0, 12000),
        description: source.description,
        tags: source.tags,
        resourceType: source.resourceType,
      },
    });

    if (result?.data?.items && Array.isArray(result.data.items)) {
      return result.data.items.map(item => ({
        user_id: source.userId,
        source_resource_id: source.resourceId,
        source_doctrine_id: null,
        title: item.title || source.title,
        knowledge_type: item.knowledge_type || 'skill',
        chapter: item.chapter || 'messaging',
        sub_chapter: item.sub_chapter || null,
        competitor_name: item.competitor_name || null,
        product_area: item.product_area || null,
        applies_to_contexts: item.applies_to_contexts || ['dave'],
        tactic_summary: item.tactic_summary || null,
        why_it_matters: item.why_it_matters || null,
        when_to_use: item.when_to_use || null,
        when_not_to_use: item.when_not_to_use || null,
        example_usage: item.example_usage || null,
        confidence_score: item.confidence_score || 0.5,
        status: item.confidence_score >= 0.7 ? 'extracted' : 'review_needed',
        active: false,
        user_edited: false,
        tags: item.tags || [...source.tags],
      }));
    }
  } catch (err) {
    log.warn('AI extraction failed, falling back to heuristic', { error: err });
  }

  // Fallback to heuristic
  return extractKnowledgeHeuristic(source);
}

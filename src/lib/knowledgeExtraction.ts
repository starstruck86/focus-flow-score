/**
 * Knowledge Extraction Pipeline
 *
 * Extracts ONLY actionable, execution-ready sales tactics from resource content.
 * Each item must describe a specific action a rep can take, be testable in a call/roleplay,
 * be tied to a moment (when to use), and phrased as a tactic, not a concept.
 *
 * Falls back to LLM-based extraction when heuristic returns 0 items.
 */

import type { KnowledgeItemInsert } from '@/hooks/useKnowledgeItems';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { createLogger } from '@/lib/logger';
import { inferTags, mergeTags } from '@/lib/resourceTags';
import { validateTrust, deduplicateKnowledgeItems, type TrustValidation } from '@/lib/trustValidation';
import { detectFramework } from '@/data/frameworkLibrary';

const log = createLogger('KnowledgeExtraction');

/** Decode common HTML entities that survive scraping */
function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D')
    .replace(/&lsquo;/g, '\u2018').replace(/&rsquo;/g, '\u2019')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export interface ExtractionSource {
  resourceId: string;
  userId: string;
  title: string;
  content: string | null;
  description: string | null;
  tags: string[];
  resourceType: string;
}

export interface ExtractionLog {
  resourceId: string;
  resourceTitle: string;
  extracted_count: number;
  activatable_count: number;
  rejected_reasons: string[];
  used_llm_fallback: boolean;
}

const TRANSCRIPT_LIKE_RESOURCE_TYPES = ['transcript', 'podcast', 'audio', 'podcast_episode', 'video', 'recording'] as const;
const LESSON_TRANSCRIPT_MARKER = '--- Video Transcript ---';

export function getTranscriptPreparationState(content: string | null | undefined, resourceType: string | null | undefined, title?: string | null) {
  const normalizedContent = content || '';
  const normalizedType = (resourceType || '').toLowerCase();
  const isTranscriptResource = TRANSCRIPT_LIKE_RESOURCE_TYPES.includes(normalizedType as typeof TRANSCRIPT_LIKE_RESOURCE_TYPES[number]);
  const headingCount = isTranscriptResource ? (normalizedContent.match(/^## /gm)?.length ?? 0) : 0;
  const transcriptMarkerIndex = normalizedContent.indexOf(LESSON_TRANSCRIPT_MARKER);
  const hasLessonBody = transcriptMarkerIndex > 500;

  // Structured course lessons use "Course Name > Lesson Name" format.
  // These contain rich lesson text that doesn't need ## headings or transcript markers.
  const isStructuredCourseLesson = !!(title && /\s>\s/.test(title));
  const hasSufficientContent = normalizedContent.length >= 500;
  const courseReady = isStructuredCourseLesson && hasSufficientContent;

  const transcriptReady = !isTranscriptResource || hasLessonBody || headingCount >= 2 || courseReady;

  return {
    isTranscriptResource,
    headingCount,
    hasLessonBody,
    transcriptReady,
    isStructuredCourseLesson,
  };
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
  {
    chapter: 'demo',
    subChapters: ['demo_structure', 'storytelling', 'feature_bridging', 'interactive_demo'],
    patterns: [/demo/i, /presentation/i, /show.*product/i, /walk.*through/i, /live.*demo/i],
    knowledgeType: 'skill',
  },
  {
    chapter: 'follow_up',
    subChapters: ['email_follow_up', 'recap', 'next_steps', 'cadence'],
    patterns: [/follow.up/i, /recap/i, /next step/i, /cadence/i, /sequence/i],
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

// ── Actionability scoring ──────────────────────────────────

function scoreActionability(item: {
  title: string;
  tactic_summary: string | null;
  when_to_use: string | null;
  example_usage: string | null;
}): { score: number; reasons: string[] } {
  let score = 0.1; // base
  const reasons: string[] = [];

  const summary = (item.tactic_summary ?? '').trim();
  const title = item.title.trim();

  // +0.3 if actionable (title or summary starts with a verb)
  const verbStarters = /^(ask|use|open|start|say|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|try|respond|handle|counter|address|lead|drive|close|send|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|contrast|qualify|disqualify|recap|summarize)/i;
  if (verbStarters.test(title) || verbStarters.test(summary)) {
    score += 0.3;
    reasons.push('actionable_verb');
  }

  // +0.2 if tied to specific moment
  if (item.when_to_use && item.when_to_use.length >= 15) {
    score += 0.2;
    reasons.push('moment_tied');
  }

  // +0.2 if includes talk track / example
  if (item.example_usage && item.example_usage.length >= 20) {
    score += 0.2;
    reasons.push('has_talk_track');
  }

  // +0.2 if clearly testable in roleplay (has concrete language patterns)
  const testablePatterns = /["']|say something like|try saying|you could say|ask them|respond with|phrase it as/i;
  const combinedText = `${summary} ${item.example_usage ?? ''}`;
  if (testablePatterns.test(combinedText)) {
    score += 0.2;
    reasons.push('testable_in_roleplay');
  }

  return { score: Math.min(1.0, score), reasons };
}

// ── Tactic extraction from sentences ───────────────────────

interface ExtractedTactic {
  title: string;
  tactic_summary: string;
  when_to_use: string;
  when_not_to_use: string;
  example_usage: string;
  chapter: string;
  sub_chapter: string | null;
  knowledge_type: 'skill' | 'product' | 'competitive';
  who?: string | null;
  framework?: string | null;
}

/**
 * Attempt to extract actionable tactics from text, not summaries.
 * Looks for imperative sentences, how-to patterns, talk tracks, etc.
 */
function extractTacticsFromText(
  text: string,
  matchedSignal: typeof CHAPTER_SIGNALS[0],
): ExtractedTactic[] {
  const tactics: ExtractedTactic[] = [];
  const sentences = text
    .split(/[.!?\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 25 && s.length < 600);

  // Patterns indicating an actionable tactic
  const tacticIndicators = [
    /^(ask|use|open|start|say|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|try|respond|handle|counter|address|lead|drive|close|send|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|qualify|recap|summarize)/i,
    /you (can|should|could|might|want to|need to)/i,
    /try (saying|asking|opening|using|framing)/i,
    /["'"].*["'"]/,  // contains a quote (talk track)
    /instead of.*try/i,
    /when.*then/i,
    /if (they|the prospect|the buyer|the customer)/i,
    /one (technique|approach|way|method|tactic|strategy)/i,
  ];

  // When-to-use indicators
  const whenIndicators = [
    /when (the|a|your|they|you)/i,
    /if (the|a|your|they|you)/i,
    /during (the|a|your)/i,
    /at the (start|beginning|end|close)/i,
    /after (the|a|your)/i,
    /before (the|a|your)/i,
    /in (discovery|demo|closing|negotiation|objection)/i,
  ];

  // Example/talk-track indicators
  const exampleIndicators = [
    /["'"].*["'"]/,
    /say something like/i,
    /try saying/i,
    /for example/i,
    /such as/i,
    /you could say/i,
    /phrase it/i,
    /word it/i,
  ];

  // Anti-patterns: summaries, concepts, not tactics
  const antiPatterns = [
    /^(this|the|it|there|that|we|our|they|their|his|her|in this|what is|a study|research|according)/i,
    /^(important|key|critical|essential|necessary|vital|crucial) (to|that|is)/i,
    /is (defined|described|characterized|known|considered)/i,
  ];

  // Group sentences into potential tactics
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];

    // Skip non-actionable
    if (antiPatterns.some(p => p.test(s))) continue;

    // Must match at least one tactic indicator
    if (!tacticIndicators.some(p => p.test(s))) continue;

    // Build when_to_use from nearby sentences
    let when_to_use = '';
    let when_not_to_use = '';
    let example_usage = '';

    // Look at surrounding sentences for context
    const window = sentences.slice(Math.max(0, i - 2), Math.min(sentences.length, i + 4));
    for (const nearby of window) {
      if (nearby === s) continue;
      if (!when_to_use && whenIndicators.some(p => p.test(nearby))) {
        when_to_use = nearby;
      }
      if (!example_usage && exampleIndicators.some(p => p.test(nearby))) {
        example_usage = nearby;
      }
      if (!when_not_to_use && /don't|avoid|never|not when|won't work/i.test(nearby)) {
        when_not_to_use = nearby;
      }
    }

    // If no example from nearby, check if the tactic itself contains a quote
    if (!example_usage && /["'"]/.test(s)) {
      example_usage = s;
    }

    // Build a short actionable title
    const titleWords = s.split(/\s+/).slice(0, 8).join(' ');
    const title = titleWords.charAt(0).toUpperCase() + titleWords.slice(1);

    const subChapter = classifySubChapter(s, matchedSignal.subChapters);

    tactics.push({
      title,
      tactic_summary: s,
      when_to_use: when_to_use || `When in a ${matchedSignal.chapter.replace(/_/g, ' ')} conversation`,
      when_not_to_use: when_not_to_use || '',
      example_usage: example_usage || '',
      chapter: matchedSignal.chapter,
      sub_chapter: subChapter,
      knowledge_type: matchedSignal.knowledgeType,
    });
  }

  return tactics;
}

/**
 * Heuristic extraction — produces ONLY actionable, execution-ready sales tactics.
 * Returns an ExtractionLog alongside the items for auditing.
 */
export function extractKnowledgeHeuristic(
  source: ExtractionSource,
  existingItems: Array<{ title: string; tactic_summary?: string | null }> = []
): KnowledgeItemInsert[] {
  const { resourceId, userId, title, content, description, tags } = source;
  const text = decodeHTMLEntities([title, description, content].filter(Boolean).join('\n'));
  const rawItems: KnowledgeItemInsert[] = [];
  const rejectedReasons: string[] = [];

  if (text.length < 100) return rawItems;

  const competitor = detectCompetitor(text);
  const productArea = detectProductArea(text);
  const isProductKnowledge = PRODUCT_PATTERNS.some(p => p.test(text));
  const lower = text.toLowerCase();

  // Collect all chapter matches with their match strength
  const chapterMatches: Array<{ signal: typeof CHAPTER_SIGNALS[0]; matchCount: number }> = [];
  for (const signal of CHAPTER_SIGNALS) {
    const matches = signal.patterns.filter(p => p.test(lower));
    if (matches.length > 0) {
      chapterMatches.push({ signal, matchCount: matches.length });
    }
  }

  // Pick the BEST chapter (most pattern matches) to avoid cross-chapter duplication.
  // Only fall back to multiple chapters if they have equal match strength.
  chapterMatches.sort((a, b) => b.matchCount - a.matchCount);
  const bestMatchCount = chapterMatches[0]?.matchCount ?? 0;
  const topChapters = chapterMatches.filter(c => c.matchCount === bestMatchCount);

  // Track tactic_summary fingerprints to prevent cross-chapter duplication
  const seenTacticSummaries = new Set<string>();

  for (const { signal } of topChapters) {
    const knowledgeType = competitor ? 'competitive' : isProductKnowledge ? 'product' : signal.knowledgeType;
    const tactics = extractTacticsFromText(text, signal);

    if (tactics.length === 0) {
      rejectedReasons.push(`${signal.chapter}: no actionable tactics found`);
      continue;
    }

    for (const tactic of tactics) {
      // Skip if we already produced a KI with the same tactic_summary
      const summaryFingerprint = tactic.tactic_summary.toLowerCase().trim();
      if (seenTacticSummaries.has(summaryFingerprint)) continue;
      seenTacticSummaries.add(summaryFingerprint);
      const baseTags = [...tags, knowledgeType, tactic.chapter];
      const inferred = inferTags(text);
      const structuredTags = mergeTags(baseTags, inferred);

      const { score: confidence } = scoreActionability({
        title: tactic.title,
        tactic_summary: tactic.tactic_summary,
        when_to_use: tactic.when_to_use,
        example_usage: tactic.example_usage,
      });

      if (confidence < 0.3) {
        rejectedReasons.push(`${tactic.title}: confidence too low (${(confidence * 100).toFixed(0)}%)`);
        continue;
      }

      if (!tactic.tactic_summary || tactic.tactic_summary.length < 20) {
        rejectedReasons.push(`${tactic.title}: tactic_summary too short`);
        continue;
      }

      // Trust validation: 5-gate check
      const trust = validateTrust(
        {
          title: tactic.title,
          tactic_summary: tactic.tactic_summary,
          when_to_use: tactic.when_to_use,
          example_usage: tactic.example_usage,
          chapter: tactic.chapter,
        },
        existingItems
      );

      // Only auto-activate if ALL gates pass
      const autoActivate = trust.passed && confidence >= 0.4;

      rawItems.push({
        user_id: userId,
        source_resource_id: resourceId,
        source_doctrine_id: null,
        title: tactic.title,
        knowledge_type: knowledgeType,
        chapter: tactic.chapter,
        sub_chapter: tactic.sub_chapter,
        competitor_name: competitor,
        product_area: productArea,
        applies_to_contexts: buildContexts(tactic.chapter, knowledgeType),
        tactic_summary: tactic.tactic_summary,
        why_it_matters: null,
        when_to_use: tactic.when_to_use || null,
        when_not_to_use: tactic.when_not_to_use || null,
        example_usage: tactic.example_usage || null,
        macro_situation: null,
        micro_strategy: null,
        how_to_execute: null,
        what_this_unlocks: null,
        source_excerpt: null,
        source_title: title,
        source_location: null,
        confidence_score: trust.overall,
        status: autoActivate ? 'active' : (trust.failedGates.length <= 1 ? 'extracted' : 'review_needed'),
        active: autoActivate,
        user_edited: false,
        tags: structuredTags,
        who: tactic.who || null,
        framework: tactic.framework || null,
      });
    }
  }

  // Deduplicate against existing + intra-batch
  const { kept, duplicates } = deduplicateKnowledgeItems(rawItems, existingItems);
  if (duplicates.length > 0) {
    rejectedReasons.push(`${duplicates.length} duplicates suppressed`);
  }

  log.info('Heuristic extraction complete', {
    resourceId,
    resourceTitle: title,
    extracted_count: kept.length,
    rejected_duplicates: duplicates.length,
    rejected_reasons: rejectedReasons.slice(0, 10),
    used_llm_fallback: false,
  });

  return kept;
}

/**
 * Get a structured extraction log without producing items.
 */
export function getExtractionLog(source: ExtractionSource, items: KnowledgeItemInsert[], usedLlm: boolean): ExtractionLog {
  const activatable = items.filter(i => (i.confidence_score ?? 0) >= 0.55);
  const reasons: string[] = [];
  if (items.length === 0) reasons.push('no_tactics_found');
  else {
    const lowConf = items.filter(i => (i.confidence_score ?? 0) < 0.55);
    if (lowConf.length > 0) reasons.push(`${lowConf.length} items below activation threshold`);
    const missingFields = items.filter(i => !i.when_to_use || !i.tactic_summary);
    if (missingFields.length > 0) reasons.push(`${missingFields.length} items missing required fields`);
  }
  return {
    resourceId: source.resourceId,
    resourceTitle: source.title,
    extracted_count: items.length,
    activatable_count: activatable.length,
    rejected_reasons: reasons,
    used_llm_fallback: usedLlm,
  };
}

function buildContexts(chapter: string, type: string): string[] {
  const contexts = ['dave'];
  if (['cold_calling', 'discovery', 'objection_handling', 'negotiation', 'closing', 'demo', 'follow_up'].includes(chapter)) {
    contexts.push('roleplay', 'coaching');
  }
  if (type === 'competitive' || type === 'product') {
    contexts.push('prep');
  }
  contexts.push('playbooks');
  return contexts;
}

/**
 * LLM-based fallback extraction via edge function.
 * Called when heuristic returns 0 items for content-backed resources.
 */
export async function extractKnowledgeLLMFallback(
  source: ExtractionSource,
  existingItems: Array<{ title: string; tactic_summary?: string | null }> = []
): Promise<KnowledgeItemInsert[]> {
  try {
    log.info('Running LLM fallback extraction', { resourceId: source.resourceId, title: source.title });

    const contentStr = source.content || '';
    const { isTranscriptResource, headingCount, hasLessonBody, transcriptReady } = getTranscriptPreparationState(
      contentStr,
      source.resourceType,
    );

    // Pre-extraction gate: audio/transcript resources MUST have been preprocessed
    // (indicated by ## section headings). Raw transcripts produce garbage KIs.
    // Exception: course lesson videos with a substantial lesson body before the
    // transcript marker are valid extraction sources as-is.
    if (isTranscriptResource && !transcriptReady) {
      log.warn('Blocked KI extraction: transcript not preprocessed (missing ## headings)', {
        resourceId: source.resourceId,
        headingCount,
        hasLessonBody,
        contentLength: contentStr.length,
      });
      return [];
    }

    // No client-side content cap — server-side extract-tactics handles chunking
    // for arbitrarily long transcripts via section-aware splitting
    const result = await trackedInvoke<{ items?: any[] }>('extract-tactics', {
      body: {
        resourceId: source.resourceId,
        title: source.title,
        content: source.content,
        description: source.description,
        tags: source.tags,
        resourceType: source.resourceType,
      },
      // Transcripts can be large and need more time for multi-chunk extraction
      timeoutMs: isTranscriptResource ? 120_000 : 60_000,
    });

    if (result?.data?.items && Array.isArray(result.data.items)) {
      const rawItems: KnowledgeItemInsert[] = [];
      for (const item of result.data.items) {
        if (!item.tactic_summary || item.tactic_summary.length < 20) continue;
        if (!item.when_to_use || item.when_to_use.length < 10) continue;
        if (!item.title || item.title.length < 5) continue;

        // Structural quality gate: reject transcript fragments posing as KIs
        // A proper KI title should be an action phrase, not a sentence fragment
        const titleLooksLikeSentence = item.title.length > 60 && !/^(ask|use|open|start|say|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|respond|handle|counter|address|lead|drive|close|send|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|qualify|recap|summarize)/i.test(item.title);
        const summaryIsSameAsTitle = item.tactic_summary.toLowerCase().startsWith(item.title.toLowerCase().slice(0, 30));
        if (titleLooksLikeSentence && summaryIsSameAsTitle) {
          log.info('Rejected transcript-fragment KI', { title: item.title.slice(0, 50) });
          continue;
        }

        // Trust validation
        const trust = validateTrust(
          {
            title: item.title,
            tactic_summary: item.tactic_summary,
            when_to_use: item.when_to_use,
            example_usage: item.example_usage,
            chapter: item.chapter || 'messaging',
          },
          existingItems
        );

        const autoActivate = trust.passed && trust.overall >= 0.4;

        const ki: KnowledgeItemInsert = {
          user_id: source.userId,
          source_resource_id: source.resourceId,
          source_doctrine_id: null,
          title: item.title,
          knowledge_type: item.knowledge_type || 'skill',
          chapter: item.chapter || 'messaging',
          sub_chapter: item.sub_chapter || null,
          competitor_name: item.competitor_name || detectCompetitor(item.tactic_summary || ''),
          product_area: item.product_area || null,
          applies_to_contexts: item.applies_to_contexts || buildContexts(item.chapter || 'messaging', item.knowledge_type || 'skill'),
          tactic_summary: item.tactic_summary,
          why_it_matters: item.why_it_matters || null,
          when_to_use: item.when_to_use,
          when_not_to_use: item.when_not_to_use || null,
          example_usage: item.example_usage || null,
          macro_situation: item.macro_situation || null,
          micro_strategy: item.micro_strategy || null,
          how_to_execute: item.how_to_execute || null,
          what_this_unlocks: item.what_this_unlocks || null,
          source_excerpt: item.source_excerpt || null,
          source_title: source.title || null,
          source_location: item.source_location || null,
          confidence_score: trust.overall,
          status: autoActivate ? 'active' : (trust.failedGates.length <= 1 ? 'extracted' : 'review_needed'),
          active: autoActivate,
          user_edited: false,
          tags: [...source.tags, item.knowledge_type || 'skill', item.chapter || 'messaging'],
          who: item.who || null,
          framework: item.framework || null,
        };

        // Conservative auto-attribution with provenance tracking
        const WEAK_WHO = ['', 'unknown', 'host', 'speaker', 'host of podcast'];
        const WEAK_FRAMEWORK = ['', 'general', 'unknown'];
        const whoIsWeak = !ki.who || WEAK_WHO.includes((ki.who || '').toLowerCase().trim());
        const frameworkIsWeak = !ki.framework || WEAK_FRAMEWORK.includes((ki.framework || '').toLowerCase().trim());

        // Attribution provenance metadata (persisted in activation_metadata)
        const attributionProvenance: Record<string, string> = {
          who_source: 'llm',
          framework_source: 'llm',
        };

        if (whoIsWeak || frameworkIsWeak) {
          // Try strong-signal sources in priority order
          const strongSources: { label: string; text: string }[] = [
            { label: 'resource_title', text: source.title || '' },
            { label: 'resource_description', text: source.description || '' },
            { label: 'source_excerpt', text: item.source_excerpt || '' },
            { label: 'tactic_summary', text: item.tactic_summary || '' },
          ];

          let detected: ReturnType<typeof detectFramework> = null;
          let signalSource = '';

          for (const src of strongSources) {
            if (!src.text) continue;
            const match = detectFramework(src.text);
            if (match) {
              detected = match;
              signalSource = src.label;
              break;
            }
          }

          if (detected) {
            const oldWho = ki.who;
            const oldFramework = ki.framework;
            let changed = false;

            if (whoIsWeak) {
              ki.who = detected.who;
              attributionProvenance.who_source = whoIsWeak && !oldWho ? 'framework_library_fill' : 'framework_library_override';
              attributionProvenance.signal_source = signalSource;
              changed = true;
            }
            if (frameworkIsWeak) {
              ki.framework = detected.framework;
              attributionProvenance.framework_source = frameworkIsWeak && !oldFramework ? 'framework_library_fill' : 'framework_library_override';
              attributionProvenance.signal_source = signalSource;
              changed = true;
            }

            if (changed) {
              log.info('Attribution auto-corrected', {
                title: ki.title,
                oldWho,
                newWho: ki.who,
                oldFramework,
                newFramework: ki.framework,
                who_source: attributionProvenance.who_source,
                framework_source: attributionProvenance.framework_source,
                signalSource,
                reason: `LLM returned weak values (who="${oldWho}", framework="${oldFramework}"), detected from ${signalSource}`,
              });
            }
          }
        } else {
          // LLM returned specific values — preserve them
          log.debug('Attribution preserved from LLM', {
            title: ki.title,
            who: ki.who,
            framework: ki.framework,
            provenance: 'llm',
          });
        }

        // Merge attribution provenance into activation_metadata
        (ki as any).activation_metadata = {
          ...((ki as any).activation_metadata || {}),
          attribution: attributionProvenance,
        };

        rawItems.push(ki);
      }

      // Deduplicate
      const { kept, duplicates } = deduplicateKnowledgeItems(rawItems, existingItems);

      log.info('LLM fallback extraction complete', {
        resourceId: source.resourceId,
        extracted: kept.length,
        duplicates_suppressed: duplicates.length,
      });

      return kept;
    }
  } catch (err) {
    log.warn('LLM fallback extraction failed', { resourceId: source.resourceId, error: err });
  }

  return [];
}

/**
 * AI-powered extraction using edge function (legacy compat)
 */
export async function extractKnowledgeAI(
  source: ExtractionSource,
  existingItems: Array<{ title: string; tactic_summary?: string | null }> = []
): Promise<KnowledgeItemInsert[]> {
  // Always prefer LLM — heuristic produces low-quality sentence fragments
  if ((source.content?.length ?? 0) >= 100) {
    try {
      const llmItems = await extractKnowledgeLLMFallback(source, existingItems);
      if (llmItems.length > 0) return llmItems;
    } catch {
      // LLM failed, fall through to heuristic
    }
  }

  // Heuristic fallback only for non-audio types — audio/podcast heuristic produces garbage
  const isAudioType = ['transcript', 'podcast', 'audio', 'podcast_episode', 'video', 'recording'].includes(
    source.resourceType.toLowerCase()
  );
  if (!isAudioType) {
    const heuristicItems = extractKnowledgeHeuristic(source, existingItems);
    if (heuristicItems.length > 0) return heuristicItems;
  }

  log.warn('Both LLM and heuristic extraction returned 0 items', {
    resourceId: source.resourceId,
    contentLength: source.content?.length ?? 0,
  });

  return [];
}

/**
 * Dave Session Prefetch — Pre-buffer content for driving sessions.
 *
 * Fetches upcoming content before the user needs it so that
 * 2–5 minutes of session material is available even during
 * brief connectivity drops.
 *
 * Content is text-only (TTS calls happen at delivery time).
 */

import { createLogger } from '@/lib/logger';
import type { SpeechQueueItem } from '@/lib/daveVoiceRuntime';

const logger = createLogger('DaveSessionPrefetch');

// ── Prefetch Cache ────────────────────────────────────────────

export interface PrefetchedContent {
  id: string;
  /** Speech items ready for Dave to deliver */
  items: SpeechQueueItem[];
  /** Surface-specific metadata (scenario, block info, etc.) */
  meta: Record<string, unknown>;
  fetchedAt: number;
}

/**
 * In-memory ring buffer of prefetched content.
 * No persistence needed — this is ephemeral caching for the current session.
 */
export class PrefetchCache {
  private cache: PrefetchedContent[] = [];
  private maxItems: number;

  constructor(maxItems = 10) {
    this.maxItems = maxItems;
  }

  get length(): number { return this.cache.length; }

  add(content: PrefetchedContent): void {
    // Deduplicate by id
    if (this.cache.some(c => c.id === content.id)) return;
    this.cache.push(content);
    // Evict oldest if over max
    if (this.cache.length > this.maxItems) {
      this.cache.shift();
    }
    logger.info('Content prefetched', { id: content.id, cacheSize: this.cache.length });
  }

  get(id: string): PrefetchedContent | null {
    return this.cache.find(c => c.id === id) ?? null;
  }

  /** Get next N items of prefetched content */
  getNext(count: number): PrefetchedContent[] {
    return this.cache.slice(0, count);
  }

  consume(id: string): PrefetchedContent | null {
    const idx = this.cache.findIndex(c => c.id === id);
    if (idx === -1) return null;
    return this.cache.splice(idx, 1)[0];
  }

  clear(): void {
    this.cache = [];
  }

  /** Estimate minutes of speech content cached (rough: 150 words/min) */
  estimateMinutesCached(): number {
    let totalWords = 0;
    for (const content of this.cache) {
      for (const item of content.items) {
        totalWords += item.text.split(/\s+/).length;
      }
    }
    return Math.round((totalWords / 150) * 10) / 10;
  }
}

// ── Prefetch Strategies ───────────────────────────────────────

/**
 * Prefetch Dojo scenario content.
 * Scenario text is already local — this just prepares it for speech queue format.
 */
export function prefetchDojoScenario(
  scenario: { title: string; context: string; objection: string },
  retryGuidance?: string,
): PrefetchedContent {
  const items: SpeechQueueItem[] = [
    { text: `Here's the situation. ${scenario.context}`, pauseAfter: 1000 },
    { text: `The buyer says: "${scenario.objection}". How do you respond?`, pauseAfter: 0 },
  ];

  if (retryGuidance) {
    items.push({ text: `If you retry: ${retryGuidance}`, pauseAfter: 0 });
  }

  return {
    id: `dojo-${scenario.title}`,
    items,
    meta: { title: scenario.title },
    fetchedAt: Date.now(),
  };
}

/**
 * Prefetch Skill Builder blocks.
 * Converts upcoming blocks into speech queue format.
 */
export function prefetchSkillBuilderBlocks(
  blocks: Array<{ type: string; text?: string; title?: string; scenarioPrompt?: string }>,
  startIndex: number,
  count = 5,
): PrefetchedContent[] {
  const results: PrefetchedContent[] = [];
  const end = Math.min(startIndex + count, blocks.length);

  for (let i = startIndex; i < end; i++) {
    const block = blocks[i];
    if (!block.text && !block.scenarioPrompt) continue;

    const items: SpeechQueueItem[] = [];
    const content = block.text || block.scenarioPrompt || '';

    switch (block.type) {
      case 'mental_model': {
        const sentences = content.match(/[^.!?]+[.!?]+/g) ?? [content];
        for (const s of sentences) {
          items.push({ text: s.trim(), pauseAfter: 1000 });
        }
        break;
      }
      case 'ki_explanation':
        items.push({ text: `Here's the key insight. ${content}`, pauseAfter: 1200 });
        break;
      case 'coaching_snippet':
        items.push({ text: content, pauseAfter: 800 });
        break;
      case 'recap':
        items.push({ text: `Let's recap. ${content}`, pauseAfter: 1000 });
        break;
      case 'rep':
        items.push({ text: content, pauseAfter: 0 });
        break;
    }

    results.push({
      id: `sb-block-${i}`,
      items,
      meta: { blockIndex: i, type: block.type, title: block.title },
      fetchedAt: Date.now(),
    });
  }

  return results;
}

/**
 * Prefetch Learn coaching units.
 */
export function prefetchLearnUnits(
  units: Array<{
    title: string;
    concept: string;
    example?: string;
    counterexample?: string;
    cheat?: string;
    reflectionQuestion?: string;
  }>,
  startIndex: number,
  count = 3,
): PrefetchedContent[] {
  const results: PrefetchedContent[] = [];
  const end = Math.min(startIndex + count, units.length);

  for (let i = startIndex; i < end; i++) {
    const unit = units[i];
    const items: SpeechQueueItem[] = [
      { text: unit.concept, pauseAfter: 1200 },
    ];
    if (unit.example) {
      items.push({ text: `Here's an example. ${unit.example}`, pauseAfter: 1000 });
    }
    if (unit.counterexample) {
      items.push({ text: `Now, what NOT to do. ${unit.counterexample}`, pauseAfter: 1000 });
    }
    if (unit.cheat) {
      items.push({ text: `Quick tip: ${unit.cheat}`, pauseAfter: 800 });
    }
    if (unit.reflectionQuestion) {
      items.push({ text: unit.reflectionQuestion, pauseAfter: 0 });
    }

    results.push({
      id: `learn-unit-${i}`,
      items,
      meta: { unitIndex: i, title: unit.title },
      fetchedAt: Date.now(),
    });
  }

  return results;
}

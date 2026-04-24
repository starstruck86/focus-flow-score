/**
 * Thread Naming — deterministic, workspace-aware titles.
 *
 * Rule: every thread should read like "Brainstorm · CMO messaging angles"
 * — never "Untitled thread". We derive the title from the user's first
 * prompt (first ~6 meaningful words, title-cased) and prefix it with the
 * originating workspace label.
 *
 * Pure client-side. Cheap. Deterministic. No backend cost.
 *
 * Future upgrade path: an LLM pass can replace `deriveTitleFromPrompt`
 * after the first assistant reply lands, without changing call sites.
 */
import type { StrategySurfaceKey } from '@/components/strategy/v2/StrategyNavSidebar';
import { getThreadTag } from './threadTags';
import type { StrategyThread } from '@/types/strategy';

/** Human-facing label for each surface — used as the title prefix. */
export const WORKSPACE_LABEL: Record<StrategySurfaceKey, string> = {
  brainstorm: 'Brainstorm',
  deep_research: 'Deep Research',
  refine: 'Refine',
  library: 'Library',
  artifacts: 'Artifacts',
  projects: 'Projects',
  work: 'Work',
};

/** Compact label for badges/chips. */
export const WORKSPACE_SHORT: Record<StrategySurfaceKey, string> = {
  brainstorm: 'Brainstorm',
  deep_research: 'Deep Research',
  refine: 'Refine',
  library: 'Library',
  artifacts: 'Artifacts',
  projects: 'Projects',
  work: 'Work',
};

/** True when the stored title is missing or a legacy "Untitled …" placeholder. */
export function isUntitledTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  return /^untitled/i.test(title.trim());
}

/** Strip noise tokens from a prompt so we get a clean title fragment. */
function cleanPrompt(prompt: string): string {
  return prompt
    .replace(/```[\s\S]*?```/g, ' ')          // fenced code
    .replace(/`[^`]*`/g, ' ')                  // inline code
    .replace(/^\s*[-*•]\s+/gm, ' ')            // list bullets
    .replace(/[#>*_~`[\](){}<>|]/g, ' ')       // markdown / brackets
    .replace(/https?:\/\/\S+/g, ' ')           // URLs
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','if','then','of','to','in','on','at','by','for',
  'with','as','is','are','was','were','be','been','being','this','that','these',
  'those','it','its','can','could','would','should','may','might','will','shall',
  'do','does','did','have','has','had','please','help','me','i','you','your','my',
  'we','our','us','about','from','into','over','under','out',
]);

function titleCase(token: string): string {
  if (!token) return token;
  // Preserve well-known acronyms / casing
  if (/^[A-Z]{2,}$/.test(token)) return token;
  return token[0].toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * Derive a short, scannable title fragment from a prompt.
 * Strategy:
 *   1. Try the first sentence (≤ 60 chars) verbatim if it's short and clean.
 *   2. Otherwise, pull the first 6 non-stopword tokens and title-case them.
 */
export function deriveTitleFromPrompt(prompt: string, maxWords = 6): string {
  const cleaned = cleanPrompt(prompt);
  if (!cleaned) return 'New thread';

  // Short sentence path
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
  if (firstSentence.length > 0 && firstSentence.length <= 60) {
    // Drop trailing punctuation
    const trimmed = firstSentence.replace(/[.!?,;:]+$/, '').trim();
    if (trimmed.length >= 6) return trimmed;
  }

  // Token path
  const tokens = cleaned.split(/\s+/);
  const meaningful: string[] = [];
  for (const raw of tokens) {
    const t = raw.replace(/[.,;:!?]+$/, '');
    if (!t) continue;
    if (STOP_WORDS.has(t.toLowerCase()) && meaningful.length === 0) continue;
    meaningful.push(t);
    if (meaningful.length >= maxWords) break;
  }
  if (meaningful.length === 0) return 'New thread';
  return meaningful.map(titleCase).join(' ');
}

/**
 * Build the full title: "Brainstorm · CMO messaging angles".
 * If `surface` is 'work' or null, no prefix is applied.
 */
export function buildWorkspaceTitle(
  prompt: string,
  surface: StrategySurfaceKey | null,
): string {
  const fragment = deriveTitleFromPrompt(prompt);
  if (!surface || surface === 'work') return fragment;
  const label = WORKSPACE_LABEL[surface];
  return `${label} · ${fragment}`;
}

/**
 * Resolve a friendly display title for a thread.
 *   - Real, non-Untitled title → return as-is
 *   - Untitled + tagged       → "Brainstorm · New thread"
 *   - Untitled + no tag       → "New thread"
 *
 * This is the single place every UI surface should call when rendering
 * a thread title — keeps "Untitled thread" out of the product entirely.
 */
export function displayThreadTitle(thread: StrategyThread): string {
  if (!isUntitledTitle(thread.title)) return thread.title!;
  const tag = getThreadTag(thread.id);
  if (tag && tag !== 'work') {
    return `${WORKSPACE_LABEL[tag]} · New thread`;
  }
  return 'New thread';
}

/**
 * True when a thread still uses the auto-generated "New thread" placeholder
 * (i.e. the user hasn't sent a real prompt yet).
 */
export function needsName(thread: StrategyThread): boolean {
  return isUntitledTitle(thread.title);
}

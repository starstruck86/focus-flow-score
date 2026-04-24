/**
 * Thread Tags — frontend-only mapping of thread.id → originating surface.
 *
 * When a user runs a workflow from a surface (Brainstorm / Deep Research /
 * Refine / Library / Artifacts), the resulting thread is tagged with that
 * surface. The Surface Panel then shows "Recent in <surface>" — letting
 * the user revisit work by context. Freeform threads (typed directly in
 * the composer) carry no tag and live in the Work surface.
 *
 * Stored in localStorage. Cheap, reversible, and zero backend impact.
 */
import type { StrategySurfaceKey } from '@/components/strategy/v2/StrategyNavSidebar';

const STORAGE_KEY = 'sv-thread-tags-v1';

type Tags = Record<string, StrategySurfaceKey>;

function safeRead(): Tags {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Tags) : {};
  } catch {
    return {};
  }
}

function safeWrite(tags: Tags) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
  } catch {
    /* ignore */
  }
}

export function tagThread(threadId: string, surface: StrategySurfaceKey) {
  const tags = safeRead();
  tags[threadId] = surface;
  safeWrite(tags);
}

export function untagThread(threadId: string) {
  const tags = safeRead();
  delete tags[threadId];
  safeWrite(tags);
}

export function getThreadTag(threadId: string): StrategySurfaceKey | null {
  return safeRead()[threadId] ?? null;
}

export function getAllThreadTags(): Tags {
  return safeRead();
}

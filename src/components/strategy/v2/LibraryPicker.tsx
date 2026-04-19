/**
 * LibraryPicker — `/library [query]` slash surface.
 *
 * Anchored above the composer, same visual language as SlashMenu (sv-e1
 * elevation, hairline border, paper bg, keyboard-first). Opens when the
 * composer's slash query starts with `/library`. Lists the user's resources
 * grouped by category, with real-time filtering from the rest of the query.
 *
 * Selection inserts a short, paste-able reference token into the composer
 * (Option A from the brief — fastest path to "what do I already have I can
 * use?"). The token is plain text the assistant already understands via
 * citation rules: e.g. `RESOURCE[<id>] "<title>"`.
 *
 * Hard constraints honored:
 *   - no new page, no modal, no backdrop
 *   - keyboard navigable (↑/↓, Enter, Esc)
 *   - composer remains focused
 *   - pulls top 10–15 items by recency, capped client-side
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface LibraryItem {
  id: string;
  title: string;
  category: string;
  resourceType: string | null;
  description?: string | null;
  updatedAt?: string | null;
}

/** Escape a value for use inside a PostgREST `or=` filter argument. */
function escapeOrValue(v: string): string {
  // PostgREST `or` filter values use `,` and `)` as separators — strip them.
  return v.replace(/[(),*]/g, ' ').trim();
}

const CATEGORY_LABELS: Record<string, string> = {
  account_plan: 'Account Plans',
  account_plans: 'Account Plans',
  discovery: 'Discovery',
  messaging: 'Messaging',
  email: 'Messaging',
  template: 'Templates',
  business_case: 'Business Cases',
  framework: 'Frameworks',
  call_notes: 'Call Notes',
  transcript: 'Call Transcripts',
  video: 'Videos',
  document: 'Documents',
  presentation: 'Presentations',
  training: 'Training',
};

function labelFor(rawCategory: string): string {
  const key = rawCategory.toLowerCase();
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  // Title-case fallback ("call_notes" -> "Call Notes")
  return rawCategory
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || 'Other';
}

interface Props {
  /** Full slash query including leading `/library`, or null when closed. */
  query: string | null;
  /** Composer bounding rect — picker anchors above its top edge. */
  anchorRect: DOMRect | null;
  /**
   * Called when the user picks a resource. Should insert a reference
   * token into the composer and clear the slash query.
   */
  onPick: (item: LibraryItem) => void;
  onClose: () => void;
}

const MAX_ITEMS = 25;
/** Debounce window for server-side search keystrokes. */
const SEARCH_DEBOUNCE_MS = 180;

export function LibraryPicker({ query, anchorRect, onPick, onClose }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const isOpen = query !== null && /^\/library\b/i.test(query);

  // Extract the search needle (everything after `/library `).
  const needle = useMemo(() => {
    if (!query) return '';
    return query.replace(/^\/library\s*/i, '').trim().toLowerCase();
  }, [query]);

  // ── Server-side full-corpus search ──
  // The library can be 700+ items; client-side filtering over a recent slice
  // is structurally wrong. We query the entire user library on every keystroke
  // (debounced) using ILIKE across title/description/category/type/tags, then
  // rank by relevance. Empty query → honest browse: most recent 25.
  useEffect(() => {
    if (!isOpen || !user) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        let q = supabase
          .from('resources')
          .select('id, title, template_category, resource_type, description, updated_at')
          .eq('user_id', user.id);

        if (needle) {
          // Server-side OR across the searchable fields.
          // Postgrest pattern: `or=(title.ilike.*x*,description.ilike.*x*,...)`.
          const safe = escapeOrValue(needle);
          if (safe) {
            const pat = `*${safe}*`;
            q = q.or(
              [
                `title.ilike.${pat}`,
                `description.ilike.${pat}`,
                `template_category.ilike.${pat}`,
                `resource_type.ilike.${pat}`,
              ].join(','),
            );
          }
          // Fetch enough to rank well — DB does the heavy lifting.
          q = q.order('updated_at', { ascending: false }).limit(120);
        } else {
          // Empty query → honest browse: recent 25, no false coverage claim.
          q = q.order('updated_at', { ascending: false }).limit(MAX_ITEMS);
        }

        const { data, error } = await q;
        if (cancelled) return;
        if (error || !data) {
          setItems([]);
        } else {
          setItems(
            (data as any[]).map((r) => ({
              id: r.id,
              title: r.title || 'Untitled',
              category: r.template_category || r.resource_type || 'other',
              resourceType: r.resource_type ?? null,
              description: r.description ?? null,
              updatedAt: r.updated_at ?? null,
            })),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, needle ? SEARCH_DEBOUNCE_MS : 0);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [isOpen, user, needle]);

  // Relevance ranking — recency is a tie-breaker only.
  // Order:
  //   0 exact title (case-insensitive)
  //   1 title starts with needle
  //   2 title contains needle as whole word
  //   3 title contains needle (substring)
  //   4 category contains needle
  //   5 resource_type contains needle
  //   6 description contains needle
  //   7 anything else (browse mode)
  const ranked = useMemo(() => {
    if (!needle) return items;
    const n = needle;
    const wordRe = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const scored = items.map((it) => {
      const title = (it.title || '').toLowerCase();
      const cat = (it.category || '').toLowerCase();
      const type = (it.resourceType || '').toLowerCase();
      const desc = (it.description || '').toLowerCase();
      let rank = 7;
      if (title === n) rank = 0;
      else if (title.startsWith(n)) rank = 1;
      else if (wordRe.test(it.title || '')) rank = 2;
      else if (title.includes(n)) rank = 3;
      else if (cat.includes(n)) rank = 4;
      else if (type.includes(n)) rank = 5;
      else if (desc.includes(n)) rank = 6;
      return { it, rank, ts: it.updatedAt ? Date.parse(it.updatedAt) : 0 };
    });
    scored.sort((a, b) => a.rank - b.rank || b.ts - a.ts);
    return scored.map((s) => s.it);
  }, [items, needle]);

  // Group + cap. We rank first, THEN cap, so relevance survives the cut.
  const grouped = useMemo(() => {
    const capped = ranked.slice(0, MAX_ITEMS);
    const buckets = new Map<string, LibraryItem[]>();
    for (const it of capped) {
      const lbl = labelFor(it.category);
      if (!buckets.has(lbl)) buckets.set(lbl, []);
      buckets.get(lbl)!.push(it);
    }
    return Array.from(buckets.entries()).map(([label, rows]) => ({ label, rows }));
  }, [ranked]);

  // Flatten for keyboard navigation.
  const flat = useMemo(() => grouped.flatMap((g) => g.rows), [grouped]);

  useEffect(() => { setActiveIdx(0); }, [needle, items.length]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Helper — fully consume the key so it never reaches the composer's
      // textarea handler (which would otherwise treat Enter as "send").
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
        // Critical: stop OTHER capture-phase listeners on this same event
        // (e.g. the composer's onKeyDown) from firing. Without this, Enter
        // both inserts the picker reference AND submits the message.
        e.stopImmediatePropagation();
      };
      if (e.key === 'Escape') {
        consume();
        onClose();
        return;
      }
      if (flat.length === 0) {
        // Even with no results, swallow Enter so it doesn't submit a stray
        // `/library …` message while the picker is open.
        if (e.key === 'Enter') consume();
        return;
      }
      if (e.key === 'ArrowDown') {
        consume();
        setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        consume();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        consume();
        const it = flat[activeIdx];
        if (it) onPick(it);
      }
    };
    // Capture phase so we beat the composer's Enter handler.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, flat, activeIdx, onPick, onClose]);

  if (!isOpen || !anchorRect) return null;

  const top = anchorRect.top - 8;
  const left = anchorRect.left + 24;
  const width = 360;

  // Compute the global index of each row so hover highlight matches keyboard.
  let globalIdx = -1;

  return createPortal(
    <div
      className="strategy-v2"
      style={{ position: 'fixed', inset: 0, zIndex: 78, pointerEvents: 'none' }}
    >
      <div
        ref={ref}
        role="listbox"
        aria-label="Library resources"
        className="sv-e1 sv-enter-fade"
        style={{
          position: 'absolute',
          top,
          left,
          transform: 'translateY(-100%)',
          width,
          maxHeight: 380,
          background: 'hsl(var(--sv-paper))',
          border: '1px solid hsl(var(--sv-hairline))',
          borderRadius: 'var(--sv-radius-surface)',
          overflow: 'hidden',
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          className="px-4 pt-2.5 pb-1 text-[11px] flex items-center justify-between"
          style={{ color: 'hsl(var(--sv-muted))' }}
        >
          <span>
            {needle
              ? `Library · "${needle}"`
              : 'Library · recent — type to search all 700+'}
          </span>
          {loading && <span>loading…</span>}
        </div>

        <div style={{ overflowY: 'auto' }}>
          {!loading && flat.length === 0 && (
            <div
              className="px-4 py-3 text-[13px]"
              style={{ color: 'hsl(var(--sv-muted))' }}
            >
              {needle
                ? `No resources match "${needle}".`
                : 'No resources in your library yet.'}
            </div>
          )}

          {grouped.map((group) => (
            <div key={group.label}>
              <div
                className="px-4 pt-2 pb-0.5 text-[10px] uppercase tracking-wide"
                style={{ color: 'hsl(var(--sv-muted))', letterSpacing: '0.06em' }}
              >
                {group.label}
              </div>
              {group.rows.map((it) => {
                globalIdx += 1;
                const myIdx = globalIdx;
                const active = myIdx === activeIdx;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onMouseEnter={() => setActiveIdx(myIdx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPick(it);
                    }}
                    className="w-full text-left px-4 py-1.5 flex items-center justify-between gap-3"
                    style={{
                      background: active ? 'hsl(var(--sv-hover))' : 'transparent',
                      border: 0,
                      cursor: 'default',
                    }}
                  >
                    <span
                      className="text-[13px] truncate"
                      style={{
                        color: 'hsl(var(--sv-ink))',
                        fontFamily: 'var(--sv-sans)',
                      }}
                    >
                      {it.title}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div
          className="px-4 py-1.5 text-[11px]"
          style={{
            color: 'hsl(var(--sv-muted))',
            borderTop: '1px solid hsl(var(--sv-hairline))',
          }}
        >
          ↑↓ navigate · ↵ insert reference · esc close
        </div>
      </div>
    </div>,
    document.body,
  );
}

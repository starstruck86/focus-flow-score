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

  // Initial fetch — top 50 most-recent resources for this user, then we
  // filter/group/cap client-side. Cheap and avoids per-keystroke round trips.
  useEffect(() => {
    if (!isOpen || !user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('resources')
        .select('id, title, template_category, resource_type')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(80);
      if (cancelled) return;
      if (error || !data) {
        setItems([]);
      } else {
        setItems(
          data.map((r: any) => ({
            id: r.id,
            title: r.title || 'Untitled',
            category: r.template_category || r.resource_type || 'other',
            resourceType: r.resource_type ?? null,
          })),
        );
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // We refetch only when the picker opens — search filtering is local.
  }, [isOpen, user]);

  // Filter + group + cap.
  const grouped = useMemo(() => {
    const filtered = needle
      ? items.filter((i) => i.title.toLowerCase().includes(needle))
      : items;
    const capped = filtered.slice(0, MAX_ITEMS);
    const buckets = new Map<string, LibraryItem[]>();
    for (const it of capped) {
      const lbl = labelFor(it.category);
      if (!buckets.has(lbl)) buckets.set(lbl, []);
      buckets.get(lbl)!.push(it);
    }
    // Stable order: insertion order from the query (recency-driven).
    return Array.from(buckets.entries()).map(([label, rows]) => ({ label, rows }));
  }, [items, needle]);

  // Flatten for keyboard navigation.
  const flat = useMemo(() => grouped.flatMap((g) => g.rows), [grouped]);

  useEffect(() => { setActiveIdx(0); }, [needle, items.length]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (flat.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
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
          <span>Library{needle ? ` · "${needle}"` : ''}</span>
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

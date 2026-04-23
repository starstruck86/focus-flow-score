/**
 * ArtifactSectionNav — sticky in-document table of contents.
 *
 *   ┌──────────────────────┐
 *   │ ON THIS PAGE         │
 *   │ • Cockpit            │
 *   │ ▸ Cover              │
 *   │ • Participants       │
 *   │ • Value selling      │
 *   │   …                  │
 *   └──────────────────────┘
 *
 * Pure presentational. Reads section list from the artifact result and
 * scrolls the artifact viewport (passed via `scrollContainerRef`) into
 * view by section anchor id (`data-section-anchor="<id>"`).
 *
 * Active section is tracked via IntersectionObserver — the section closest
 * to the top of the viewport wins. No backend change.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TaskRunResult } from '@/hooks/strategy/useTaskExecution';

interface Props {
  result: TaskRunResult;
  /** The scrollable artifact viewport that contains anchor elements. */
  scrollContainerRef: React.RefObject<HTMLElement>;
}

const SECTION_ICONS: Record<string, string> = {
  cockpit: '🎯', cover: '📋', participants: '👥', cx_audit: '🔍',
  executive_snapshot: '📊', value_selling: '💡', discovery_questions: '❓',
  customer_examples: '🏢', pivot_statements: '🔄', objection_handling: '🛡️',
  marketing_team: '👤', exit_criteria: '✅', revenue_pathway: '📈',
  metrics_intelligence: '📐', loyalty_analysis: '💎', tech_stack: '⚙️',
  competitive_war_game: '⚔️', hypotheses_risks: '🎲', appendix: '📎',
};

export function ArtifactSectionNav({ result, scrollContainerRef }: Props) {
  const sections = result.draft.sections ?? [];
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const items = useMemo(
    () => sections.map((s) => ({ id: s.id, name: s.name, icon: SECTION_ICONS[s.id] ?? '·' })),
    [sections],
  );

  // Track the section closest to the top of the scroll viewport.
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || items.length === 0) return;

    const cleanup = () => observerRef.current?.disconnect();
    cleanup();

    const observed: HTMLElement[] = [];
    items.forEach(({ id }) => {
      const el = root.querySelector<HTMLElement>(`[data-section-anchor="${id}"]`);
      if (el) observed.push(el);
    });
    if (observed.length === 0) return cleanup;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Use the entry with smallest top distance from the viewport top
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) {
          const id = (visible.target as HTMLElement).dataset.sectionAnchor;
          if (id) setActiveId(id);
        }
      },
      {
        root,
        rootMargin: '-8% 0px -70% 0px',
        threshold: [0, 0.25, 0.5, 1],
      },
    );

    observed.forEach((el) => observerRef.current?.observe(el));
    return cleanup;
  }, [items, scrollContainerRef]);

  const handleClick = (id: string) => {
    const root = scrollContainerRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-section-anchor="${id}"]`);
    if (!el) return;
    // ScrollIntoView relative to the scroll root
    const offsetTop = el.offsetTop;
    root.scrollTo({ top: Math.max(0, offsetTop - 12), behavior: 'smooth' });
    setActiveId(id);
  };

  if (items.length === 0) return null;

  return (
    <nav
      className="hidden lg:flex flex-col shrink-0 py-3 px-2 overflow-y-auto"
      style={{
        width: 196,
        borderRight: '1px solid hsl(var(--sv-hairline))',
        background: 'hsl(var(--sv-paper))',
      }}
      aria-label="Artifact sections"
    >
      <div
        className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: 'hsl(var(--sv-muted))' }}
      >
        On this page
      </div>
      <ul className="space-y-px">
        {items.map(({ id, name, icon }) => {
          const isActive = activeId === id;
          return (
            <li key={id}>
              <button
                onClick={() => handleClick(id)}
                className="w-full text-left px-2 py-1.5 rounded-[6px] flex items-center gap-2 transition-colors group"
                style={{
                  background: isActive ? 'hsl(var(--sv-clay) / 0.08)' : 'transparent',
                  color: isActive ? 'hsl(var(--sv-ink))' : 'hsl(var(--sv-muted))',
                  borderLeft: isActive ? '2px solid hsl(var(--sv-clay))' : '2px solid transparent',
                  paddingLeft: 8,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
                title={name}
              >
                <span className="text-[10px] shrink-0 opacity-70">{icon}</span>
                <span
                  className="text-[12px] truncate"
                  style={{ fontWeight: isActive ? 600 : 400 }}
                >
                  {name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

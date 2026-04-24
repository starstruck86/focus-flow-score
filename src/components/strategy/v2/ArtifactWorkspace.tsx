/**
 * ArtifactWorkspace — right-side artifact panel.
 *
 *   ┌── Artifact panel ─────────────────────────────────────┐
 *   │ Title …………………………………………………………………… [×]               │
 *   ├──────────┬────────────────────────────────────────────┤
 *   │  On this │  <TaskOutputViewer …/>                     │
 *   │  page    │                                            │
 *   │  • …     │                                            │
 *   └──────────┴────────────────────────────────────────────┘
 *
 * Wraps the existing TaskOutputViewer (which already does premium
 * structured rendering: cards per section, collapsible, exports,
 * review tab, redlines). We do NOT reimplement that. We:
 *   - add a sticky section navigation rail (lg+ only)
 *   - provide a workspace surface and a close affordance
 *
 * The redline accept/reject hooks are no-ops in this read-only entry
 * point — the canonical edit flow lives elsewhere.
 */
import { useEffect, useRef, useState } from 'react';
import { X, BookmarkPlus, Lock } from 'lucide-react';
import { TaskOutputViewer } from '@/components/strategy/tasks/TaskOutputViewer';
import type { TaskRunResult } from '@/hooks/strategy/useTaskExecution';
import { ArtifactSectionNav } from './ArtifactSectionNav';
import { toast } from 'sonner';

interface Props {
  result: TaskRunResult;
  /** Human label for the originating context (e.g. "Sephora"). */
  contextLabel?: string | null;
  onClose: () => void;
  /** Open the Promote-to-Library form for this artifact. */
  onPromote?: () => void;
}

export function ArtifactWorkspace({ result, contextLabel, onClose, onPromote }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);

  // TaskOutputViewer renders a Radix <ScrollArea>. The actual scrolling
  // element is `[data-radix-scroll-area-viewport]` deep inside it.
  // We resolve it after mount so the section nav can drive scroll-to.
  useEffect(() => {
    const w = wrapperRef.current;
    if (!w) return;
    // Try a few times in case the viewer mounts async
    let raf = 0;
    const findRoot = () => {
      const el = w.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
      if (el) {
        setScrollRoot(el);
      } else {
        raf = requestAnimationFrame(findRoot);
      }
    };
    findRoot();
    return () => cancelAnimationFrame(raf);
  }, [result.run_id]);

  const noopApplyRedline = (_runId: string, _sectionId: string, _proposedText: string) => {
    toast('Open the dedicated workflow to apply edits.');
  };
  const noopRejectRedline = (_redlineId: string) => {
    toast('Open the dedicated workflow to manage edits.');
  };

  return (
    <section
      className="flex flex-col min-h-0 shrink-0 sv-enter-fade-right"
      style={{
        // Wider so the TOC rail (~200px) plus the document column does not
        // clip on 1440px viewports. Cap at 880px so very wide screens stay
        // readable.
        width: 'min(880px, 62vw)',
        borderLeft: '1px solid hsl(var(--sv-hairline))',
        background: 'hsl(var(--sv-paper))',
      }}
      aria-label="Artifact workspace"
    >
      <div
        className="shrink-0 h-10 flex items-center justify-between gap-2 px-3"
        style={{ borderBottom: '1px solid hsl(var(--sv-hairline))' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.08em] shrink-0"
            style={{ color: 'hsl(var(--sv-muted))' }}
          >
            Artifact
          </span>
          {/* Contextual stamp — proves this output is NOT in the Library */}
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] truncate"
            style={{
              background: 'hsl(var(--sv-hover) / 0.7)',
              color: 'hsl(var(--sv-muted))',
              border: '1px solid hsl(var(--sv-hairline))',
            }}
            title="This output is contextual to your thread. Use “Promote to Library” to make it reusable."
          >
            <Lock className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">
              {contextLabel ? `In thread · ${contextLabel}` : 'In thread'}
            </span>
            <span aria-hidden style={{ opacity: 0.5 }}>·</span>
            <span className="shrink-0">not in Library</span>
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onPromote && (
            <button
              onClick={onPromote}
              className="inline-flex items-center gap-1.5 h-7 px-2 rounded-[6px] text-[11.5px] font-medium transition-colors"
              style={{
                color: 'hsl(var(--sv-ink))',
                border: '1px solid hsl(var(--sv-hairline))',
                background: 'transparent',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover))'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              aria-label="Promote to Library"
              title="Save this as reusable knowledge in your Library"
              data-testid="strategy-promote-to-library-workspace"
            >
              <BookmarkPlus className="h-3 w-3" />
              <span>Promote</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="h-6 w-6 rounded-[4px] sv-hover-bg flex items-center justify-center"
            style={{ color: 'hsl(var(--sv-muted))' }}
            aria-label="Close artifact panel"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div ref={wrapperRef} className="flex-1 min-h-0 flex">
        {scrollRoot && (
          <ArtifactSectionNav
            result={result}
            scrollContainerRef={{ current: scrollRoot } as React.RefObject<HTMLElement>}
          />
        )}
        <div className="flex-1 min-w-0 flex">
          <TaskOutputViewer
            result={result}
            onBack={onClose}
            onApplyRedline={noopApplyRedline}
            onRejectRedline={noopRejectRedline}
          />
        </div>
      </div>
    </section>
  );
}

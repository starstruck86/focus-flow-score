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
import { X } from 'lucide-react';
import { TaskOutputViewer } from '@/components/strategy/tasks/TaskOutputViewer';
import type { TaskRunResult } from '@/hooks/strategy/useTaskExecution';
import { ArtifactSectionNav } from './ArtifactSectionNav';
import { toast } from 'sonner';

interface Props {
  result: TaskRunResult;
  onClose: () => void;
}

export function ArtifactWorkspace({ result, onClose }: Props) {
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
        className="shrink-0 h-9 flex items-center justify-between px-3"
        style={{ borderBottom: '1px solid hsl(var(--sv-hairline))' }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'hsl(var(--sv-muted))' }}>
          Artifact
        </span>
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

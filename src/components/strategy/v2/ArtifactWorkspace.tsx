/**
 * ArtifactWorkspace — right-side artifact panel.
 *
 * Wraps the existing TaskOutputViewer (which already does premium
 * structured rendering: cards per section, collapsible, exports,
 * review tab, redlines). We do NOT reimplement that — we just provide
 * the surrounding workspace surface and a close affordance.
 *
 *   ┌── Artifact panel ─────────────────────────────────┐
 *   │ Title …………………………………………………………………… [×]            │
 *   │ <TaskOutputViewer …/>                              │
 *   └────────────────────────────────────────────────────┘
 *
 * The redline accept/reject hooks are no-ops in this read-only entry
 * point — the canonical edit flow lives elsewhere. We pass safe stubs
 * so the existing component contract is satisfied without triggering
 * mutation.
 */
import { X } from 'lucide-react';
import { TaskOutputViewer } from '@/components/strategy/tasks/TaskOutputViewer';
import type { TaskRunResult } from '@/hooks/strategy/useTaskExecution';
import { toast } from 'sonner';

interface Props {
  result: TaskRunResult;
  onClose: () => void;
}

export function ArtifactWorkspace({ result, onClose }: Props) {
  const noopApplyRedline = (_runId: string, _sectionId: string, _proposedText: string) => {
    toast('Open the dedicated workflow to apply edits.');
  };
  const noopRejectRedline = (_redlineId: string) => {
    toast('Open the dedicated workflow to manage edits.');
  };

  return (
    <section
      className="flex flex-col min-h-0 shrink-0"
      style={{
        width: 'min(560px, 50vw)',
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
      <div className="flex-1 min-h-0 flex">
        <TaskOutputViewer
          result={result}
          onBack={onClose}
          onApplyRedline={noopApplyRedline}
          onRejectRedline={noopRejectRedline}
        />
      </div>
    </section>
  );
}

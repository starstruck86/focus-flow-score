/**
 * StrategyTopBar — locked Phase 1 structure.
 *
 *   [Thread Title] [● Entity Chip] ............ [⌘K] [⌘I+count]
 *
 * Phase 3: chip click is hoisted to the shell so it can also be summoned by ⌘L.
 */
import { forwardRef, useEffect, useRef, useState } from 'react';
import type { TrustState } from '@/hooks/strategy/useThreadTrustState';
import { EntityChip } from './EntityChip';
import { useIsMobile } from '@/hooks/use-mobile';

interface Props {
  title: string;
  onTitleChange: (next: string) => void;
  entityName: string | null;
  trustState: TrustState;
  unresolvedProposalCount: number;
  onOpenSwitcher: () => void;
  onOpenInspector: () => void;
  /** Called when chip is clicked. Shell decides what to do (open LinkPicker). */
  onChipClick: () => void;
  /** Ref to the chip button so the shell can anchor LinkPicker to it. */
  chipRef?: React.RefObject<HTMLButtonElement>;
  /** Phase 1.5: create a new thread immediately (no modal). */
  onNewThread: () => void;
}

export const StrategyTopBar = forwardRef<HTMLDivElement, Props>(function StrategyTopBar({
  title, onTitleChange, entityName, trustState,
  unresolvedProposalCount, onOpenSwitcher, onOpenInspector, onChipClick, chipRef,
  onNewThread,
}, _ref) {
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const internalChipRef = useRef<HTMLButtonElement>(null);
  const effectiveChipRef = chipRef ?? internalChipRef;

  useEffect(() => { setDraft(title); }, [title]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== title) onTitleChange(next);
    else setDraft(title);
  };

  const inspectorLabel = unresolvedProposalCount > 0
    ? `⌘I  ${unresolvedProposalCount}`
    : '⌘I';

  return (
    <div
      className="shrink-0 w-full flex flex-col"
      style={{ borderBottom: '1px solid hsl(var(--sv-hairline))' }}
    >
      <div className="h-[44px] w-full flex items-center px-4 gap-3">
        {/* Title — inline editable */}
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setDraft(title); setEditing(false); }
            }}
            className="text-[14px] font-medium tracking-tight bg-transparent border-0 outline-none truncate"
            style={{ color: 'hsl(var(--sv-ink))', minWidth: 0, flex: '0 1 auto' }}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-[14px] font-medium tracking-tight truncate text-left max-w-[40vw]"
            style={{ color: 'hsl(var(--sv-ink))' }}
            title="Click to rename"
          >
            {title || 'Untitled thread'}
          </button>
        )}

        {/* Entity chip — desktop only here */}
        {!isMobile && (
          <EntityChip
            ref={effectiveChipRef}
            entityName={entityName}
            trustState={trustState}
            onClick={onChipClick}
          />
        )}

        <div className="flex-1" />

        {/* Keyboard verbs */}
        <button
          onClick={onOpenSwitcher}
          className="h-7 px-2 rounded-[4px] sv-hover-bg text-[12px] font-mono"
          style={{ color: 'hsl(var(--sv-muted))' }}
          title="Open switcher (⌘K)"
        >
          ⌘K
        </button>
        <button
          onClick={onOpenInspector}
          className="h-7 px-2 rounded-[4px] sv-hover-bg text-[12px] font-mono inline-flex items-center gap-1"
          style={{ color: 'hsl(var(--sv-muted))' }}
          title="Open inspector (⌘I)"
        >
          {inspectorLabel}
        </button>
      </div>

      {/* Mobile entity chip — sits beneath title row */}
      {isMobile && (
        <div className="px-4 pb-1">
          <EntityChip
            ref={effectiveChipRef}
            entityName={entityName}
            trustState={trustState}
            onClick={onChipClick}
          />
        </div>
      )}
    </div>
  );
});

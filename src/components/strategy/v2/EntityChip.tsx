/**
 * EntityChip — shows the linked entity (Account or Opportunity) next to the
 * thread title in the top bar, with a 6px TrustDot prefix.
 *
 * Click → opens LinkPicker (re-link / unlink). The chip IS the relink
 * affordance; there is no separate icon button.
 *
 * Format: `● Lima One Capital`
 *
 * Locked rules:
 *   - one chip on the default screen, this one
 *   - max-w-[180px] truncate
 *   - hairline border, no fill, hover background only
 *   - dot color = trust state, never compete with title
 */
import { useRef, useState } from 'react';
import type { TrustState } from '@/hooks/strategy/useThreadTrustState';
import { TrustDot } from './TrustDot';
import { LinkPicker, type LinkPickerSelection } from './LinkPicker';

interface Props {
  entityName: string | null;          // "Lima One Capital" or null when freeform
  entityKind: 'account' | 'opportunity' | null;
  trustState: TrustState;
  onPick: (selection: LinkPickerSelection) => void;
}

export function EntityChip({ entityName, entityKind, trustState, onPick }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const label = entityName ?? 'Freeform';
  const isLinked = !!entityName;

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen(true)}
        className="
          h-6 px-2 inline-flex items-center gap-1.5
          rounded-[4px] border sv-hairline sv-hover-bg
          text-[12px] leading-none font-normal
          max-w-[180px] truncate
        "
        style={{
          color: isLinked ? 'hsl(var(--sv-ink))' : 'hsl(var(--sv-muted))',
        }}
        title={isLinked ? `Linked to ${label} — click to change` : 'Freeform thread — click to link'}
      >
        <TrustDot state={trustState} title={`Trust: ${trustState}`} />
        <span className="truncate">{label}</span>
      </button>

      <LinkPicker
        open={open}
        anchorRef={ref}
        currentEntityKind={entityKind}
        onClose={() => setOpen(false)}
        onPick={(sel) => {
          setOpen(false);
          onPick(sel);
        }}
      />
    </>
  );
}

/**
 * BlockedComposer — replaces the StrategyComposer when trust_state === 'blocked'.
 *
 * Locked rules:
 *   - lives in the composer slot; no banner anywhere on the canvas
 *   - inline message: "This thread reads like X, not Y."
 *   - primary clay button: "Clone for <correctEntity>" (or generic if unknown)
 *   - text link: "Unlink thread"
 *   - "Why?" disclosure → 120ms height transition, shows reason + the entities
 *     the system detected. No conflict counts, no chips.
 */
import { useState, useRef, useEffect } from 'react';
import type { ThreadConflict } from '@/hooks/strategy/useThreadTrustState';

interface Props {
  reason: string | null;
  conflicts: ThreadConflict[];
  /** Name of the entity the thread is currently linked to (mismatched). */
  linkedEntityName: string | null;
  /** Name detected in the conversation that the system thinks is the real subject. */
  detectedEntityName: string | null;
  onClone: () => void;
  onUnlink: () => void;
}

export function BlockedComposer({
  reason, conflicts, linkedEntityName, detectedEntityName, onClone, onUnlink,
}: Props) {
  const [whyOpen, setWhyOpen] = useState(false);
  const whyRef = useRef<HTMLDivElement>(null);
  const [whyHeight, setWhyHeight] = useState(0);

  useEffect(() => {
    if (whyRef.current) setWhyHeight(whyRef.current.scrollHeight);
  }, [whyOpen, conflicts.length, reason]);

  const message = detectedEntityName && linkedEntityName
    ? `This thread reads like ${detectedEntityName}, not ${linkedEntityName}.`
    : detectedEntityName
      ? `This thread reads like ${detectedEntityName}.`
      : (reason ?? 'This thread is mis-linked.');

  const cloneLabel = detectedEntityName ? `Clone for ${detectedEntityName}` : 'Clone to correct entity';

  // Surface up to a few entity signals as plain text (no chips, no counts).
  const evidence = conflicts
    .map(c => c.detected_account_name)
    .filter((n): n is string => !!n)
    .slice(0, 3);

  return (
    <div
      className="w-full px-6 pb-8 pt-2"
      style={{ background: 'hsl(var(--sv-paper))' }}
    >
      <div
        className="mx-auto"
        style={{
          maxWidth: 860,
          borderRadius: 'var(--sv-radius-composer)',
          border: '1px solid hsl(var(--sv-hairline))',
          background: 'hsl(var(--sv-paper))',
          padding: '14px 16px',
        }}
      >
        <p
          className="text-[14px]"
          style={{ color: 'hsl(var(--sv-ink))', lineHeight: 1.5, margin: 0 }}
        >
          {message}
        </p>

        <div className="mt-3 flex items-center gap-4">
          <button
            type="button"
            onClick={onClone}
            className="text-[13px] font-medium px-3 h-8 rounded-[6px]"
            style={{
              background: 'hsl(var(--sv-clay))',
              color: 'hsl(var(--sv-paper))',
            }}
          >
            {cloneLabel}
          </button>
          <button
            type="button"
            onClick={onUnlink}
            className="text-[13px]"
            style={{ color: 'hsl(var(--sv-muted))' }}
          >
            Unlink thread
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => setWhyOpen(o => !o)}
            className="text-[12px]"
            style={{ color: 'hsl(var(--sv-muted))' }}
            aria-expanded={whyOpen}
          >
            {whyOpen ? 'Hide' : 'Why?'}
          </button>
        </div>

        {/* Disclosure — height transition only, ≤120ms */}
        <div
          style={{
            overflow: 'hidden',
            height: whyOpen ? whyHeight : 0,
            transition: 'height 120ms ease',
          }}
        >
          <div ref={whyRef} className="pt-3">
            {reason && (
              <p
                className="text-[12px]"
                style={{ color: 'hsl(var(--sv-muted))', lineHeight: 1.55, margin: 0 }}
              >
                {reason}
              </p>
            )}
            {evidence.length > 0 && (
              <p
                className="text-[12px] mt-2"
                style={{ color: 'hsl(var(--sv-muted))', lineHeight: 1.55, margin: '8px 0 0 0' }}
              >
                Mentions detected: {evidence.join(' · ')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * StrategyProgressPanel — sticky in-flight task progress strip.
 *
 * Renders ONLY when there's an active (non-terminal) task_run on the
 * current thread. Pulls progress data from the read-only useThreadTaskRuns
 * hook — does NOT trigger or alter the pipeline.
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ ⏳  Authoring prep document        ●●●●●●●●●○○○○○○○ 8/16│
 *   │     Section 8 of 16 · Claude · fallback 12%             │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Phases displayed (from progress_step):
 *   queued · library_retrieval · research · synthesis ·
 *   document_authoring:batch_N_of_M · review · completed
 */
import { Loader2 } from 'lucide-react';
import type { ThreadTaskRunRow } from '@/hooks/strategy/useThreadTaskRuns';

interface Props {
  active: ThreadTaskRunRow | null;
}

const PHASE_LABEL: Record<string, string> = {
  queued: 'Queued',
  library_retrieval: 'Pulling library context',
  research: 'Researching company & market',
  synthesis: 'Synthesizing strategy',
  document_authoring: 'Authoring sections',
  assembly: 'Assembling artifact',
  review: 'Reviewing output',
};

function parseBatch(progressStep: string | null): { current: number; total: number } | null {
  if (!progressStep) return null;
  const m = progressStep.match(/batch_(\d+)_of_(\d+)/);
  if (!m) return null;
  return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

function phaseLabel(progressStep: string | null): string {
  if (!progressStep) return 'Working…';
  const root = progressStep.split(':')[0];
  return PHASE_LABEL[root] ?? root.replace(/_/g, ' ');
}

export function StrategyProgressPanel({ active }: Props) {
  if (!active) return null;

  const batch = parseBatch(active.progress_step);
  const label = phaseLabel(active.progress_step);
  const meta = (active.meta ?? {}) as Record<string, any>;
  const authoring = (meta.authoring_progressive ?? {}) as Record<string, any>;
  const fallbackPct = typeof authoring.fallback_pct === 'number' ? authoring.fallback_pct : null;
  const driftWarning = authoring.drift_warning === true;

  const pct = batch ? Math.round((batch.current / Math.max(batch.total, 1)) * 100) : null;

  return (
    <div
      className="mx-auto sv-enter-fade"
      style={{ maxWidth: 860, width: '100%', padding: '8px 24px 0' }}
    >
      <div
        className="rounded-[8px] px-3.5 py-2.5"
        style={{
          border: '1px solid hsl(var(--sv-hairline))',
          background: 'hsl(var(--sv-paper))',
          boxShadow: 'var(--sv-shadow-e1)',
        }}
      >
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" style={{ color: 'hsl(var(--sv-clay))' }} />
          <span className="text-[13px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
            {label}
          </span>
          {batch && (
            <span
              className="text-[11px] tabular-nums px-1.5 py-0.5 rounded-[3px]"
              style={{
                color: 'hsl(var(--sv-muted))',
                background: 'hsl(var(--sv-hover))',
              }}
            >
              {batch.current} / {batch.total}
            </span>
          )}
          <span className="flex-1" />
          {fallbackPct !== null && fallbackPct > 0 && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded-[3px]"
              style={{
                color: driftWarning ? 'hsl(var(--sv-amber))' : 'hsl(var(--sv-muted))',
                background: driftWarning ? 'hsl(var(--sv-amber) / 0.1)' : 'hsl(var(--sv-hover) / 0.6)',
              }}
              title={driftWarning ? 'Fallback usage above 30%' : 'Fallback authoring rate'}
            >
              {Math.round(fallbackPct * 100)}% fallback
            </span>
          )}
        </div>
        {pct !== null ? (
          <div
            className="mt-2 h-[3px] rounded-full overflow-hidden"
            style={{ background: 'hsl(var(--sv-hairline))' }}
          >
            <div
              className="h-full transition-all duration-700 ease-out"
              style={{
                width: `${pct}%`,
                background: 'hsl(var(--sv-clay))',
              }}
            />
          </div>
        ) : (
          <div
            className="mt-2 h-[3px] rounded-full overflow-hidden"
            style={{ background: 'hsl(var(--sv-hairline))' }}
          >
            <div className="h-full sv-bar-shimmer" style={{ width: '40%' }} />
          </div>
        )}
      </div>
    </div>
  );
}

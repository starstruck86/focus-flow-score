/**
 * CalibrationChip — surfaces the W6.5 (Pass B) library-calibration verdict
 * that strategy-chat already persists into content_json.calibration.
 *
 * IMPORTANT: This is the Phase-1 HEURISTIC calibration — it scores STRUCTURE
 * and SHAPE against library exemplars, not substantive correctness. The chip
 * is labeled "heuristic" on purpose. A future LLM-judge pass (Phase 2B) will
 * replace the engine behind the same content_json.calibration field, and this
 * chip will render it unchanged.
 *
 * Renders nothing unless a real calibration with injected standards exists.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

type Verdict = 'on_standard' | 'near_standard' | 'below_standard' | 'insufficient_exemplars';

interface CalibrationDimension {
  id: string;
  label: string;
  score: number;
  weight: number;
  rationale?: string;
}
interface CalibrationFinding { text: string; }
interface CalibrationUpgrade { change: string; rationale?: string; }

interface CalibrationBlock {
  standardContextInjected?: boolean;
  weightedScore?: number;
  overallVerdict?: Verdict;
  overallConfidence?: 'low' | 'medium' | 'high';
  reason?: string;
  dimensions?: CalibrationDimension[];
  strengths?: CalibrationFinding[];
  gaps?: CalibrationFinding[];
  upgradeSuggestions?: CalibrationUpgrade[];
}

const VERDICT_META: Record<Verdict, { label: string; color: string }> = {
  on_standard:           { label: 'On standard',    color: 'hsl(152 45% 40%)' },
  near_standard:         { label: 'Near standard',  color: 'hsl(38 70% 45%)'  },
  below_standard:        { label: 'Below standard', color: 'hsl(8 60% 50%)'   },
  insufficient_exemplars:{ label: 'Not graded',     color: 'hsl(var(--sv-muted))' },
};

export function CalibrationChip({ calibration }: { calibration: unknown }) {
  const [open, setOpen] = useState(false);
  const c = (calibration ?? null) as CalibrationBlock | null;

  if (!c || c.standardContextInjected !== true) return null;
  const verdict = c.overallVerdict;
  if (!verdict || verdict === 'insufficient_exemplars') return null;
  if (!Array.isArray(c.dimensions) || c.dimensions.length === 0) return null;

  const meta = VERDICT_META[verdict];
  const score = typeof c.weightedScore === 'number' ? c.weightedScore.toFixed(1) : null;
  const gaps = (c.gaps ?? []).filter(g => g?.text);
  const upgrades = (c.upgradeSuggestions ?? []).filter(u => u?.change);
  const hasDetail = gaps.length > 0 || upgrades.length > 0 || c.dimensions.length > 0;

  return (
    <div className="mt-2 mb-1" style={{ fontFamily: 'var(--sv-sans)' }}>
      <button
        type="button"
        onClick={() => hasDetail && setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] transition-opacity"
        style={{
          border: `1px solid ${meta.color}`,
          color: meta.color,
          background: 'transparent',
          cursor: hasDetail ? 'pointer' : 'default',
          opacity: 0.85,
        }}
        title="Heuristic calibration against your library exemplars — structure/shape, not a substance judgment."
        aria-expanded={open}
      >
        {hasDetail ? (open ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : null}
        <span>Library calibration: {meta.label}{score ? ` · ${score}/5` : ''}</span>
        <span style={{ opacity: 0.6 }}>· heuristic</span>
      </button>

      {open && hasDetail && (
        <div
          className="mt-1.5 rounded-md p-2 text-[12px] leading-snug"
          style={{
            border: '1px solid hsl(var(--sv-hairline))',
            background: 'hsl(var(--sv-hover) / 0.4)',
            color: 'hsl(var(--sv-ink))',
            maxWidth: 520,
          }}
        >
          <div style={{ color: 'hsl(var(--sv-muted))', marginBottom: 6 }}>
            Heuristic check vs. your library exemplars (structure &amp; shape, not correctness).
            {c.reason ? ` ${c.reason}` : ''}
          </div>

          {c.dimensions.length > 0 && (
            <div style={{ marginBottom: gaps.length || upgrades.length ? 8 : 0 }}>
              {c.dimensions.map((d, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2" style={{ margin: '2px 0' }}>
                  <span>{d.label}</span>
                  <span style={{ color: 'hsl(var(--sv-muted))', whiteSpace: 'nowrap' }}>{d.score}/5</span>
                </div>
              ))}
            </div>
          )}

          {gaps.length > 0 && (
            <div style={{ marginBottom: upgrades.length ? 8 : 0 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Gaps</div>
              {gaps.slice(0, 4).map((g, i) => (
                <div key={i} style={{ margin: '1px 0' }}>• {g.text}</div>
              ))}
            </div>
          )}

          {upgrades.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Upgrades</div>
              {upgrades.slice(0, 4).map((u, i) => (
                <div key={i} style={{ margin: '1px 0' }}>→ {u.change}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

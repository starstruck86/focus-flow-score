/**
 * EvidenceSummaryCard — three scannable blocks: Steps · Verification SQL · Risk Signals.
 */
import { useState } from 'react';
import { CheckCircle2, XCircle, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STEP_LABELS } from '@/lib/strategy/canary/types';
import type { Decision, EvidenceSummary } from '@/lib/strategy/canary/types';

interface Props {
  evidence: EvidenceSummary;
}

const RECOMMENDATION_LABEL: Record<Decision, string> = {
  continue: 'Continue canary',
  fix: 'Fix before continuing',
  rollback: 'Roll back',
};

export function EvidenceSummaryCard({ evidence }: Props) {
  const stepsByNum = new Map(evidence.steps.map(s => [s.n, s]));

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-4">
      {/* Recommendation banner */}
      <div
        className={cn(
          'rounded-md border px-3 py-2 text-sm font-medium',
          evidence.recommendation === 'continue' && 'border-success/40 bg-success/10 text-success-foreground',
          evidence.recommendation === 'fix' && 'border-warning/40 bg-warning/10 text-warning-foreground',
          evidence.recommendation === 'rollback' && 'border-destructive/40 bg-destructive/10 text-destructive',
        )}
      >
        Recommended: {RECOMMENDATION_LABEL[evidence.recommendation]}
      </div>

      {/* Block 1 — Steps */}
      <Section title="Steps">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
            const s = stepsByNum.get(n);
            return (
              <div
                key={n}
                className={cn(
                  'flex items-start gap-2 rounded-md border p-2 text-xs',
                  !s && 'border-border bg-muted/30 text-muted-foreground',
                  s?.status === 'pass' && 'border-success/40 bg-success/10',
                  s?.status === 'fail' && 'border-destructive/40 bg-destructive/10',
                )}
              >
                <StepIcon status={s?.status} />
                <div className="min-w-0">
                  <div className="font-medium">
                    {n}. {STEP_LABELS[n]}
                  </div>
                  {s?.note && <div className="mt-0.5 text-muted-foreground">{s.note}</div>}
                  {!s && <div className="mt-0.5 italic">Not run</div>}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Block 2 — Verification SQL */}
      <Section title="Verification SQL">
        <div className="flex flex-col gap-2 text-xs">
          <SqlRow label="Duplicates" status={evidence.duplicates_status} raw={evidence.duplicates_raw} />
          <SqlRow label="Failures" status={evidence.failures_status} raw={evidence.failures_raw} />
          <LaneMixRow evidence={evidence} />
        </div>
      </Section>

      {/* Block 3 — Risk Signals & Context */}
      <Section title="Risk Signals & Context">
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap gap-1.5">
            <FlagBadge value={evidence.flag_state.auto_promote} />
            {evidence.risk_signals.map((r) => (
              <span
                key={r.key}
                className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-destructive"
              >
                {r.label}
              </span>
            ))}
            {evidence.risk_signals.length === 0 && (
              <span className="text-muted-foreground">No risk signals triggered.</span>
            )}
          </div>
          <ObservationsBlock text={evidence.observations} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function StepIcon({ status }: { status?: 'pass' | 'fail' }) {
  if (status === 'pass') return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === 'fail') return <XCircle className="h-4 w-4 text-destructive" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

function SqlRow({
  label,
  status,
  raw,
}: {
  label: string;
  status: 'empty' | 'non_empty' | 'missing';
  raw: string | null;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border p-2">
      <div className="w-24 shrink-0 font-medium">{label}</div>
      <div className="flex-1">
        {status === 'empty' && <span className="text-success">✅ Empty</span>}
        {status === 'missing' && <span className="text-muted-foreground">⚪ Not provided</span>}
        {status === 'non_empty' && (
          <div>
            <div className="text-destructive">❌ Non-empty</div>
            {raw && (
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
                {raw}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LaneMixRow({ evidence }: { evidence: EvidenceSummary }) {
  const mix = evidence.lane_mix;
  if (!mix) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border p-2">
        <div className="w-24 shrink-0 font-medium">Lane mix</div>
        <span className="text-muted-foreground">⚪ Not provided</span>
      </div>
    );
  }
  const total = mix.direct + mix.assisted + mix.deep_work || 1;
  const seg = (n: number) => `${(n / total) * 100}%`;
  const bandClass =
    evidence.lane_band === 'healthy' ? 'text-success'
    : evidence.lane_band === 'warn' ? 'text-warning-foreground'
    : evidence.lane_band === 'off_band' ? 'text-destructive'
    : 'text-muted-foreground';
  const bandLabel =
    evidence.lane_band === 'healthy' ? 'Healthy'
    : evidence.lane_band === 'warn' ? 'Warn'
    : evidence.lane_band === 'off_band' ? 'Off-band'
    : 'Unknown';

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border p-2">
      <div className="flex items-center justify-between">
        <div className="font-medium">Lane mix</div>
        <div className={cn('text-[11px] font-medium', bandClass)}>
          {bandLabel}{evidence.deep_work_pct !== null && ` · deep_work ${evidence.deep_work_pct.toFixed(1)}%`}
        </div>
      </div>
      <div className="flex h-2 overflow-hidden rounded bg-muted">
        <div className="bg-primary" style={{ width: seg(mix.direct) }} title={`direct=${mix.direct}`} />
        <div className="bg-secondary-foreground/60" style={{ width: seg(mix.assisted) }} title={`assisted=${mix.assisted}`} />
        <div className="bg-warning" style={{ width: seg(mix.deep_work) }} title={`deep_work=${mix.deep_work}`} />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>direct={mix.direct}</span>
        <span>assisted={mix.assisted}</span>
        <span>deep_work={mix.deep_work}</span>
      </div>
    </div>
  );
}

function FlagBadge({ value }: { value: 0 | 1 | null }) {
  const label =
    value === null
      ? 'AUTO_PROMOTE = ?'
      : `AUTO_PROMOTE = ${value}`;
  const cls =
    value === 1
      ? 'border-warning/40 bg-warning/10 text-warning-foreground'
      : value === 0
      ? 'border-border bg-muted text-muted-foreground'
      : 'border-border bg-muted text-muted-foreground';
  return (
    <span className={cn('rounded-full border px-2 py-0.5 font-mono', cls)}>{label}</span>
  );
}

function ObservationsBlock({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return <div className="text-muted-foreground">No observations provided.</div>;
  const lineCount = text.split('\n').length;
  const collapsible = lineCount > 3;
  const visible = !collapsible || open ? text : text.split('\n').slice(0, 3).join('\n') + '…';
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2">
      <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground">{visible}</pre>
      {collapsible && (
        <button
          onClick={() => setOpen(o => !o)}
          className="mt-1 text-[11px] font-medium text-primary hover:underline"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

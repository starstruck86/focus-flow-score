/**
 * AccountRoom — the strategic command-center block for an account.
 * Reads only from truth-model tables (branch_pov, account_risks,
 * account_signals, account_dossiers). The single mutation exposed is
 * the ratify affordance on branch_pov (existing schema field).
 *
 * Rendered inside the expandable Territory row and on /accounts/:id.
 * Visual language mirrors the Digest tab's signal card renderer so a
 * signal card looks the same wherever it appears.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  Zap,
  Target,
  AlertTriangle,
  Radio,
  BookOpen,
  Network,
  CheckCircle2,
  Circle,
  ExternalLink,
  Download,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useAccountRoom, type PovRow, type RiskRow, type SignalRow } from '@/hooks/useAccountRoom';
import { GapScorePill } from './GapScorePill';

interface AccountRoomProps {
  accountId: string;
  compact?: boolean;
}

const POV_TARGET_TONE: Record<string, string> = {
  should_own: 'bg-status-green/15 text-status-green border-status-green/30',
  should_expand: 'bg-primary/15 text-primary border-primary/30',
  own: 'bg-muted text-muted-foreground border-border',
  at_risk: 'bg-status-red/15 text-status-red border-status-red/30',
  not_now: 'bg-muted text-muted-foreground border-border',
};

const SIGNAL_CLASS_TONE: Record<string, string> = {
  window: 'bg-primary/15 text-primary border-primary/30',
  specimen: 'bg-status-yellow/15 text-status-yellow border-status-yellow/30',
  evergreen: 'bg-muted text-muted-foreground border-border',
};

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

function ConvictionDots({ n }: { n: number }) {
  const filled = Math.max(0, Math.min(5, n));
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Conviction ${filled} of 5`}>
      {Array.from({ length: 5 }).map((_, i) =>
        i < filled ? (
          <CheckCircle2 key={i} className="h-2.5 w-2.5 text-primary fill-primary/30" />
        ) : (
          <Circle key={i} className="h-2.5 w-2.5 text-muted-foreground/40" />
        ),
      )}
    </span>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
  accent = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count?: number;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className={cn('h-3.5 w-3.5', accent ? 'text-primary' : 'text-muted-foreground')} />
      <span
        className={cn(
          'text-[11px] font-semibold uppercase tracking-wider',
          accent ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {title}
      </span>
      {count != null && (
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
          {count}
        </Badge>
      )}
    </div>
  );
}

function PovCard({ row, onRatify }: { row: PovRow; onRatify: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const tone = POV_TARGET_TONE[row.target_status] ?? POV_TARGET_TONE.not_now;
  return (
    <div className="p-2.5 rounded-md border border-border/60 bg-background text-xs space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono font-semibold">{row.surface}</span>
        <Badge variant="outline" className={cn('text-[10px]', tone)}>
          {row.target_status.replace(/_/g, ' ')}
        </Badge>
        <ConvictionDots n={row.conviction} />
        {row.ratified ? (
          <Badge className="text-[10px] bg-status-green/15 text-status-green border-status-green/30">
            ratified
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            className="h-5 px-1.5 text-[10px] text-primary hover:text-primary"
            onClick={async () => {
              setBusy(true);
              try {
                await onRatify(row.id);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Ratifying…' : 'Ratify'}
          </Button>
        )}
      </div>
      {row.rationale && <p className="text-muted-foreground leading-relaxed">{row.rationale}</p>}
    </div>
  );
}

function RiskCard({ row }: { row: RiskRow }) {
  const sev = row.severity ?? 0;
  const tone =
    sev >= 4
      ? 'text-status-red border-status-red/40'
      : sev >= 2
      ? 'text-status-yellow border-status-yellow/40'
      : 'text-muted-foreground border-border';
  return (
    <div className="p-2.5 rounded-md border border-border/60 bg-background text-xs space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono font-semibold">{row.risk_type}</span>
        {row.surface && (
          <Badge variant="outline" className="text-[10px]">
            {row.surface}
          </Badge>
        )}
        <Badge variant="outline" className={cn('text-[10px]', tone)}>
          sev {sev || '—'} · lk {row.likelihood ?? '—'}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          {row.status}
        </Badge>
        {row.competitor && (
          <Badge variant="outline" className="text-[10px] text-status-red border-status-red/30">
            vs {row.competitor}
          </Badge>
        )}
      </div>
      {row.rationale && <p className="text-muted-foreground leading-relaxed">{row.rationale}</p>}
      <p className="text-[10px] text-muted-foreground/70">observed {fmtDate(row.observed_at)}</p>
    </div>
  );
}

/** Digest-tab-style signal card. Kept visually identical to the Digest renderer. */
function SignalCard({ row }: { row: SignalRow }) {
  const tone = row.signal_class ? SIGNAL_CLASS_TONE[row.signal_class] ?? SIGNAL_CLASS_TONE.evergreen : SIGNAL_CLASS_TONE.evergreen;
  const when = fmtDate(row.observed_at ?? row.created_at);
  return (
    <div className="p-2.5 rounded-md border border-border/60 bg-background text-xs space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold">{row.intelligence_head}</span>
        {row.signal_class && (
          <Badge variant="outline" className={cn('text-[10px]', tone)}>
            {row.signal_class}
          </Badge>
        )}
        <Badge variant="secondary" className="text-[10px]">
          {row.signal_type}
        </Badge>
        <span className="text-[10px] text-muted-foreground ml-auto">{when}</span>
      </div>
      <p className="text-muted-foreground leading-relaxed">
        {row.raw_text.length > 220 ? row.raw_text.slice(0, 220) + '…' : row.raw_text}
      </p>
      {row.source_url && (
        <a
          href={row.source_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
        >
          <ExternalLink className="h-2.5 w-2.5" />
          {row.source_label || row.source_url}
        </a>
      )}
    </div>
  );
}

export function AccountRoom({ accountId, compact = false }: AccountRoomProps) {
  const navigate = useNavigate();
  const {
    loading,
    vertical,
    lastReviewedAt,
    parent,
    children,
    povs,
    risks,
    signals,
    signalsSinceReview,
    dossier,
    gap,
    ratifyPov,
  } = useAccountRoom(accountId);
  const [dossierOpen, setDossierOpen] = useState(false);

  if (loading) {
    return <div className="text-xs text-muted-foreground py-2">Loading account room…</div>;
  }

  const downloadDossier = () => {
    if (!dossier) return;
    const blob = new Blob([dossier.content_md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dossier-v${dossier.version}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cn('space-y-4', compact ? 'text-xs' : 'text-sm')}>
      {/* VITALS strip — Gap Score + vertical + review recency */}
      <div className="flex items-center gap-3 flex-wrap p-3 rounded-lg border border-border/60 bg-muted/20">
        <GapScorePill gap={gap} size="md" />
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Why</span>
          <span className="text-xs text-foreground/90 truncate">{gap.why}</span>
        </div>
        <Separator orientation="vertical" className="h-8" />
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Vertical</span>
          <span className="text-xs">{vertical ?? '—'}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Last reviewed</span>
          <span className="text-xs">{lastReviewedAt ? fmtDate(lastReviewedAt) : 'never'}</span>
        </div>
      </div>

      {/* ⚡ SINCE LAST REVIEW */}
      {lastReviewedAt && signalsSinceReview.length > 0 && (
        <div>
          <SectionHeader icon={Zap} title="Since last review" count={signalsSinceReview.length} accent />
          <div className="space-y-2">
            {signalsSinceReview.slice(0, 8).map((s) => (
              <SignalCard key={s.id} row={s} />
            ))}
          </div>
        </div>
      )}

      {/* WHITESPACE / ENTITY */}
      {(parent || children.length > 0) && (
        <div>
          <SectionHeader icon={Network} title="Whitespace / Entity" count={children.length || undefined} />
          {parent && (
            <button
              onClick={() => navigate(`/accounts/${parent.id}`)}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline mb-2"
            >
              <ChevronRight className="h-3 w-3 rotate-180" />
              Parent: {parent.name}
            </button>
          )}
          {children.length > 0 && (
            <div className="space-y-1.5">
              {children.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/accounts/${c.id}`)}
                  className="w-full flex items-center gap-3 p-2 rounded-md border border-border/60 hover:bg-muted/30 transition-colors text-left"
                >
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium flex-1 truncate">{c.name}</span>
                  <GapScorePill gap={c.gap} />
                  <span className="text-[10px] text-muted-foreground truncate max-w-[220px]">
                    {c.gap.why}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* POV */}
      <div>
        <SectionHeader icon={Target} title="POV" count={povs.length} />
        {povs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-1">No POV yet.</p>
        ) : (
          <div className="space-y-2">
            {povs.map((p) => (
              <PovCard key={p.id} row={p} onRatify={ratifyPov} />
            ))}
          </div>
        )}
      </div>

      {/* RISKS */}
      <div>
        <SectionHeader icon={AlertTriangle} title="Risks" count={risks.length} />
        {risks.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-1">No risks logged.</p>
        ) : (
          <div className="space-y-2">
            {risks.map((r) => (
              <RiskCard key={r.id} row={r} />
            ))}
          </div>
        )}
      </div>

      {/* SIGNALS */}
      <div>
        <SectionHeader icon={Radio} title="Signals" count={signals.length} />
        {signals.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-1">No signals yet.</p>
        ) : (
          <div className="space-y-2">
            {signals.slice(0, 10).map((s) => (
              <SignalCard key={s.id} row={s} />
            ))}
            {signals.length > 10 && (
              <p className="text-[10px] text-muted-foreground italic">
                Showing 10 of {signals.length}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* 📖 DEEP DIVE — current dossier */}
      {dossier && (
        <div>
          <SectionHeader icon={BookOpen} title="Deep dive" />
          <div className="rounded-md border border-border/60 bg-background p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px]">
                v{dossier.version}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                rendered {fmtDate(dossier.rendered_at)}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px]"
                  onClick={() => setDossierOpen((v) => !v)}
                >
                  {dossierOpen ? 'Hide' : 'Show'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] gap-1"
                  onClick={downloadDossier}
                >
                  <Download className="h-3 w-3" />
                  Download
                </Button>
              </div>
            </div>
            {dossierOpen && (
              <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
                <ReactMarkdown>{dossier.content_md}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

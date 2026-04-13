/**
 * Skill Builder Coverage Card — Internal audit surface
 */

import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertTriangle, Shield, Users } from 'lucide-react';
import type { CoverageAuditReport } from '@/lib/learning/skillBuilderCoverageAudit';

interface Props {
  report: CoverageAuditReport;
}

export function SkillBuilderCoverageCard({ report }: Props) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <p className="text-sm font-semibold text-foreground">Skill Builder Coverage</p>

      {/* Per-skill summary */}
      <div className="space-y-3">
        {report.perSkill.map(s => (
          <div key={s.skill} className="space-y-1.5 border-b border-border pb-3 last:border-0 last:pb-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium capitalize">{s.skill.replace(/_/g, ' ')}</p>
              <div className="flex gap-1">
                <DurationBadge ok={s.hasEnoughFor15} label="15m" />
                <DurationBadge ok={s.hasEnoughFor30} label="30m" />
                <DurationBadge ok={s.hasEnoughFor60} label="60m" />
              </div>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span>{s.totalKIs} KIs</span>
              <span>{s.coveredPatterns}/{s.totalPatterns} patterns</span>
              <span className="flex items-center gap-0.5">
                <Shield className="h-2.5 w-2.5" /> {s.pressureCoveragePct}%
              </span>
              <span className="flex items-center gap-0.5">
                <Users className="h-2.5 w-2.5" /> {s.multiThreadCoveragePct}%
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {s.deepPatterns.map(p => (
                <Badge key={p} variant="default" className="text-[9px] bg-green-600/80">
                  {p.replace(/_/g, ' ')}
                </Badge>
              ))}
              {s.usablePatterns.map(p => (
                <Badge key={p} variant="secondary" className="text-[9px]">
                  {p.replace(/_/g, ' ')}
                </Badge>
              ))}
              {s.thinPatterns.map(p => (
                <Badge key={p} variant="outline" className="text-[9px] border-destructive/40 text-destructive">
                  {p.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Strongest / weakest */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-green-500/5 border border-green-500/15 px-2 py-1.5">
          <p className="text-[10px] font-medium text-foreground">Strongest</p>
          {report.strongestSkills.map(s => (
            <p key={s} className="text-[10px] text-muted-foreground capitalize">{s.replace(/_/g, ' ')}</p>
          ))}
        </div>
        <div className="rounded-md bg-red-500/5 border border-red-500/15 px-2 py-1.5">
          <p className="text-[10px] font-medium text-foreground">Weakest</p>
          {report.weakestSkills.map(s => (
            <p key={s} className="text-[10px] text-muted-foreground capitalize">{s.replace(/_/g, ' ')}</p>
          ))}
        </div>
      </div>

      {/* Global gaps */}
      {report.globalGaps.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Global Gaps</p>
          {report.globalGaps.map((g, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[10px] text-muted-foreground">{g}</p>
            </div>
          ))}
        </div>
      )}

      {/* Redundancy alerts */}
      {report.redundancyAlerts.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Redundancy</p>
          {report.redundancyAlerts.map((r, i) => (
            <p key={i} className="text-[10px] text-muted-foreground">{r}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function DurationBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${
      ok ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive'
    }`}>
      {ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

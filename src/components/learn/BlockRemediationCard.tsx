/**
 * Block Remediation Card — Phase 4
 *
 * Shows persistent structural gaps across the block.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Wrench, AlertCircle, ArrowRight, BookOpen } from 'lucide-react';
import type { BlockRemediation } from '@/lib/learning/learnWeeklyEngine';

interface Props {
  remediation: BlockRemediation;
}

export function BlockRemediationCard({ remediation }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Block Gaps
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">{remediation.headline}</p>

          {/* Gaps */}
          <div className="space-y-1.5">
            {remediation.gaps.map((gap, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-foreground leading-relaxed">{gap}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          {remediation.recommendedActions.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                What to do
              </p>
              {remediation.recommendedActions.map((action, i) => (
                <div key={i} className="flex items-start gap-2">
                  <ArrowRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground leading-relaxed">{action}</p>
                </div>
              ))}
            </div>
          )}

          {/* KI recommendations */}
          {remediation.recommendedKITitles.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Review these
              </p>
              {remediation.recommendedKITitles.map((title, i) => (
                <div key={i} className="flex items-start gap-2">
                  <BookOpen className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground leading-relaxed">{title}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

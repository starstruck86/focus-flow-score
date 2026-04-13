/**
 * DaveCoachingFocusChip — Compact inline chip showing the active coaching focus.
 *
 * Used in Dojo and Skill Builder headers when a session is part of a closed loop.
 * Unobtrusive — just a label and status indicator.
 */

import { Badge } from '@/components/ui/badge';
import { Target } from 'lucide-react';

interface Props {
  concept: string;
  skill?: string;
  /** Optional label override for remediation context */
  contextLabel?: string;
}

export function DaveCoachingFocusChip({ concept, skill, contextLabel }: Props) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
      <Target className="h-3 w-3 text-primary shrink-0" />
      <span className="text-xs font-medium text-primary truncate max-w-[180px]">
        {contextLabel || `Focus: ${concept}`}
      </span>
      {skill && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 capitalize">
          {skill.replace(/_/g, ' ')}
        </Badge>
      )}
    </div>
  );
}

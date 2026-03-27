/**
 * Doctrine Recovery Tools — operator-safe self-healing actions.
 */

import { memo, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw, Shield, Eye, Search, Zap } from 'lucide-react';
import {
  recomputeAllFreshness,
  disableStalePropagation,
  reEnableApprovedPropagation,
  detectDuplicatesAndConflicts,
} from '@/lib/salesBrain';
import { toast } from 'sonner';

export const DoctrineRecoveryTools = memo(function DoctrineRecoveryTools() {
  const [lastResult, setLastResult] = useState<string | null>(null);

  const runAction = useCallback((label: string, fn: () => string) => {
    const result = fn();
    setLastResult(`${label}: ${result}`);
    toast.success(`${label}: ${result}`);
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          Recovery Tools
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="text-[10px] h-7 gap-1 justify-start"
            onClick={() => runAction('Freshness recomputed', () => {
              const n = recomputeAllFreshness();
              return `${n} entries updated`;
            })}>
            <RefreshCw className="h-3 w-3" /> Recompute Freshness
          </Button>
          <Button variant="outline" size="sm" className="text-[10px] h-7 gap-1 justify-start"
            onClick={() => runAction('Duplicate/conflict scan', () => {
              const { duplicates, conflicts } = detectDuplicatesAndConflicts();
              return `${duplicates} dups, ${conflicts} conflicts`;
            })}>
            <Search className="h-3 w-3" /> Scan Duplicates
          </Button>
          <Button variant="outline" size="sm" className="text-[10px] h-7 gap-1 justify-start"
            onClick={() => runAction('Stale propagation disabled', () => {
              const n = disableStalePropagation();
              return `${n} entries disabled`;
            })}>
            <Eye className="h-3 w-3" /> Disable Stale Propagation
          </Button>
          <Button variant="outline" size="sm" className="text-[10px] h-7 gap-1 justify-start"
            onClick={() => runAction('Approved re-enabled', () => {
              const n = reEnableApprovedPropagation();
              return `${n} entries re-enabled`;
            })}>
            <Zap className="h-3 w-3" /> Re-enable Approved
          </Button>
        </div>
        {lastResult && (
          <p className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1">{lastResult}</p>
        )}
      </CardContent>
    </Card>
  );
});

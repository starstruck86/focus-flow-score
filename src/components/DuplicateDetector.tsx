import { useState } from 'react';
import { AlertTriangle, X, Merge, ChevronDown, ChevronRight, Building2, Target, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useDuplicateDetection, type DuplicateGroup } from '@/hooks/useDuplicateDetection';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function DuplicateGroupCard({ group, onMerge, onDismiss }: {
  group: DuplicateGroup;
  onMerge: (keepId: string, removeIds: string[]) => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [selectedKeep, setSelectedKeep] = useState<string>(group.items[0].id);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const keepItem = group.items.find(i => i.id === selectedKeep)!;
  const removeItems = group.items.filter(i => i.id !== selectedKeep);

  return (
    <Card className="border-status-yellow/30 bg-status-yellow/5">
      <CardHeader className="py-3 px-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            {group.type === 'account' ? <Building2 className="h-4 w-4 text-status-yellow" /> : <Target className="h-4 w-4 text-status-yellow" />}
            <CardTitle className="text-sm font-semibold">
              {group.items.length} potential duplicates
            </CardTitle>
            <Badge variant="outline" className="text-[10px]">
              {group.type === 'account' ? 'Accounts' : 'Opportunities'}
            </Badge>
          </div>
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setConfirmOpen(true)}>
              <Merge className="h-3 w-3" /> Merge
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={onDismiss}>
              <X className="h-3 w-3" /> Dismiss
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 px-4 pb-3 space-y-2">
          {group.items.map(item => (
            <div
              key={item.id}
              className={cn(
                "flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors",
                selectedKeep === item.id
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              )}
              onClick={() => setSelectedKeep(item.id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                {selectedKeep === item.id ? (
                  <Badge className="text-[9px] bg-primary/20 text-primary shrink-0">KEEP</Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] shrink-0 text-status-red border-status-red/30">REMOVE</Badge>
                )}
                <span className="text-sm font-medium truncate">{item.name}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-[11px] text-muted-foreground">
                {item.linkedCount > 0 && (
                  <span className="flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" />
                    {item.linkedCount} linked
                  </span>
                )}
                {Object.entries(item.details).map(([key, value]) => {
                  if (!value || key === 'isInDb' || key === 'accountId') return null;
                  if (key === 'arr' && typeof value === 'number') {
                    return <span key={key} className="font-mono">${(value / 1000).toFixed(0)}k</span>;
                  }
                  if (typeof value === 'number') return <span key={key}>{key}: {value}</span>;
                  if (typeof value === 'string' && value.length < 20) return <Badge key={key} variant="outline" className="text-[9px]">{value}</Badge>;
                  return null;
                })}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground mt-1">
            Click a row to mark it as the record to <strong>keep</strong>. Notes, dates, and ARR from removed records will be merged into the kept record.
          </p>
        </CardContent>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Merge</AlertDialogTitle>
            <AlertDialogDescription>
              Keep <strong>"{keepItem.name}"</strong> and merge {removeItems.length} duplicate(s) into it.
              Notes will be combined, dates will use the most recent values, and ARR will use the highest value. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onMerge(selectedKeep, removeItems.map(i => i.id))}>
              Merge {removeItems.length} duplicate(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function DuplicateDetector() {
  const { duplicateAccounts, duplicateOpportunities, mergeAccounts, mergeOpportunities, dismissGroup } = useDuplicateDetection();

  const visibleCount = duplicateAccounts.length + duplicateOpportunities.length;
  if (visibleCount === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-status-yellow" />
        <h3 className="text-sm font-semibold">
          {visibleCount} Potential Duplicate{visibleCount !== 1 ? ' Groups' : ''} Detected
        </h3>
        <Badge variant="outline" className="text-[10px] text-status-yellow border-status-yellow/30">
          Review & Merge
        </Badge>
      </div>

      {duplicateAccounts.map(group => (
        <DuplicateGroupCard
          key={group.key}
          group={group}
          onMerge={(keepId, removeIds) => {
            mergeAccounts(keepId, removeIds);
          }}
          onDismiss={() => dismissGroup(group.key, 'account')}
        />
      ))}

      {duplicateOpportunities.map(group => (
        <DuplicateGroupCard
          key={group.key}
          group={group}
          onMerge={(keepId, removeIds) => {
            mergeOpportunities(keepId, removeIds);
          }}
          onDismiss={() => dismissGroup(group.key, 'opportunity')}
        />
      ))}
    </div>
  );
}

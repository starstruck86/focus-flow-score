import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { Opportunity, OpportunityStage } from '@/types';

interface KanbanBoardProps {
  opportunities: Opportunity[];
  onStageChange: (id: string, newStage: OpportunityStage) => void;
  onSelect: (id: string) => void;
}

const KANBAN_STAGES: { stage: OpportunityStage; label: string; color: string }[] = [
  { stage: 'Prospect', label: 'Prospect', color: 'border-t-blue-400' },
  { stage: 'Discover', label: 'Discover', color: 'border-t-cyan-400' },
  { stage: 'Demo', label: 'Demo', color: 'border-t-status-yellow' },
  { stage: 'Proposal', label: 'Proposal', color: 'border-t-orange-400' },
  { stage: 'Negotiate', label: 'Negotiate', color: 'border-t-purple-400' },
  { stage: 'Closed Won', label: 'Won', color: 'border-t-status-green' },
  { stage: 'Closed Lost', label: 'Lost', color: 'border-t-status-red' },
];

export function KanbanBoard({ opportunities, onStageChange, onSelect }: KanbanBoardProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const columnData = useMemo(() => {
    return KANBAN_STAGES.map(col => ({
      ...col,
      opps: opportunities.filter(o => o.stage === col.stage),
      totalArr: opportunities
        .filter(o => o.stage === col.stage)
        .reduce((sum, o) => sum + (o.arr || 0), 0),
    }));
  }, [opportunities]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, stage: OpportunityStage) => {
    e.preventDefault();
    if (draggedId) {
      onStageChange(draggedId, stage);
      setDraggedId(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[400px]">
      {columnData.map(col => (
        <div
          key={col.stage}
          className={cn(
            "flex-shrink-0 w-56 bg-muted/30 rounded-lg border-t-2 flex flex-col",
            col.color
          )}
          onDrop={(e) => handleDrop(e, col.stage)}
          onDragOver={handleDragOver}
        >
          {/* Column header */}
          <div className="p-3 pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {col.label}
              </span>
              <Badge variant="outline" className="text-[10px] h-5">
                {col.opps.length}
              </Badge>
            </div>
            {col.totalArr > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                ${(col.totalArr / 1000).toFixed(0)}k
              </div>
            )}
          </div>

          {/* Cards */}
          <div className="flex-1 px-2 pb-2 space-y-2 overflow-y-auto max-h-[500px]">
            {col.opps.map(opp => (
              <motion.div
                key={opp.id}
                layout
                draggable
                onDragStart={(e) => handleDragStart(e as any, opp.id)}
                className={cn(
                  "bg-card border border-border/50 rounded-md p-2.5 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors",
                  draggedId === opp.id && "opacity-50"
                )}
                onClick={() => onSelect(opp.id)}
              >
                <div className="text-sm font-medium truncate">{opp.name}</div>
                {opp.accountName && (
                  <div className="text-[10px] text-muted-foreground truncate mt-0.5">{opp.accountName}</div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  {opp.arr != null && opp.arr > 0 && (
                    <span className="text-xs font-semibold text-foreground">
                      ${(opp.arr / 1000).toFixed(0)}k
                    </span>
                  )}
                  {opp.closeDate && (
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(opp.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  {opp.churnRisk && opp.churnRisk !== 'low' && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] h-4 px-1",
                        opp.churnRisk === 'high' && 'border-status-red text-status-red',
                        opp.churnRisk === 'medium' && 'border-status-yellow text-status-yellow',
                      )}
                    >
                      {opp.churnRisk}
                    </Badge>
                  )}
                </div>
              </motion.div>
            ))}
            {col.opps.length === 0 && (
              <div className="text-xs text-muted-foreground/50 text-center py-8">
                Drop here
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

import { useState } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Sparkles, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Opportunity } from '@/types';

interface ClaudeSynopsisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: Opportunity;
}

interface ParsedUpdates {
  updates: Record<string, any>;
  contacts?: { name: string; title?: string; buyerRole?: string; notes?: string }[];
  summary: string;
}

const FIELD_LABELS: Record<string, string> = {
  stage: 'Stage', status: 'Status', arr: 'ARR', closeDate: 'Close Date',
  nextStep: 'Next Step', nextStepDate: 'Next Step Date', notes: 'Notes',
  churnRisk: 'Churn Risk', dealType: 'Deal Type', priorContractArr: 'Prior Contract ARR',
  renewalArr: 'Renewal ARR', oneTimeAmount: 'One-Time Amount', termMonths: 'Term (months)',
};

function formatValue(key: string, value: any): string {
  if (value === null || value === undefined) return '—';
  if (key === 'arr' || key === 'priorContractArr' || key === 'renewalArr' || key === 'oneTimeAmount') {
    return `$${Number(value).toLocaleString()}`;
  }
  return String(value);
}

export function ClaudeSynopsisModal({ open, onOpenChange, opportunity }: ClaudeSynopsisModalProps) {
  const { updateOpportunity } = useStore();
  const [text, setText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedUpdates | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  const handleParse = async () => {
    if (!text.trim()) return;
    setIsParsing(true);
    setParsed(null);
    try {
      const { data, error } = await trackedInvoke<any>('parse-opp-synopsis', {
        body: {
          text: text.trim(),
          opportunityContext: {
            name: opportunity.name,
            stage: opportunity.stage,
            status: opportunity.status,
            arr: opportunity.arr,
            nextStep: opportunity.nextStep,
            dealType: opportunity.dealType,
            accountName: opportunity.accountName,
          },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setParsed(data);
      // Auto-select all update fields
      const fields = Object.keys(data.updates || {}).filter(k => data.updates[k] !== undefined && data.updates[k] !== null);
      setSelectedFields(new Set(fields));
    } catch (err) {
      toast.error('Failed to parse synopsis', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsParsing(false);
    }
  };

  const handleApply = () => {
    if (!parsed) return;
    const updates: Record<string, any> = {};
    for (const field of selectedFields) {
      if (parsed.updates[field] !== undefined) {
        updates[field] = parsed.updates[field];
      }
    }
    if (Object.keys(updates).length > 0) {
      // Append notes instead of replacing
      if (updates.notes && opportunity.notes) {
        updates.notes = `${opportunity.notes}\n\n--- Synopsis Update ---\n${updates.notes}`;
      }
      updateOpportunity(opportunity.id, updates);
      toast.success(`Updated ${Object.keys(updates).length} field(s)`, {
        description: parsed.summary,
      });
    }
    onOpenChange(false);
    setText('');
    setParsed(null);
    setSelectedFields(new Set());
  };

  const handleClose = () => {
    onOpenChange(false);
    setText('');
    setParsed(null);
    setSelectedFields(new Set());
  };

  const toggleField = (field: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const updateFields = parsed ? Object.entries(parsed.updates).filter(([_, v]) => v !== undefined && v !== null) : [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Paste Synopsis — {opportunity.name}
          </DialogTitle>
          <DialogDescription>
            Paste text from Claude or meeting notes to extract field updates.
          </DialogDescription>
        </DialogHeader>

        {!parsed ? (
          <div className="space-y-3">
            <Textarea
              placeholder="Paste your Claude synopsis, meeting notes, or deal update text here..."
              value={text}
              onChange={e => setText(e.target.value)}
              rows={8}
              className="resize-none text-sm"
            />
            <Button onClick={handleParse} disabled={!text.trim() || isParsing} className="w-full gap-2">
              {isParsing ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> Parsing...</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Extract Updates</>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
              <p className="text-muted-foreground italic">{parsed.summary}</p>
            </div>

            {/* Field updates */}
            {updateFields.length > 0 ? (
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Field Updates ({selectedFields.size}/{updateFields.length} selected)
                </Label>
                <div className="space-y-1.5">
                  {updateFields.map(([key, value]) => {
                    const currentValue = (opportunity as any)[key];
                    return (
                      <label
                        key={key}
                        className={cn(
                          "flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors",
                          selectedFields.has(key) ? "bg-primary/5 border-primary/30" : "bg-muted/20 border-border/50"
                        )}
                      >
                        <Checkbox
                          checked={selectedFields.has(key)}
                          onCheckedChange={() => toggleField(key)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{FIELD_LABELS[key] || key}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {currentValue !== undefined && currentValue !== null && (
                              <span className="text-[11px] text-muted-foreground line-through">
                                {formatValue(key, currentValue)}
                              </span>
                            )}
                            <span className="text-[11px]">→</span>
                            <span className="text-[11px] font-medium text-primary">
                              {formatValue(key, value)}
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <AlertTriangle className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No field updates found in the text.</p>
              </div>
            )}

            {/* Contacts */}
            {parsed.contacts && parsed.contacts.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Contacts Mentioned
                </Label>
                <div className="space-y-1">
                  {parsed.contacts.map((c, i) => (
                    <div key={i} className="p-2 rounded-lg bg-muted/30 text-xs">
                      <span className="font-medium">{c.name}</span>
                      {c.title && <span className="text-muted-foreground"> — {c.title}</span>}
                      {c.buyerRole && <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0">{c.buyerRole}</Badge>}
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground italic">
                    Contacts shown for reference — add them via Stakeholder Map.
                  </p>
                </div>
              </div>
            )}

            {/* Re-parse */}
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => setParsed(null)}>
              <RefreshCw className="h-3 w-3" /> Re-parse with different text
            </Button>
          </div>
        )}

        {parsed && updateFields.length > 0 && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleApply} disabled={selectedFields.size === 0} className="gap-1.5">
              <Check className="h-4 w-4" />
              Apply {selectedFields.size} Update{selectedFields.size !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Transformation Preview Dialog
 * Shows original vs transformed content with removed lines before promotion.
 */

import { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, Check, Minus, Eye } from 'lucide-react';
import { shapeAsTemplate, shapeAsExample, type TransformationResult } from '@/lib/contentSignature';

interface TransformationPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalContent: string;
  title: string;
  type: 'template' | 'example';
  onConfirm: (shapedContent: string) => void;
}

export function TransformationPreviewDialog({
  open,
  onOpenChange,
  originalContent,
  title,
  type,
  onConfirm,
}: TransformationPreviewDialogProps) {
  const result: TransformationResult = useMemo(() => {
    return type === 'template'
      ? shapeAsTemplate(originalContent)
      : shapeAsExample(originalContent);
  }, [originalContent, type]);

  const hasRemovals = result.removedLines.length > 0;
  const removalPct = result.originalLineCount > 0
    ? Math.round((result.removedLines.length / result.originalLineCount) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            Transformation Preview — {type === 'template' ? 'Template' : 'Example'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Review what will be promoted from &ldquo;{title}&rdquo;. Verify no important context is removed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 text-[10px]">
          <Badge variant="outline" className="text-[10px]">
            {result.originalLineCount} → {result.shapedLineCount} lines
          </Badge>
          {hasRemovals && (
            <Badge variant="outline" className="text-[10px] border-status-yellow/50 text-status-yellow">
              {result.removedLines.length} lines removed ({removalPct}%)
            </Badge>
          )}
          {!hasRemovals && (
            <Badge variant="outline" className="text-[10px] border-status-green/50 text-status-green">
              <Check className="h-2.5 w-2.5 mr-1" /> No lines removed
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
          {/* Original */}
          <div className="flex flex-col min-h-0">
            <p className="text-[10px] font-medium text-muted-foreground mb-1">Original</p>
            <ScrollArea className="flex-1 border rounded-md bg-muted/30 max-h-[300px]">
              <pre className="p-2 text-[10px] whitespace-pre-wrap font-mono text-muted-foreground leading-relaxed">
                {originalContent}
              </pre>
            </ScrollArea>
          </div>

          {/* Transformed */}
          <div className="flex flex-col min-h-0">
            <p className="text-[10px] font-medium text-foreground mb-1">
              Transformed ({type === 'template' ? 'Template' : 'Example'})
            </p>
            <ScrollArea className="flex-1 border rounded-md border-primary/20 bg-primary/5 max-h-[300px]">
              <pre className="p-2 text-[10px] whitespace-pre-wrap font-mono text-foreground leading-relaxed">
                {result.shaped}
              </pre>
            </ScrollArea>
          </div>
        </div>

        {/* Removed lines */}
        {hasRemovals && (
          <div>
            <p className="text-[10px] font-medium text-status-yellow mb-1 flex items-center gap-1">
              <Minus className="h-3 w-3" /> Removed Lines
            </p>
            <ScrollArea className="max-h-[100px] border rounded-md border-destructive/20 bg-destructive/5">
              <div className="p-2 space-y-0.5">
                {result.removedLines.map((line, i) => (
                  <p key={i} className="text-[10px] text-destructive/80 font-mono line-through">
                    {line || '(empty line)'}
                  </p>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {removalPct > 30 && (
          <div className="flex items-start gap-2 p-2 rounded bg-status-yellow/10 border border-status-yellow/30">
            <AlertTriangle className="h-3.5 w-3.5 text-status-yellow shrink-0 mt-0.5" />
            <p className="text-[10px] text-status-yellow">
              More than 30% of content was removed. Review carefully to ensure important context is preserved.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onConfirm(result.shaped);
              onOpenChange(false);
            }}
          >
            Confirm & Promote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

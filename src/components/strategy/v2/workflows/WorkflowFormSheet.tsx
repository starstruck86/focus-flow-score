/**
 * WorkflowFormSheet — single reusable form for every workflow accelerator.
 *
 * Used by:
 *   • Mode pills      (Brainstorm / Deep Research / Refine)
 *   • Library workflows
 *   • Artifact templates
 *
 * Behavior:
 *   • Lightweight side sheet — composer remains visible behind it on desktop.
 *   • Light required-field check (no schema engine).
 *   • On Run: compile prompt + hand off to host (which calls existing send path).
 *   • Mobile-friendly tap targets, Run button always reachable.
 */
import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Play, X, Pencil, ChevronDown } from 'lucide-react';
import {
  type WorkflowDef,
  compileWorkflowPrompt,
} from './workflowRegistry';

interface Props {
  workflow: WorkflowDef | null;
  onClose: () => void;
  onRun: (compiledPrompt: string, def: WorkflowDef) => void;
  /** When provided, custom pills show an Edit button that calls this. */
  onEditCustom?: (customPillId: string) => void;
}

export function WorkflowFormSheet({ workflow, onClose, onRun, onEditCustom }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);

  // Reset state when a new workflow opens / closes.
  useEffect(() => {
    if (workflow) {
      const seed: Record<string, string> = {};
      for (const f of workflow.fields) {
        seed[f.key] = f.kind === 'select' && f.options?.[0] ? f.options[0] : '';
      }
      setValues(seed);
      setShowErrors(false);
    }
  }, [workflow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!workflow) return null;

  const missingRequired = workflow.fields
    .filter((f) => f.required && !values[f.key]?.trim())
    .map((f) => f.label);

  const handleRun = () => {
    if (missingRequired.length > 0) {
      setShowErrors(true);
      return;
    }
    const compiled = compileWorkflowPrompt(workflow, values);
    onRun(compiled, workflow);
  };

  const title = workflow.formTitle ?? workflow.label;

  return (
    <Sheet open={!!workflow} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col w-full sm:max-w-[440px]"
        style={{ background: 'hsl(var(--sv-paper))' }}
      >
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-3 shrink-0" style={{ borderBottom: '1px solid hsl(var(--sv-hairline))' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-[15px] font-semibold tracking-tight" style={{ color: 'hsl(var(--sv-ink))' }}>
                {title}
              </SheetTitle>
              <SheetDescription className="text-[12px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
                {workflow.description}
              </SheetDescription>
            </div>
            <button
              onClick={onClose}
              className="h-7 w-7 rounded-[6px] sv-hover-bg flex items-center justify-center shrink-0"
              style={{ color: 'hsl(var(--sv-muted))' }}
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </SheetHeader>

        {/* Fields */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {workflow.fields.map((field) => {
            const isMissing = showErrors && field.required && !values[field.key]?.trim();
            const id = `wf-${workflow.id}-${field.key}`;
            return (
              <div key={field.key} className="space-y-1.5">
                <Label
                  htmlFor={id}
                  className="text-[12px] font-medium"
                  style={{ color: 'hsl(var(--sv-ink))' }}
                >
                  {field.label}
                  {field.required && <span style={{ color: 'hsl(var(--sv-clay))' }}> *</span>}
                </Label>
                {field.kind === 'text' && (
                  <Input
                    id={id}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="h-9 text-[13px]"
                    aria-invalid={isMissing}
                  />
                )}
                {field.kind === 'textarea' && (
                  <Textarea
                    id={id}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    rows={field.rows ?? 4}
                    className="text-[13px] resize-none"
                    aria-invalid={isMissing}
                  />
                )}
                {field.kind === 'select' && (
                  <select
                    id={id}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    className="w-full h-9 px-2 rounded-md text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{
                      border: '1px solid hsl(var(--sv-hairline))',
                      background: 'hsl(var(--sv-paper))',
                      color: 'hsl(var(--sv-ink))',
                    }}
                    aria-invalid={isMissing}
                  >
                    {(field.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                )}
                {isMissing && (
                  <p className="text-[11px]" style={{ color: 'hsl(var(--sv-clay))' }}>
                    Required
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer — sticky run button */}
        <div
          className="shrink-0 px-5 py-3 flex items-center gap-2 justify-end"
          style={{ borderTop: '1px solid hsl(var(--sv-hairline))' }}
        >
          <Button variant="ghost" size="sm" onClick={onClose} className="h-9 text-[12.5px]">
            Cancel
          </Button>
          <Button
            onClick={handleRun}
            size="sm"
            className="h-9 text-[12.5px] gap-1.5"
            style={{ background: 'hsl(var(--sv-clay))', color: 'hsl(var(--sv-paper))' }}
          >
            <Play className="h-3.5 w-3.5" />
            Run
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

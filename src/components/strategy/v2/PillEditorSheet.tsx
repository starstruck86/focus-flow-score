/**
 * PillEditorSheet — create/edit/delete a programmable pill (custom GPT-style).
 *
 * Surface owners decide which surface the pill belongs to. The editor is
 * intentionally lightweight:
 *   • Name + Description
 *   • Instruction (how Strategy thinks — prepended at run time)
 *   • Fields (label + kind; required toggle)
 *   • Optional prompt template (auto-built from fields if blank)
 *
 * Persists to localStorage via lib/strategy/customPills. No backend.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, X, Wand2, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  emptyPillForSurface,
  upsertCustomPill,
  deleteCustomPill,
  type CustomPill,
} from '@/lib/strategy/customPills';
import type { StrategySurfaceKey } from './StrategyNavSidebar';
import type { WorkflowField } from './workflows/workflowRegistry';

interface Props {
  open: boolean;
  /** When non-null, edits this existing pill; when null + open, creates a new one. */
  editing: CustomPill | null;
  /** Surface the new pill belongs to (ignored when editing). */
  surface: StrategySurfaceKey;
  onClose: () => void;
  onSaved: () => void;
}

const KIND_OPTIONS: Array<{ value: WorkflowField['kind']; label: string }> = [
  { value: 'text',     label: 'Single line' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select',   label: 'Select' },
];

function fieldKeyFromLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${Math.random().toString(36).slice(2, 6)}`;
}

export function PillEditorSheet({ open, editing, surface, onClose, onSaved }: Props) {
  const [pill, setPill] = useState<CustomPill>(() => editing ?? emptyPillForSurface(surface));

  useEffect(() => {
    if (open) {
      setPill(editing ?? emptyPillForSurface(surface));
    }
  }, [open, editing, surface]);

  const isEdit = !!editing;
  const surfaceLabel = surface === 'deep_research' ? 'Deep Research' : surface.charAt(0).toUpperCase() + surface.slice(1);

  const canSave = useMemo(() => {
    return pill.name.trim().length > 0 && pill.fields.length > 0
      && pill.fields.every((f) => f.label.trim().length > 0);
  }, [pill]);

  const handleSave = () => {
    if (!canSave) {
      toast.error('Pill needs a name and at least one named field.');
      return;
    }
    // Re-key fields from labels to keep keys clean and stable on rename.
    const cleaned: CustomPill = {
      ...pill,
      name: pill.name.trim(),
      description: pill.description.trim(),
      instruction: pill.instruction.trim(),
      fields: pill.fields.map((f) => ({
        ...f,
        label: f.label.trim(),
        key: f.key?.trim() || fieldKeyFromLabel(f.label),
      })),
      promptTemplate: pill.promptTemplate?.trim() ?? '',
      updatedAt: new Date().toISOString(),
    };
    upsertCustomPill(cleaned);
    toast.success(isEdit ? 'Pill updated' : 'Pill created', {
      description: `${cleaned.name} is now in ${surfaceLabel}.`,
    });
    onSaved();
    onClose();
  };

  const handleDelete = () => {
    if (!isEdit) return;
    if (!confirm(`Delete pill "${pill.name}"? This cannot be undone.`)) return;
    deleteCustomPill(pill.id);
    toast.success('Pill deleted');
    onSaved();
    onClose();
  };

  const updateField = (idx: number, patch: Partial<WorkflowField>) => {
    setPill((p) => ({
      ...p,
      fields: p.fields.map((f, i) => i === idx ? { ...f, ...patch } : f),
    }));
  };

  const addField = () => {
    setPill((p) => ({
      ...p,
      fields: [...p.fields, { key: `field_${p.fields.length + 1}`, label: '', kind: 'text' }],
    }));
  };

  const removeField = (idx: number) => {
    setPill((p) => ({
      ...p,
      fields: p.fields.filter((_, i) => i !== idx),
    }));
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col w-full sm:max-w-[480px]"
        style={{ background: 'hsl(var(--sv-paper))' }}
      >
        <SheetHeader
          className="px-5 pt-5 pb-3 shrink-0"
          style={{ borderBottom: '1px solid hsl(var(--sv-hairline))' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-[15px] font-semibold tracking-tight flex items-center gap-2" style={{ color: 'hsl(var(--sv-ink))' }}>
                <Wand2 className="h-4 w-4" style={{ color: 'hsl(var(--sv-clay))' }} />
                {isEdit ? 'Edit pill' : 'New pill'}
                <span className="text-[11px] px-1.5 py-px rounded-full ml-1" style={{ background: 'hsl(var(--sv-hover))', color: 'hsl(var(--sv-muted))' }}>
                  {surfaceLabel}
                </span>
              </SheetTitle>
              <SheetDescription className="text-[12px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
                A pill is a programmable shortcut. Define what Strategy should do and what inputs to ask for.
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

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {/* Name + Description */}
          <div className="space-y-1.5">
            <Label htmlFor="pill-name" className="text-[12px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
              Name <span style={{ color: 'hsl(var(--sv-clay))' }}>*</span>
            </Label>
            <Input
              id="pill-name"
              value={pill.name}
              onChange={(e) => setPill((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Cold open for VP Marketing"
              className="h-9 text-[13px]"
              autoFocus={!isEdit}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pill-desc" className="text-[12px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
              Description <span style={{ color: 'hsl(var(--sv-muted))' }}>(optional)</span>
            </Label>
            <Input
              id="pill-desc"
              value={pill.description}
              onChange={(e) => setPill((p) => ({ ...p, description: e.target.value }))}
              placeholder="What this pill does in one line"
              className="h-9 text-[13px]"
            />
          </div>

          {/* Instruction */}
          <div className="space-y-1.5">
            <Label htmlFor="pill-instruction" className="text-[12px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
              Instruction
            </Label>
            <Textarea
              id="pill-instruction"
              value={pill.instruction}
              onChange={(e) => setPill((p) => ({ ...p, instruction: e.target.value }))}
              placeholder={
                'How should Strategy think? e.g. "Be terse, executive-ready, no fluff. Always end with one clear ask."'
              }
              rows={4}
              className="text-[13px] resize-none"
            />
            <p className="text-[11px]" style={{ color: 'hsl(var(--sv-muted))' }}>
              This is prepended to every run of this pill.
            </p>
          </div>

          {/* Fields */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[12px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
                Inputs
              </Label>
              <button
                type="button"
                onClick={addField}
                className="text-[11.5px] inline-flex items-center gap-1 px-2 py-1 rounded-[6px] sv-hover-bg"
                style={{ color: 'hsl(var(--sv-clay))' }}
              >
                <Plus className="h-3 w-3" /> Add field
              </button>
            </div>
            {pill.fields.length === 0 && (
              <p className="text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
                Add at least one input.
              </p>
            )}
            <div className="space-y-2">
              {pill.fields.map((f, idx) => (
                <div
                  key={`${f.key}-${idx}`}
                  className="rounded-[8px] p-2.5 space-y-2"
                  style={{ border: '1px solid hsl(var(--sv-hairline))', background: 'hsl(var(--sv-paper))' }}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <Input
                        value={f.label}
                        onChange={(e) => updateField(idx, { label: e.target.value, key: fieldKeyFromLabel(e.target.value) })}
                        placeholder="Field label (e.g. Company)"
                        className="h-8 text-[12.5px]"
                      />
                      <div className="flex items-center gap-2">
                        <select
                          value={f.kind}
                          onChange={(e) => updateField(idx, { kind: e.target.value as WorkflowField['kind'] })}
                          className="h-8 px-2 rounded-md text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          style={{
                            border: '1px solid hsl(var(--sv-hairline))',
                            background: 'hsl(var(--sv-paper))',
                            color: 'hsl(var(--sv-ink))',
                          }}
                        >
                          {KIND_OPTIONS.map((k) => (
                            <option key={k.value} value={k.value}>{k.label}</option>
                          ))}
                        </select>
                        <label className="inline-flex items-center gap-1 text-[11.5px] cursor-pointer select-none" style={{ color: 'hsl(var(--sv-muted))' }}>
                          <input
                            type="checkbox"
                            checked={!!f.required}
                            onChange={(e) => updateField(idx, { required: e.target.checked })}
                            className="h-3 w-3"
                          />
                          Required
                        </label>
                      </div>
                      {f.kind === 'select' && (
                        <Input
                          value={(f.options ?? []).join(', ')}
                          onChange={(e) => updateField(idx, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                          placeholder="Comma-separated options (e.g. Quick, Standard, Deep)"
                          className="h-8 text-[12px]"
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeField(idx)}
                      className="h-7 w-7 rounded-[6px] sv-hover-bg flex items-center justify-center shrink-0"
                      style={{ color: 'hsl(var(--sv-muted))' }}
                      aria-label={`Remove field ${f.label || idx + 1}`}
                      title="Remove field"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Optional prompt template */}
          <details className="rounded-[8px]" style={{ border: '1px dashed hsl(var(--sv-hairline))' }}>
            <summary className="cursor-pointer px-3 py-2 text-[12px]" style={{ color: 'hsl(var(--sv-ink) / 0.85)' }}>
              Advanced: prompt template
            </summary>
            <div className="px-3 pb-3 pt-1 space-y-1.5">
              <Textarea
                value={pill.promptTemplate ?? ''}
                onChange={(e) => setPill((p) => ({ ...p, promptTemplate: e.target.value }))}
                placeholder="Use {{Field Label}} tokens. Leave blank to auto-build from fields."
                rows={5}
                className="text-[12px] resize-none font-mono"
              />
              <p className="text-[10.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
                Tokens: {pill.fields.map((f) => `{{${f.label || '…'}}}`).join('  ') || 'add fields above'}
              </p>
            </div>
          </details>
        </div>

        <div className="shrink-0 px-5 py-3 flex items-center gap-2 justify-between" style={{ borderTop: '1px solid hsl(var(--sv-hairline))' }}>
          <div>
            {isEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                className="h-9 text-[12.5px] gap-1.5"
                style={{ color: 'hsl(var(--sv-clay))' }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="h-9 text-[12.5px]">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              size="sm"
              disabled={!canSave}
              className="h-9 text-[12.5px] gap-1.5"
              style={{ background: 'hsl(var(--sv-clay))', color: 'hsl(var(--sv-paper))' }}
            >
              <Save className="h-3.5 w-3.5" />
              {isEdit ? 'Save' : 'Create pill'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

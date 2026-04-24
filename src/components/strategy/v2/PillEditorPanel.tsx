/**
 * PillEditorPanel — create/edit/delete a programmable pill (custom GPT-style).
 *
 * Page-embedded version of the editor (no Sheet/modal). Hosted by the
 * Strategy Settings page at /strategy/settings/pill/:id (or :new). Same
 * fields as the legacy sheet so behavior is identical:
 *
 *   • Identity:    Name, Description, Workspace
 *   • Behavior:    Prompt template, Hidden instructions, Ask clarifying first
 *   • Output:      Output type (chat / artifact / word / pdf / excel / ppt / email / task)
 *   • Run mode:    Insert into composer (default) or Send immediately
 *   • Inputs:      Optional structured fields ({{Token}}); usually unused.
 *   • Attachments: Resources / templates / files / context placeholders (stub).
 *   • Lifecycle:   Visibility (active), Order, Duplicate, Delete.
 *
 * Persists to localStorage via lib/strategy/customPills.
 */
import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Wand2, Save, Copy, Paperclip, Eye, EyeOff, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  emptyPillForSurface,
  upsertCustomPill,
  deleteCustomPill,
  duplicateCustomPill,
  listCustomPillsForSurface,
  reorderCustomPills,
  type CustomPill,
} from '@/lib/strategy/customPills';
import type { StrategySurfaceKey } from './StrategyNavSidebar';
import {
  type WorkflowField,
  type PillOutputType,
  type PillRunMode,
} from './workflows/workflowRegistry';

const SURFACE_OPTIONS: Array<{ value: StrategySurfaceKey; label: string }> = [
  { value: 'brainstorm',    label: 'Brainstorm' },
  { value: 'deep_research', label: 'Deep Research' },
  { value: 'refine',        label: 'Refine' },
  { value: 'library',       label: 'Library' },
  { value: 'artifacts',     label: 'Artifacts' },
];

const OUTPUT_TYPE_OPTIONS: Array<{ value: PillOutputType; label: string }> = [
  { value: 'chat',       label: 'Chat response' },
  { value: 'artifact',   label: 'Structured artifact' },
  { value: 'word',       label: 'Word document' },
  { value: 'pdf',        label: 'PDF' },
  { value: 'excel',      label: 'Excel / CSV' },
  { value: 'powerpoint', label: 'PowerPoint' },
  { value: 'email',      label: 'Email draft' },
  { value: 'task',       label: 'Task / run output' },
];

const CONTEXT_TOKEN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'account',       label: 'Active account' },
  { value: 'opportunity',   label: 'Active opportunity' },
  { value: 'prior_threads', label: 'Prior threads in this workspace' },
  { value: 'recent_calls',  label: 'Recent call transcripts' },
];

const KIND_OPTIONS: Array<{ value: WorkflowField['kind']; label: string }> = [
  { value: 'text',     label: 'Single line' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select',   label: 'Select' },
];

interface Props {
  /** When non-null, edits this existing pill; when null, creates a new one. */
  editing: CustomPill | null;
  /** Surface for new pills (ignored when editing — surface is editable). */
  surface: StrategySurfaceKey;
  onSaved: () => void;
  onCancel: () => void;
}

function fieldKeyFromLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    || `field_${Math.random().toString(36).slice(2, 6)}`;
}

function surfaceLabelOf(s: StrategySurfaceKey): string {
  return SURFACE_OPTIONS.find((o) => o.value === s)?.label
    ?? (s.charAt(0).toUpperCase() + s.slice(1));
}

export function PillEditorPanel({ editing, surface, onSaved, onCancel }: Props) {
  const [pill, setPill] = useState<CustomPill>(() => editing ?? emptyPillForSurface(surface));

  useEffect(() => {
    const base = editing ?? emptyPillForSurface(surface);
    setPill({
      ...base,
      outputType: base.outputType ?? 'chat',
      runMode: base.runMode ?? 'insert',
      askClarifying: base.askClarifying ?? false,
      isActive: base.isActive ?? true,
      attachments: base.attachments ?? {
        resourceIds: [], templateIds: [], fileIds: [],
        contextTokens: [], useAllWorkspaceKnowledge: false,
      },
    });
  }, [editing, surface]);

  const isEdit = !!editing;
  const currentSurfaceLabel = surfaceLabelOf(pill.surface);

  const canSave = useMemo(() => {
    if (pill.name.trim().length === 0) return false;
    return pill.fields.every((f) => f.label.trim().length > 0);
  }, [pill]);

  const updateAttach = (patch: Partial<NonNullable<CustomPill['attachments']>>) => {
    setPill((p) => ({
      ...p,
      attachments: { ...(p.attachments ?? {}), ...patch },
    }));
  };

  const toggleContextToken = (token: string) => {
    const current = pill.attachments?.contextTokens ?? [];
    const next = current.includes(token)
      ? current.filter((t) => t !== token)
      : [...current, token];
    updateAttach({ contextTokens: next });
  };

  const handleSave = () => {
    if (!canSave) {
      toast.error('Pill needs a name.');
      return;
    }
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
      description: `${cleaned.name} is now in ${currentSurfaceLabel}.`,
    });
    onSaved();
  };

  const handleDelete = () => {
    if (!isEdit) return;
    if (!confirm(`Delete pill "${pill.name}"? This cannot be undone.`)) return;
    deleteCustomPill(pill.id);
    toast.success('Pill deleted');
    onSaved();
  };

  const handleDuplicate = () => {
    if (!isEdit) {
      toast.message('Save the pill first, then duplicate it.');
      return;
    }
    const copy = duplicateCustomPill(pill.id);
    if (copy) {
      toast.success('Pill duplicated', { description: `${copy.name} created in ${surfaceLabelOf(copy.surface)}.` });
      onSaved();
    }
  };

  const moveOrder = (direction: 'up' | 'down') => {
    if (!isEdit) {
      toast.message('Save the pill first to set its order.');
      return;
    }
    const siblings = listCustomPillsForSurface(pill.surface, { includeHidden: true });
    const ids = siblings.map((p) => p.id);
    const idx = ids.indexOf(pill.id);
    if (idx < 0) return;
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= ids.length) return;
    [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];
    reorderCustomPills(pill.surface, ids);
    toast.success(`Moved ${direction}`);
    onSaved();
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

  const sectionLabel = "text-[11px] font-semibold uppercase tracking-[0.06em]";
  const fieldLabel = "text-[12px] font-medium";
  const helpText = "text-[11px]";
  const selectClass = "h-9 w-full px-2 rounded-md text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const selectStyle = {
    border: '1px solid hsl(var(--sv-hairline))',
    background: 'hsl(var(--sv-paper))',
    color: 'hsl(var(--sv-ink))',
  } as const;

  return (
    <div className="flex flex-col" data-testid="pill-editor-panel">
      {/* Header */}
      <div
        className="flex items-start justify-between gap-3 mb-5 pb-3"
        style={{ borderBottom: '1px solid hsl(var(--sv-hairline))' }}
      >
        <div className="min-w-0 flex-1">
          <h2
            className="text-[18px] font-semibold tracking-tight flex items-center gap-2"
            style={{ color: 'hsl(var(--sv-ink))' }}
          >
            <Wand2 className="h-4 w-4" style={{ color: 'hsl(var(--sv-clay))' }} />
            {isEdit ? 'Edit pill' : 'New pill'}
            <span
              className="text-[11px] px-1.5 py-px rounded-full ml-1"
              style={{ background: 'hsl(var(--sv-hover))', color: 'hsl(var(--sv-muted))' }}
            >
              {currentSurfaceLabel}
            </span>
          </h2>
          <p className="text-[12.5px] mt-1" style={{ color: 'hsl(var(--sv-muted))' }}>
            A pill is a chat shortcut. Configure how it thinks, what it produces, and how it runs.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* IDENTITY */}
        <section className="space-y-3">
          <div className={sectionLabel} style={{ color: 'hsl(var(--sv-muted))' }}>Identity</div>

          <div className="space-y-1.5">
            <Label htmlFor="pill-name" className={fieldLabel} style={{ color: 'hsl(var(--sv-ink))' }}>
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
            <Label htmlFor="pill-desc" className={fieldLabel} style={{ color: 'hsl(var(--sv-ink))' }}>
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

          <div className="space-y-1.5">
            <Label htmlFor="pill-surface" className={fieldLabel} style={{ color: 'hsl(var(--sv-ink))' }}>
              Workspace
            </Label>
            <select
              id="pill-surface"
              value={pill.surface}
              onChange={(e) => setPill((p) => ({ ...p, surface: e.target.value as StrategySurfaceKey }))}
              className={selectClass}
              style={selectStyle}
            >
              {SURFACE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <p className={helpText} style={{ color: 'hsl(var(--sv-muted))' }}>
              Where this pill appears in the Strategy sidebar.
            </p>
          </div>
        </section>

        {/* PROMPT */}
        <section className="space-y-3">
          <div className={sectionLabel} style={{ color: 'hsl(var(--sv-muted))' }}>Prompt</div>

          <div className="space-y-1.5">
            <Label htmlFor="pill-template" className={fieldLabel} style={{ color: 'hsl(var(--sv-ink))' }}>
              Prompt template
            </Label>
            <Textarea
              id="pill-template"
              value={pill.promptTemplate ?? ''}
              onChange={(e) => setPill((p) => ({ ...p, promptTemplate: e.target.value }))}
              placeholder={
                'What gets inserted into the composer when the pill is clicked.\n' +
                'Use [Brackets] for things to fill in inline, e.g.\n' +
                '"Build a defensible POV on [Topic] for [Audience]. Use my prior context."'
              }
              rows={6}
              className="text-[12.5px] resize-none font-mono"
            />
            <p className={helpText} style={{ color: 'hsl(var(--sv-muted))' }}>
              Leave blank to auto-build from inputs. Bracketed placeholders stay editable in chat.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pill-instruction" className={fieldLabel} style={{ color: 'hsl(var(--sv-ink))' }}>
              Hidden instructions
            </Label>
            <Textarea
              id="pill-instruction"
              value={pill.instruction}
              onChange={(e) => setPill((p) => ({ ...p, instruction: e.target.value }))}
              placeholder={
                'How should Strategy think? e.g. "Be terse, executive-ready, no fluff. ' +
                'Always cite resources. End with one clear ask."'
              }
              rows={4}
              className="text-[13px] resize-none"
            />
            <p className={helpText} style={{ color: 'hsl(var(--sv-muted))' }}>
              System-style guidance prepended on every run. Not shown to the user.
            </p>
          </div>
        </section>

        {/* OUTPUT + RUN */}
        <section className="space-y-3">
          <div className={sectionLabel} style={{ color: 'hsl(var(--sv-muted))' }}>Output & run</div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pill-output" className={fieldLabel} style={{ color: 'hsl(var(--sv-ink))' }}>
                Output type
              </Label>
              <select
                id="pill-output"
                value={pill.outputType ?? 'chat'}
                onChange={(e) => setPill((p) => ({ ...p, outputType: e.target.value as PillOutputType }))}
                className={selectClass}
                style={selectStyle}
              >
                {OUTPUT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pill-runmode" className={fieldLabel} style={{ color: 'hsl(var(--sv-ink))' }}>
                Run behavior
              </Label>
              <select
                id="pill-runmode"
                value={pill.runMode ?? 'insert'}
                onChange={(e) => setPill((p) => ({ ...p, runMode: e.target.value as PillRunMode }))}
                className={selectClass}
                style={selectStyle}
              >
                <option value="insert">Insert into composer</option>
                <option value="send">Send immediately</option>
              </select>
            </div>
          </div>
          <p className={helpText} style={{ color: 'hsl(var(--sv-muted))' }}>
            "Send immediately" only fires when the prompt has no <code>[Brackets]</code> left to fill.
          </p>

          <div
            className="flex items-center justify-between rounded-[8px] px-3 py-2"
            style={{ border: '1px solid hsl(var(--sv-hairline))' }}
          >
            <div className="min-w-0 pr-3">
              <Label htmlFor="pill-clarify" className={fieldLabel + ' block'} style={{ color: 'hsl(var(--sv-ink))' }}>
                Ask clarifying questions first
              </Label>
              <p className={helpText} style={{ color: 'hsl(var(--sv-muted))' }}>
                Strategy will ask 1–2 sharp questions before generating.
              </p>
            </div>
            <Switch
              id="pill-clarify"
              checked={!!pill.askClarifying}
              onCheckedChange={(v) => setPill((p) => ({ ...p, askClarifying: v }))}
            />
          </div>
        </section>

        {/* ATTACHMENTS */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className={sectionLabel} style={{ color: 'hsl(var(--sv-muted))' }}>
              <Paperclip className="h-3 w-3 inline-block mr-1 -mt-0.5" />
              Attachments & context
            </div>
            <span
              className="text-[10px] px-1.5 py-px rounded-full"
              style={{ background: 'hsl(var(--sv-hover))', color: 'hsl(var(--sv-muted))' }}
            >
              Beta
            </span>
          </div>

          <div className="space-y-1.5">
            <Label className={fieldLabel} style={{ color: 'hsl(var(--sv-ink))' }}>
              Auto-attach context
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {CONTEXT_TOKEN_OPTIONS.map((opt) => {
                const checked = pill.attachments?.contextTokens?.includes(opt.value) ?? false;
                return (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 rounded-[6px] px-2 py-1.5 cursor-pointer sv-hover-bg"
                    style={{ border: '1px solid hsl(var(--sv-hairline))' }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleContextToken(opt.value)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-[12px]" style={{ color: 'hsl(var(--sv-ink))' }}>
                      {opt.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div
            className="flex items-center justify-between rounded-[8px] px-3 py-2"
            style={{ border: '1px solid hsl(var(--sv-hairline))' }}
          >
            <div className="min-w-0 pr-3">
              <Label htmlFor="pill-allknow" className={fieldLabel + ' block'} style={{ color: 'hsl(var(--sv-ink))' }}>
                Use all workspace knowledge
              </Label>
              <p className={helpText} style={{ color: 'hsl(var(--sv-muted))' }}>
                Let Strategy pull from any resource in this workspace when running.
              </p>
            </div>
            <Switch
              id="pill-allknow"
              checked={!!pill.attachments?.useAllWorkspaceKnowledge}
              onCheckedChange={(v) => updateAttach({ useAllWorkspaceKnowledge: v })}
            />
          </div>

          <div
            className="rounded-[8px] px-3 py-2 text-[11.5px] space-y-0.5"
            style={{ border: '1px dashed hsl(var(--sv-hairline))', color: 'hsl(var(--sv-muted))' }}
          >
            <div style={{ color: 'hsl(var(--sv-ink) / 0.85)' }} className="font-medium">Coming next</div>
            <div>Pin specific library resources, prompt templates, and uploaded files to this pill.</div>
          </div>
        </section>

        {/* OPTIONAL STRUCTURED INPUTS */}
        <details className="rounded-[8px]" style={{ border: '1px dashed hsl(var(--sv-hairline))' }}>
          <summary
            className="cursor-pointer px-3 py-2 text-[12px] font-medium"
            style={{ color: 'hsl(var(--sv-ink) / 0.85)' }}
          >
            Advanced: structured inputs ({pill.fields.length})
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2">
            <p className={helpText} style={{ color: 'hsl(var(--sv-muted))' }}>
              Most pills don't need this — use <code>[Brackets]</code> in the prompt template instead.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={addField}
                className="text-[11.5px] inline-flex items-center gap-1 px-2 py-1 rounded-[6px] sv-hover-bg"
                style={{ color: 'hsl(var(--sv-clay))' }}
              >
                <Plus className="h-3 w-3" /> Add field
              </button>
            </div>
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
                          style={selectStyle}
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
        </details>

        {/* VISIBILITY & ORDER */}
        <section className="space-y-3">
          <div className={sectionLabel} style={{ color: 'hsl(var(--sv-muted))' }}>Visibility & order</div>

          <div
            className="flex items-center justify-between rounded-[8px] px-3 py-2"
            style={{ border: '1px solid hsl(var(--sv-hairline))' }}
          >
            <div className="min-w-0 pr-3 flex items-center gap-2">
              {pill.isActive === false
                ? <EyeOff className="h-3.5 w-3.5" style={{ color: 'hsl(var(--sv-muted))' }} />
                : <Eye    className="h-3.5 w-3.5" style={{ color: 'hsl(var(--sv-clay))' }} />}
              <div>
                <Label htmlFor="pill-active" className={fieldLabel + ' block'} style={{ color: 'hsl(var(--sv-ink))' }}>
                  Visible in {currentSurfaceLabel}
                </Label>
                <p className={helpText} style={{ color: 'hsl(var(--sv-muted))' }}>
                  Hide a pill from the sidebar without deleting it.
                </p>
              </div>
            </div>
            <Switch
              id="pill-active"
              checked={pill.isActive !== false}
              onCheckedChange={(v) => setPill((p) => ({ ...p, isActive: v }))}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => moveOrder('up')}
              disabled={!isEdit}
              className="h-8 text-[12px] gap-1"
            >
              <ArrowUp className="h-3.5 w-3.5" /> Move up
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => moveOrder('down')}
              disabled={!isEdit}
              className="h-8 text-[12px] gap-1"
            >
              <ArrowDown className="h-3.5 w-3.5" /> Move down
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDuplicate}
              disabled={!isEdit}
              className="h-8 text-[12px] gap-1 ml-auto"
            >
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </Button>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div
        className="mt-6 pt-4 flex items-center gap-2 justify-between"
        style={{ borderTop: '1px solid hsl(var(--sv-hairline))' }}
      >
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
          <Button variant="ghost" size="sm" onClick={onCancel} className="h-9 text-[12.5px]">
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
    </div>
  );
}

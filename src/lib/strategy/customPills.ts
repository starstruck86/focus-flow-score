/**
 * Custom Pills — programmable shortcuts (lightweight custom GPTs).
 *
 * Each pill is a user-defined workflow with:
 *   - name      (label shown in the surface)
 *   - instruction (how Strategy should think — prepended to the compiled prompt)
 *   - fields    (lightweight inputs, same schema as built-in workflows)
 *   - surface   (which surface the pill belongs to)
 *
 * Stored client-side in localStorage. No backend, no schema changes.
 * The pill is converted to a WorkflowDef at runtime and runs through the
 * same compileWorkflowPrompt → send pipeline as built-in pills.
 */
import type {
  WorkflowDef,
  WorkflowField,
  WorkflowFamily,
  PillOutputType,
  PillRunMode,
} from '@/components/strategy/v2/workflows/workflowRegistry';
import type { StrategySurfaceKey } from '@/components/strategy/v2/StrategyNavSidebar';

const STORAGE_KEY = 'sv-custom-pills-v1';

export interface CustomPill {
  id: string;
  surface: StrategySurfaceKey;
  name: string;
  description: string;
  /** Hidden "system" instruction — prepended at run time. */
  instruction: string;
  /** Inputs the prompt template can reference via {{Label}} tokens. */
  fields: WorkflowField[];
  /** Optional template — if blank, we auto-build from fields. */
  promptTemplate?: string;
  /** Default output shape (chat by default). */
  outputType?: PillOutputType;
  /** Insert into composer (default) or send immediately. */
  runMode?: PillRunMode;
  /** Ask clarifying questions before generating. */
  askClarifying?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------- IO ----------

function safeRead(): CustomPill[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomPill[]) : [];
  } catch {
    return [];
  }
}

function safeWrite(pills: CustomPill[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pills));
  } catch {
    /* quota / privacy — silently ignore */
  }
}

// ---------- CRUD ----------

export function listCustomPills(): CustomPill[] {
  return safeRead();
}

export function listCustomPillsForSurface(surface: StrategySurfaceKey): CustomPill[] {
  return safeRead().filter((p) => p.surface === surface);
}

export function upsertCustomPill(pill: CustomPill): CustomPill[] {
  const all = safeRead();
  const idx = all.findIndex((p) => p.id === pill.id);
  const next = idx >= 0
    ? all.map((p, i) => i === idx ? pill : p)
    : [...all, pill];
  safeWrite(next);
  return next;
}

export function deleteCustomPill(id: string): CustomPill[] {
  const next = safeRead().filter((p) => p.id !== id);
  safeWrite(next);
  return next;
}

export function reorderCustomPills(surface: StrategySurfaceKey, orderedIds: string[]): CustomPill[] {
  const all = safeRead();
  const surfaceMap = new Map(all.filter((p) => p.surface === surface).map((p) => [p.id, p]));
  const others = all.filter((p) => p.surface !== surface);
  const reordered = orderedIds
    .map((id) => surfaceMap.get(id))
    .filter((p): p is CustomPill => !!p);
  const next = [...others, ...reordered];
  safeWrite(next);
  return next;
}

// ---------- Adapters ----------

/** Family the surface belongs to in the registry vocabulary. */
function familyForSurface(surface: StrategySurfaceKey): WorkflowFamily {
  if (surface === 'library') return 'library';
  if (surface === 'artifacts') return 'artifact';
  return 'mode';
}

/**
 * Convert a CustomPill to a WorkflowDef so it can run through the same
 * launcher / form / compile / send pipeline as built-in pills.
 */
export function customPillToWorkflowDef(pill: CustomPill): WorkflowDef {
  // Auto-build a minimal template if user didn't provide one.
  const template = pill.promptTemplate?.trim().length
    ? pill.promptTemplate
    : pill.fields.length
      ? pill.fields.map((f) => `${f.label}: {{${f.label}}}`).join('\n')
      : '';

  return {
    id: `custom.${pill.id}`,
    family: familyForSurface(pill.surface),
    groupId: pill.surface,
    label: pill.name,
    description: pill.description,
    formTitle: pill.name,
    fields: pill.fields,
    promptTemplate: template,
    instruction: pill.instruction,
    isCustom: true,
    customPillId: pill.id,
  };
}

export function newPillId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `pill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyPillForSurface(surface: StrategySurfaceKey): CustomPill {
  const now = new Date().toISOString();
  return {
    id: newPillId(),
    surface,
    name: '',
    description: '',
    instruction: '',
    fields: [
      { key: 'input', label: 'Input', kind: 'textarea', rows: 4, required: true },
    ],
    promptTemplate: '',
    createdAt: now,
    updatedAt: now,
  };
}

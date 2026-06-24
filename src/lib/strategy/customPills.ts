/**
 * Custom Pills — programmable shortcuts (lightweight custom GPTs).
 *
 * Persisted to Supabase (`strategy_custom_pills`) scoped to user_id.
 * Pure helpers (`customPillToWorkflowDef`, `emptyPillForSurface`, `sortPills`,
 * `newPillId`) remain synchronous. CRUD is async.
 *
 * A one-time migration (`migrateLocalPillsToSupabase`) lifts any legacy
 * localStorage pills (key `sv-custom-pills-v1`) into Supabase. The localStorage
 * payload is preserved as a backup; a flag (`sv-custom-pills-migrated-v1`)
 * prevents repeated runs.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  WorkflowDef,
  WorkflowField,
  WorkflowFamily,
  PillOutputType,
  PillRunMode,
} from '@/components/strategy/v2/workflows/workflowRegistry';
import type { StrategySurfaceKey } from '@/components/strategy/v2/StrategyNavSidebar';

const LEGACY_STORAGE_KEY = 'sv-custom-pills-v1';
const MIGRATED_FLAG_KEY = 'sv-custom-pills-migrated-v1';
const TABLE = 'strategy_custom_pills';

export interface CustomPill {
  id: string;
  surface: StrategySurfaceKey;
  name: string;
  description: string;
  instruction: string;
  fields: WorkflowField[];
  promptTemplate?: string;
  outputType?: PillOutputType;
  runMode?: PillRunMode;
  askClarifying?: boolean;
  isActive?: boolean;
  orderIndex?: number;
  attachments?: {
    resourceIds?: string[];
    templateIds?: string[];
    fileIds?: string[];
    contextTokens?: string[];
    useAllWorkspaceKnowledge?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

// ---------- Row <-> Pill mapping ----------

interface PillRow {
  id: string;
  user_id: string;
  surface: string;
  name: string;
  description: string | null;
  instruction: string | null;
  fields: unknown;
  prompt_template: string | null;
  output_type: string | null;
  run_mode: string | null;
  ask_clarifying: boolean | null;
  is_active: boolean | null;
  order_index: number | string | null;
  attachments: unknown;
  created_at: string;
  updated_at: string;
}

function rowToPill(row: PillRow): CustomPill {
  const fields = Array.isArray(row.fields) ? (row.fields as WorkflowField[]) : [];
  const attachments = (row.attachments && typeof row.attachments === 'object' && !Array.isArray(row.attachments))
    ? (row.attachments as CustomPill['attachments'])
    : {};
  return {
    id: row.id,
    surface: row.surface as StrategySurfaceKey,
    name: row.name,
    description: row.description ?? '',
    instruction: row.instruction ?? '',
    fields,
    promptTemplate: row.prompt_template ?? '',
    outputType: (row.output_type as PillOutputType) ?? 'chat',
    runMode: (row.run_mode as PillRunMode) ?? 'insert',
    askClarifying: !!row.ask_clarifying,
    isActive: row.is_active !== false,
    orderIndex: row.order_index == null ? undefined : Number(row.order_index),
    attachments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pillToRow(userId: string, pill: CustomPill): Record<string, unknown> {
  return {
    id: pill.id,
    user_id: userId,
    surface: pill.surface,
    name: pill.name,
    description: pill.description ?? '',
    instruction: pill.instruction ?? '',
    fields: pill.fields ?? [],
    prompt_template: pill.promptTemplate ?? '',
    output_type: pill.outputType ?? 'chat',
    run_mode: pill.runMode ?? 'insert',
    ask_clarifying: !!pill.askClarifying,
    is_active: pill.isActive !== false,
    order_index: pill.orderIndex ?? null,
    attachments: pill.attachments ?? {},
    created_at: pill.createdAt,
    updated_at: pill.updatedAt,
  };
}

// ---------- CRUD (async) ----------

export async function listCustomPills(userId: string): Promise<CustomPill[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId);
  if (error) {
    console.warn('[customPills] listCustomPills failed', error);
    return [];
  }
  return sortPills((data ?? []).map((r) => rowToPill(r as PillRow)));
}

export async function listCustomPillsForSurface(
  userId: string,
  surface: StrategySurfaceKey,
  opts: { includeHidden?: boolean } = {},
): Promise<CustomPill[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('surface', surface);
  if (error) {
    console.warn('[customPills] listCustomPillsForSurface failed', error);
    return [];
  }
  const pills = (data ?? []).map((r) => rowToPill(r as PillRow));
  const visible = opts.includeHidden ? pills : pills.filter((p) => p.isActive !== false);
  return sortPills(visible);
}

export async function upsertCustomPill(userId: string, pill: CustomPill): Promise<void> {
  if (!userId) throw new Error('upsertCustomPill: userId required');
  const row = pillToRow(userId, pill) as never;
  const { error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'id' });
  if (error) {
    console.error('[customPills] upsert failed', error);
    throw error;
  }
}

export async function deleteCustomPill(userId: string, id: string): Promise<void> {
  if (!userId) throw new Error('deleteCustomPill: userId required');
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  if (error) {
    console.error('[customPills] delete failed', error);
    throw error;
  }
}

export async function reorderCustomPills(
  userId: string,
  surface: StrategySurfaceKey,
  orderedIds: string[],
): Promise<void> {
  if (!userId) throw new Error('reorderCustomPills: userId required');
  // Assign ascending order_index by position in the array.
  const updates = orderedIds.map((id, idx) =>
    supabase
      .from(TABLE)
      .update({ order_index: idx, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('surface', surface)
      .eq('id', id),
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error('[customPills] reorder failed', failed.error);
    throw failed.error;
  }
}

export async function duplicateCustomPill(
  userId: string,
  pillId: string,
): Promise<CustomPill | null> {
  if (!userId) throw new Error('duplicateCustomPill: userId required');
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('id', pillId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn('[customPills] duplicate fetch failed', error);
    return null;
  }
  const src = rowToPill(data as PillRow);
  const now = new Date().toISOString();
  const copy: CustomPill = {
    ...src,
    id: newPillId(),
    name: `${src.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  await upsertCustomPill(userId, copy);
  return copy;
}

// ---------- One-time localStorage → Supabase migration ----------

export async function migrateLocalPillsToSupabase(userId: string): Promise<number> {
  if (!userId || typeof window === 'undefined') return 0;
  try {
    if (localStorage.getItem(MIGRATED_FLAG_KEY) === '1') return 0;
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(MIGRATED_FLAG_KEY, '1');
      return 0;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.setItem(MIGRATED_FLAG_KEY, '1');
      return 0;
    }
    let migrated = 0;
    for (const pill of parsed as CustomPill[]) {
      try {
        await upsertCustomPill(userId, pill);
        migrated += 1;
      } catch (e) {
        console.warn('[customPills] migrate single pill failed', e);
      }
    }
    localStorage.setItem(MIGRATED_FLAG_KEY, '1');
    return migrated;
  } catch (e) {
    console.warn('[customPills] migrateLocalPillsToSupabase failed', e);
    return 0;
  }
}

// ---------- Pure helpers (unchanged) ----------

function familyForSurface(surface: StrategySurfaceKey): WorkflowFamily {
  if (surface === 'library') return 'library';
  if (surface === 'artifacts') return 'artifact';
  return 'mode';
}

export function customPillToWorkflowDef(pill: CustomPill): WorkflowDef {
  const template = pill.promptTemplate?.trim().length
    ? pill.promptTemplate!
    : pill.fields.length
      ? pill.fields.map((f) => `${f.label}: {{${f.label}}}`).join('\n')
      : pill.name || 'Help me with the following:';

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
    outputType: pill.outputType,
    runMode: pill.runMode ?? 'insert',
    askClarifying: pill.askClarifying,
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
    fields: [],
    promptTemplate: '',
    outputType: 'chat',
    runMode: 'insert',
    askClarifying: false,
    isActive: true,
    orderIndex: Date.now(),
    attachments: {
      resourceIds: [],
      templateIds: [],
      fileIds: [],
      contextTokens: [],
      useAllWorkspaceKnowledge: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function sortPills(pills: CustomPill[]): CustomPill[] {
  return [...pills].sort((a, b) => {
    const ai = a.orderIndex ?? Number.MAX_SAFE_INTEGER;
    const bi = b.orderIndex ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  });
}

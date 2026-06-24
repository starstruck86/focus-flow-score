/**
 * Account Family Projects — Supabase-backed grouping of accounts by
 * `account_family`. A "Project" is just a distinct family value; per-user
 * settings (custom instructions, pinned, ordering) live in
 * `account_project_settings`.
 *
 * Membership is resolved via `accounts.account_family` (authoritative).
 * `parent_account_id` is used for display-only tree rendering inside the
 * project view.
 *
 * Soft-delete: always read from `active_accounts` so deleted_at rows
 * cannot leak into a project.
 */
import { supabase } from '@/integrations/supabase/client';

export const UNCATEGORIZED_FAMILY = '__uncategorized__';
export const UNCATEGORIZED_LABEL = 'Uncategorized';

export interface ProjectMemberAccount {
  id: string;
  name: string;
  tier: string | null;
  parent_account_id: string | null;
  account_family: string | null;
}

export interface ProjectSummary {
  /** Family key — actual `account_family` value, or UNCATEGORIZED_FAMILY. */
  familyKey: string;
  /** Display label. */
  label: string;
  /** Member accounts (already soft-delete filtered). */
  members: ProjectMemberAccount[];
  /** Root accounts (no parent_account_id) — primary display anchor. */
  roots: ProjectMemberAccount[];
}

export interface ProjectSettings {
  id?: string;
  user_id: string;
  account_family: string;
  custom_instructions: string;
  pinned: boolean;
  order_index: number | null;
  created_at?: string;
  updated_at?: string;
}

/** Fetch all active accounts for the user and group by family.
 *  Uses `accounts` directly with `deleted_at IS NULL` because the
 *  `active_accounts` view does not expose `parent_account_id` /
 *  `account_family`. */
export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('id,name,tier,parent_account_id,account_family')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as ProjectMemberAccount[];
  const byFamily = new Map<string, ProjectMemberAccount[]>();
  for (const r of rows) {
    const key = (r.account_family && r.account_family.trim()) || UNCATEGORIZED_FAMILY;
    const list = byFamily.get(key) ?? [];
    list.push(r);
    byFamily.set(key, list);
  }

  const projects: ProjectSummary[] = [];
  for (const [familyKey, members] of byFamily.entries()) {
    const roots = members.filter((m) => !m.parent_account_id);
    projects.push({
      familyKey,
      label: familyKey === UNCATEGORIZED_FAMILY ? UNCATEGORIZED_LABEL : familyKey,
      members,
      roots: roots.length > 0 ? roots : members, // standalone accts are their own roots
    });
  }

  // Sort: real families first (alpha), uncategorized last.
  projects.sort((a, b) => {
    if (a.familyKey === UNCATEGORIZED_FAMILY) return 1;
    if (b.familyKey === UNCATEGORIZED_FAMILY) return -1;
    return a.label.localeCompare(b.label);
  });

  return projects;
}

/** Members of a given family (active accounts only). */
export async function getProjectMembers(
  userId: string,
  familyKey: string,
): Promise<ProjectMemberAccount[]> {
  const all = await listProjects(userId);
  const p = all.find((x) => x.familyKey === familyKey);
  return p ? p.members : [];
}

/** Settings for a single project (or null if none persisted yet). */
export async function getProjectSettings(
  userId: string,
  familyKey: string,
): Promise<ProjectSettings | null> {
  const { data, error } = await supabase
    .from('account_project_settings')
    .select('*')
    .eq('user_id', userId)
    .eq('account_family', familyKey)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectSettings | null) ?? null;
}

/** Signal counts grouped by linked_account_id — used by the index. */
export async function listSignalCountsByAccount(
  userId: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('account_signals')
    .select('linked_account_id')
    .eq('user_id', userId);
  if (error) throw error;
  const map = new Map<string, number>();
  for (const row of (data ?? []) as { linked_account_id: string | null }[]) {
    if (!row.linked_account_id) continue;
    map.set(row.linked_account_id, (map.get(row.linked_account_id) ?? 0) + 1);
  }
  return map;
}

/** Fetch settings rows for the user; map keyed by family. */
export async function listProjectSettings(
  userId: string,
): Promise<Map<string, ProjectSettings>> {
  const { data, error } = await supabase
    .from('account_project_settings')
    .select('*')
    .eq('user_id', userId);

  if (error) throw error;
  const map = new Map<string, ProjectSettings>();
  for (const row of (data ?? []) as ProjectSettings[]) {
    map.set(row.account_family, row);
  }
  return map;
}

export async function upsertProjectSettings(
  userId: string,
  family: string,
  patch: Partial<Pick<ProjectSettings, 'custom_instructions' | 'pinned' | 'order_index'>>,
): Promise<ProjectSettings> {
  const { data, error } = await supabase
    .from('account_project_settings')
    .upsert(
      {
        user_id: userId,
        account_family: family,
        custom_instructions: patch.custom_instructions ?? '',
        pinned: patch.pinned ?? false,
        order_index: patch.order_index ?? null,
      },
      { onConflict: 'user_id,account_family' },
    )
    .select()
    .single();

  if (error) throw error;
  return data as ProjectSettings;
}

export interface ProjectSignal {
  id: string;
  raw_text: string;
  signal_type: string | null;
  source_label: string | null;
  source_url: string | null;
  linked_account_id: string | null;
  linked_account_name: string | null;
  created_at: string;
}

export async function listProjectSignals(
  userId: string,
  accountIds: string[],
  limit = 10,
): Promise<ProjectSignal[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await supabase
    .from('account_signals')
    .select('id,raw_text,signal_type,source_label,source_url,linked_account_id,linked_account_name,created_at')
    .eq('user_id', userId)
    .in('linked_account_id', accountIds)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as ProjectSignal[];
}

export interface ProjectMemory {
  id: string;
  account_id: string;
  memory_type: string | null;
  content: string;
  confidence: number | null;
  is_pinned: boolean | null;
  updated_at: string;
}

export async function listProjectMemory(
  userId: string,
  accountIds: string[],
  limit = 20,
): Promise<ProjectMemory[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await supabase
    .from('account_strategy_memory')
    .select('id,account_id,memory_type,content,confidence,is_pinned,updated_at')
    .eq('user_id', userId)
    .in('account_id', accountIds)
    .eq('is_irrelevant', false)
    .order('is_pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as ProjectMemory[];
}

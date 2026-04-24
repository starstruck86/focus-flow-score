/**
 * Workspace Registry — user-configurable Strategy workspaces.
 *
 * Built-in workspaces ship by default, but users can also add custom
 * workspaces and reorder the launcher/sidebar so Strategy behaves more like a
 * configurable operating system than a fixed chat shell.
 */

export type CoreStrategySurfaceKey =
  | 'brainstorm'
  | 'deep_research'
  | 'refine'
  | 'library'
  | 'artifacts'
  | 'projects'
  | 'work';

export type StrategySurfaceKey = CoreStrategySurfaceKey | `custom:${string}`;

export interface StrategyWorkspaceDef {
  id: StrategySurfaceKey;
  label: string;
  description: string;
  tag?: string;
  kind: 'core' | 'custom';
  orderIndex: number;
}

const STORAGE_KEY = 'sv-workspaces-v1';

const CORE_WORKSPACES: StrategyWorkspaceDef[] = [
  {
    id: 'brainstorm',
    label: 'Brainstorm',
    description: 'Spin up angles, hooks, and points of view fast — quantity over polish.',
    tag: 'Generative',
    kind: 'core',
    orderIndex: 0,
  },
  {
    id: 'deep_research',
    label: 'Deep Research',
    description: 'Investigate companies, competitors, and markets with structured rigor.',
    tag: 'Analytical',
    kind: 'core',
    orderIndex: 1,
  },
  {
    id: 'refine',
    label: 'Refine',
    description: 'Tighten, sharpen, and elevate something you have already drafted.',
    tag: 'Editorial',
    kind: 'core',
    orderIndex: 2,
  },
  {
    id: 'library',
    label: 'Library',
    description: 'Create from your knowledge.',
    kind: 'core',
    orderIndex: 3,
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    description: 'Reusable document templates.',
    kind: 'core',
    orderIndex: 4,
  },
  {
    id: 'projects',
    label: 'Projects',
    description: 'Promoted long-term work.',
    kind: 'core',
    orderIndex: 5,
  },
  {
    id: 'work',
    label: 'Work',
    description: 'All your recent threads.',
    kind: 'core',
    orderIndex: 6,
  },
];

function sortWorkspaces(workspaces: StrategyWorkspaceDef[]): StrategyWorkspaceDef[] {
  return [...workspaces].sort((a, b) => {
    if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
    return a.label.localeCompare(b.label);
  });
}

function safeRead(): StrategyWorkspaceDef[] {
  if (typeof window === 'undefined') return CORE_WORKSPACES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return CORE_WORKSPACES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return CORE_WORKSPACES;
    return parsed as StrategyWorkspaceDef[];
  } catch {
    return CORE_WORKSPACES;
  }
}

function safeWrite(workspaces: StrategyWorkspaceDef[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sortWorkspaces(workspaces)));
  } catch {
    /* ignore quota/privacy failures */
  }
}

function mergeWithCore(workspaces: StrategyWorkspaceDef[]): StrategyWorkspaceDef[] {
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const merged = CORE_WORKSPACES.map((core) => ({
    ...core,
    ...(byId.get(core.id) ?? {}),
    kind: 'core' as const,
  }));
  const custom = workspaces.filter((w) => !isCoreWorkspace(w.id));
  return sortWorkspaces([...merged, ...custom]);
}

export function listStrategyWorkspaces(): StrategyWorkspaceDef[] {
  const merged = mergeWithCore(safeRead());
  safeWrite(merged);
  return merged;
}

export function getWorkspaceDef(id: StrategySurfaceKey | null | undefined): StrategyWorkspaceDef | null {
  if (!id) return null;
  return listStrategyWorkspaces().find((w) => w.id === id) ?? null;
}

export function getWorkspaceLabel(id: StrategySurfaceKey | null | undefined): string {
  return getWorkspaceDef(id)?.label ?? 'Workspace';
}

export function getWorkspaceDescription(id: StrategySurfaceKey | null | undefined): string {
  return getWorkspaceDef(id)?.description ?? 'Custom Strategy workspace.';
}

export function getWorkspaceTag(id: StrategySurfaceKey | null | undefined): string | undefined {
  return getWorkspaceDef(id)?.tag;
}

export function isCoreWorkspace(id: StrategySurfaceKey): id is CoreStrategySurfaceKey {
  return CORE_WORKSPACES.some((w) => w.id === id);
}

export function createCustomWorkspace(seed?: Partial<StrategyWorkspaceDef>): StrategyWorkspaceDef {
  const now = Date.now();
  const workspace: StrategyWorkspaceDef = {
    id: `custom:${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: seed?.label ?? 'New workspace',
    description: seed?.description ?? 'A custom Strategy workspace.',
    tag: seed?.tag,
    kind: 'custom',
    orderIndex: seed?.orderIndex ?? listStrategyWorkspaces().length,
  };
  upsertStrategyWorkspace(workspace);
  return workspace;
}

export function upsertStrategyWorkspace(workspace: StrategyWorkspaceDef): StrategyWorkspaceDef[] {
  const current = listStrategyWorkspaces();
  const index = current.findIndex((w) => w.id === workspace.id);
  const next = index >= 0
    ? current.map((w, i) => (i === index ? workspace : w))
    : [...current, workspace];
  safeWrite(next);
  return sortWorkspaces(next);
}

export function deleteStrategyWorkspace(id: StrategySurfaceKey): StrategyWorkspaceDef[] {
  if (isCoreWorkspace(id)) return listStrategyWorkspaces();
  const next = listStrategyWorkspaces().filter((w) => w.id !== id);
  safeWrite(next);
  return sortWorkspaces(next);
}

export function reorderStrategyWorkspaces(ids: StrategySurfaceKey[]): StrategyWorkspaceDef[] {
  const current = listStrategyWorkspaces();
  const byId = new Map(current.map((w) => [w.id, w]));
  const next = ids
    .map((id, index) => {
      const workspace = byId.get(id);
      return workspace ? { ...workspace, orderIndex: index } : null;
    })
    .filter((w): w is StrategyWorkspaceDef => !!w);
  safeWrite(next);
  return sortWorkspaces(next);
}
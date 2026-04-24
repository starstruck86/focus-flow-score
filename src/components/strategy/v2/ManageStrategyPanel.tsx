/**
 * ManageStrategyPanel — Strategy Settings (page-embedded).
 *
 * Renders the workspace + pill inventory inline, NOT inside a Sheet/modal.
 * Used by the dedicated `/strategy/settings` route. The previous
 * `ManageStrategySheet` is a thin wrapper that mounts this panel inside a
 * Sheet for backward compatibility, but the primary surface is the page.
 *
 * Behavior:
 *   • Lists every workspace (Brainstorm, Deep Research, Refine, Library,
 *     Artifacts, Projects — plus any custom workspaces).
 *   • Per workspace, shows every pill the user has created with quick
 *     actions: edit, duplicate, delete, hide/show, reorder.
 *   • Top-level button to add a new pill in any workspace.
 *   • Top-level area to add a custom workspace (built on workspaceRegistry).
 *
 * The actual edit form lives in the Pill editor — this panel only inventories
 * pills and routes the user to that editor. We never re-implement field/prompt
 * editing here so there is exactly one source of truth for pill shape.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Plus, Pencil, Copy, Trash2, EyeOff, Eye, ArrowUp, ArrowDown,
  Lightbulb, Microscope, Wand2, BookOpen, FileText, FolderKanban, Briefcase,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  listCustomPillsForSurface,
  deleteCustomPill,
  duplicateCustomPill,
  upsertCustomPill,
  reorderCustomPills,
  type CustomPill,
} from '@/lib/strategy/customPills';
import {
  listStrategyWorkspaces,
  createCustomWorkspace,
  deleteStrategyWorkspace,
  upsertStrategyWorkspace,
  isCoreWorkspace,
  type StrategyWorkspaceDef,
} from '@/lib/strategy/workspaceRegistry';
import type { StrategySurfaceKey } from './StrategyNavSidebar';

const ICON_BY_SURFACE: Partial<Record<string, React.ComponentType<{ className?: string }>>> = {
  brainstorm: Lightbulb,
  deep_research: Microscope,
  refine: Wand2,
  library: BookOpen,
  artifacts: FileText,
  projects: FolderKanban,
  work: Briefcase,
};

// Workspaces a pill can actually live in (Work / Projects don't host pills).
const PILL_HOSTING_WORKSPACES: StrategySurfaceKey[] = [
  'brainstorm', 'deep_research', 'refine', 'library', 'artifacts',
];

interface Props {
  /** Open the pill editor for an existing pill. */
  onEditPill: (pill: CustomPill) => void;
  /** Open the pill editor for a new pill in the given workspace. */
  onAddPill: (surface: StrategySurfaceKey) => void;
  /** Bumped after add/edit/delete — used to refresh the panel. */
  pillsVersion?: number;
}

export function ManageStrategyPanel({ onEditPill, onAddPill, pillsVersion = 0 }: Props) {
  const [refresh, setRefresh] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => { setRefresh((r) => r + 1); }, [pillsVersion]);

  const workspaces = useMemo<StrategyWorkspaceDef[]>(
    () => listStrategyWorkspaces(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refresh],
  );

  const pillsByWorkspace = useMemo<Record<string, CustomPill[]>>(() => {
    const map: Record<string, CustomPill[]> = {};
    for (const ws of workspaces) {
      map[ws.id] = listCustomPillsForSurface(ws.id as StrategySurfaceKey, { includeHidden: true });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, refresh]);

  const bump = () => setRefresh((r) => r + 1);

  const handleDeletePill = (pill: CustomPill) => {
    if (!confirm(`Delete pill "${pill.name}"? This cannot be undone.`)) return;
    deleteCustomPill(pill.id);
    toast.success('Pill deleted');
    bump();
  };

  const handleDuplicate = (pill: CustomPill) => {
    const copy = duplicateCustomPill(pill.id);
    if (copy) {
      toast.success('Pill duplicated', { description: `${copy.name} created.` });
      bump();
    }
  };

  const handleToggleVisible = (pill: CustomPill) => {
    upsertCustomPill({ ...pill, isActive: pill.isActive === false ? true : false, updatedAt: new Date().toISOString() });
    bump();
  };

  const handleMove = (pill: CustomPill, direction: 'up' | 'down') => {
    const ids = pillsByWorkspace[pill.surface]?.map((p) => p.id) ?? [];
    const idx = ids.indexOf(pill.id);
    if (idx < 0) return;
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ids.length) return;
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    reorderCustomPills(pill.surface, ids);
    bump();
  };

  const handleAddWorkspace = () => {
    const ws = createCustomWorkspace({ label: 'New workspace', description: 'A custom Strategy workspace.' });
    toast.success('Workspace added', { description: `${ws.label} is now in the sidebar.` });
    bump();
  };

  const startRename = (ws: StrategyWorkspaceDef) => {
    setRenamingId(ws.id);
    setRenameValue(ws.label);
  };

  const commitRename = (ws: StrategyWorkspaceDef) => {
    const next = renameValue.trim();
    if (next.length === 0) { setRenamingId(null); return; }
    upsertStrategyWorkspace({ ...ws, label: next });
    setRenamingId(null);
    bump();
  };

  const handleDeleteWorkspace = (ws: StrategyWorkspaceDef) => {
    if (isCoreWorkspace(ws.id)) {
      toast.error('Built-in workspaces cannot be deleted.');
      return;
    }
    if (!confirm(`Delete workspace "${ws.label}"? Pills inside will be hidden but kept.`)) return;
    deleteStrategyWorkspace(ws.id);
    toast.success('Workspace deleted');
    bump();
  };

  return (
    <div className="space-y-5" data-testid="manage-strategy-panel">
      {/* Add workspace + add pill quick actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleAddWorkspace}
          className="h-8 gap-1.5 text-[12px]"
          data-testid="manage-add-workspace"
        >
          <Plus className="h-3.5 w-3.5" />
          New workspace
        </Button>
        <span className="text-[11px]" style={{ color: 'hsl(var(--sv-muted))' }}>
          Workspaces are launchers for sets of related pills.
        </span>
      </div>

      {workspaces.map((ws) => {
        const pills = pillsByWorkspace[ws.id] ?? [];
        const Icon = ICON_BY_SURFACE[ws.id] ?? Sparkles;
        const canHostPills = PILL_HOSTING_WORKSPACES.includes(ws.id as StrategySurfaceKey)
          || !isCoreWorkspace(ws.id as StrategySurfaceKey);
        const isCore = isCoreWorkspace(ws.id as StrategySurfaceKey);
        const isRenaming = renamingId === ws.id;
        return (
          <section
            key={ws.id}
            className="rounded-[10px] p-3.5 space-y-3"
            style={{
              border: '1px solid hsl(var(--sv-hairline))',
              background: 'hsl(var(--sv-paper))',
            }}
            data-testid={`manage-workspace-${ws.id}`}
          >
            <header className="flex items-start gap-3">
              <div
                className="h-7 w-7 rounded-[6px] flex items-center justify-center shrink-0"
                style={{ background: 'hsl(var(--sv-clay) / 0.10)', color: 'hsl(var(--sv-clay))' }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                {isRenaming ? (
                  <Input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(ws)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(ws);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    className="h-7 text-[13px]"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => !isCore && startRename(ws)}
                    className="text-[13.5px] font-semibold text-left"
                    style={{ color: 'hsl(var(--sv-ink))', cursor: isCore ? 'default' : 'text' }}
                    title={isCore ? 'Built-in workspace' : 'Click to rename'}
                  >
                    {ws.label}
                  </button>
                )}
                <p className="text-[11.5px] mt-0.5 truncate" style={{ color: 'hsl(var(--sv-muted))' }}>
                  {ws.description}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {canHostPills && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onAddPill(ws.id as StrategySurfaceKey)}
                    className="h-7 gap-1 text-[11.5px]"
                    data-testid={`manage-add-pill-${ws.id}`}
                  >
                    <Plus className="h-3 w-3" />
                    Add pill
                  </Button>
                )}
                {!isCore && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteWorkspace(ws)}
                    className="h-7 w-7 p-0"
                    title="Delete workspace"
                    data-testid={`manage-delete-workspace-${ws.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" style={{ color: 'hsl(var(--sv-clay))' }} />
                  </Button>
                )}
              </div>
            </header>

            {/* Pills list */}
            {!canHostPills ? (
              <p className="text-[11.5px]" style={{ color: 'hsl(var(--sv-muted) / 0.85)' }}>
                {ws.id === 'work' ? 'Work is the command center — it lists every thread.' : 'No pills hosted here.'}
              </p>
            ) : pills.length === 0 ? (
              <div
                className="rounded-[8px] px-3 py-2.5 text-[11.5px]"
                style={{
                  border: '1px dashed hsl(var(--sv-hairline))',
                  background: 'hsl(var(--sv-hover) / 0.3)',
                  color: 'hsl(var(--sv-muted))',
                }}
              >
                No pills yet — click <span style={{ color: 'hsl(var(--sv-clay))' }}>Add pill</span> to create one.
              </div>
            ) : (
              <ul className="space-y-1.5" data-testid={`manage-pills-${ws.id}`}>
                {pills.map((p, idx) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5"
                    style={{
                      border: '1px solid hsl(var(--sv-hairline))',
                      background: p.isActive === false ? 'hsl(var(--sv-hover) / 0.4)' : 'hsl(var(--sv-paper))',
                      opacity: p.isActive === false ? 0.6 : 1,
                    }}
                    data-testid={`manage-pill-${p.id}`}
                  >
                    <Sparkles className="h-3 w-3 shrink-0" style={{ color: 'hsl(var(--sv-clay))' }} />
                    <button
                      type="button"
                      onClick={() => onEditPill(p)}
                      className="flex-1 min-w-0 text-left"
                      title={p.description || p.instruction || 'Edit pill'}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-medium truncate" style={{ color: 'hsl(var(--sv-ink))' }}>
                          {p.name || 'Untitled pill'}
                        </span>
                        {p.outputType && p.outputType !== 'chat' && (
                          <span
                            className="text-[10px] px-1.5 py-px rounded shrink-0"
                            style={{ background: 'hsl(var(--sv-hover))', color: 'hsl(var(--sv-muted))' }}
                          >
                            {p.outputType}
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <p className="text-[11px] truncate mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
                          {p.description}
                        </p>
                      )}
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <IconBtn
                        label="Move up"
                        disabled={idx === 0}
                        onClick={() => handleMove(p, 'up')}
                        testId={`manage-move-up-${p.id}`}
                      ><ArrowUp className="h-3 w-3" /></IconBtn>
                      <IconBtn
                        label="Move down"
                        disabled={idx === pills.length - 1}
                        onClick={() => handleMove(p, 'down')}
                        testId={`manage-move-down-${p.id}`}
                      ><ArrowDown className="h-3 w-3" /></IconBtn>
                      <IconBtn
                        label={p.isActive === false ? 'Show pill' : 'Hide pill'}
                        onClick={() => handleToggleVisible(p)}
                        testId={`manage-toggle-${p.id}`}
                      >
                        {p.isActive === false
                          ? <EyeOff className="h-3 w-3" />
                          : <Eye    className="h-3 w-3" />}
                      </IconBtn>
                      <IconBtn
                        label="Edit pill"
                        onClick={() => onEditPill(p)}
                        testId={`manage-edit-${p.id}`}
                      ><Pencil className="h-3 w-3" /></IconBtn>
                      <IconBtn
                        label="Duplicate pill"
                        onClick={() => handleDuplicate(p)}
                        testId={`manage-duplicate-${p.id}`}
                      ><Copy className="h-3 w-3" /></IconBtn>
                      <IconBtn
                        label="Delete pill"
                        onClick={() => handleDeletePill(p)}
                        tone="clay"
                        testId={`manage-delete-${p.id}`}
                      ><Trash2 className="h-3 w-3" /></IconBtn>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function IconBtn({
  children, onClick, label, disabled, tone, testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  tone?: 'clay';
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-6 w-6 rounded-[5px] flex items-center justify-center sv-hover-bg disabled:opacity-30 disabled:pointer-events-none"
      style={{ color: tone === 'clay' ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-muted))' }}
      title={label}
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

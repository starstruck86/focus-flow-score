/**
 * resolveWorkspacePayload — Phase 7D-fix.
 *
 * Pure helper that turns the loose `(workspace, workspaceSource)` options
 * the caller passes into `useStrategyMessages.sendMessage` into the
 * exact triple that hits the wire:
 *
 *   • `workspaceSent`   — what we put on the wire as `workspace`.
 *                         null when no surface is active.
 *   • `workspaceSource` — provenance tag for the server log
 *                         ('selected' | 'thread-tag' | 'default' | 'none').
 *   • `sopResolverWorkspace` — what we feed to `buildStrategySopPayloads`,
 *                         which still needs a string ('work' = freeform).
 *
 * The previous implementation silently coerced a missing workspace to
 * `'work'` *on the wire* too, which made the server log report Work
 * surface for every freeform call — indistinguishable from a real Work
 * selection. This helper fixes that by separating wire truth from the
 * resolver input.
 */
export type WorkspaceSource = 'selected' | 'thread-tag' | 'default' | 'none';

export interface ResolveWorkspacePayloadInput {
  workspace?: string | null;
  workspaceSource?: WorkspaceSource;
}

export interface ResolveWorkspacePayloadResult {
  workspaceSent: string | null;
  workspaceSource: WorkspaceSource;
  sopResolverWorkspace: string;
}

export function resolveWorkspacePayload(
  options?: ResolveWorkspacePayloadInput,
): ResolveWorkspacePayloadResult {
  const explicit =
    typeof options?.workspace === 'string' && options.workspace.trim().length > 0
      ? options.workspace
      : null;
  const source: WorkspaceSource =
    options?.workspaceSource ?? (explicit ? 'selected' : 'none');
  return {
    workspaceSent: explicit,
    workspaceSource: source,
    sopResolverWorkspace: explicit ?? 'work',
  };
}

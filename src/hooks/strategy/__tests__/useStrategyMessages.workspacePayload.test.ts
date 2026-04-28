// @vitest-environment node
/**
 * Phase 7D-fix — Workspace payload truth tests.
 *
 * Validates the pure `resolveWorkspacePayload` helper that decides what
 * `useStrategyMessages.sendMessage` puts on the wire as `workspace` /
 * `workspaceSource`.
 *
 * Acceptance for the diagnostics fix:
 *   • Real surface (Brainstorm/Refine/Deep Research/etc.) is forwarded
 *     verbatim with workspaceSource = 'selected'.
 *   • No active surface → workspaceSent = null + workspaceSource = 'none'.
 *     The previous behavior silently coerced this to 'work' on the wire,
 *     which made freeform calls indistinguishable from the Work surface
 *     in the server logs.
 *   • The SOP resolver still receives the legacy 'work' string when no
 *     workspace is selected — that preserves freeform behavior (no
 *     workspace SOP applies). Wire truth and resolver input are now
 *     intentionally decoupled.
 *   • Caller may explicitly override workspaceSource (thread-tag, default).
 */
import { describe, it, expect } from 'vitest';
import { resolveWorkspacePayload } from '../resolveWorkspacePayload';

describe('resolveWorkspacePayload — workspace payload truth (Phase 7D-fix)', () => {
  it('Brainstorm surface → workspaceSent="brainstorm", source="selected"', () => {
    const r = resolveWorkspacePayload({ workspace: 'brainstorm', workspaceSource: 'selected' });
    expect(r.workspaceSent).toBe('brainstorm');
    expect(r.workspaceSource).toBe('selected');
    expect(r.sopResolverWorkspace).toBe('brainstorm');
  });

  it('Refine surface forwarded verbatim', () => {
    const r = resolveWorkspacePayload({ workspace: 'refine', workspaceSource: 'selected' });
    expect(r.workspaceSent).toBe('refine');
    expect(r.workspaceSource).toBe('selected');
  });

  it('Deep Research surface forwarded verbatim', () => {
    const r = resolveWorkspacePayload({ workspace: 'deep_research', workspaceSource: 'selected' });
    expect(r.workspaceSent).toBe('deep_research');
    expect(r.workspaceSource).toBe('selected');
  });

  it('Library surface forwarded verbatim', () => {
    const r = resolveWorkspacePayload({ workspace: 'library', workspaceSource: 'selected' });
    expect(r.workspaceSent).toBe('library');
    expect(r.workspaceSource).toBe('selected');
  });

  it('Artifacts surface forwarded verbatim', () => {
    const r = resolveWorkspacePayload({ workspace: 'artifacts', workspaceSource: 'selected' });
    expect(r.workspaceSent).toBe('artifacts');
    expect(r.workspaceSource).toBe('selected');
  });

  it('No active surface → wire workspace is null + source="none"', () => {
    const r = resolveWorkspacePayload({ workspace: null, workspaceSource: 'none' });
    // CRITICAL: must NOT silently coerce to 'work' on the wire.
    expect(r.workspaceSent).toBeNull();
    expect(r.workspaceSource).toBe('none');
    // SOP resolver input still uses the legacy 'work' freeform key so the
    // resolver picks "no workspace SOP" without any code change there.
    expect(r.sopResolverWorkspace).toBe('work');
  });

  it('Omitted options → defaults to wire null + source="none"', () => {
    const r = resolveWorkspacePayload();
    expect(r.workspaceSent).toBeNull();
    expect(r.workspaceSource).toBe('none');
    expect(r.sopResolverWorkspace).toBe('work');
  });

  it('Empty / whitespace workspace string is treated as no surface', () => {
    const r1 = resolveWorkspacePayload({ workspace: '' });
    const r2 = resolveWorkspacePayload({ workspace: '   ' });
    expect(r1.workspaceSent).toBeNull();
    expect(r1.workspaceSource).toBe('none');
    expect(r2.workspaceSent).toBeNull();
    expect(r2.workspaceSource).toBe('none');
  });

  it('Honors explicit workspaceSource="thread-tag" override', () => {
    const r = resolveWorkspacePayload({ workspace: 'brainstorm', workspaceSource: 'thread-tag' });
    expect(r.workspaceSent).toBe('brainstorm');
    expect(r.workspaceSource).toBe('thread-tag');
  });

  it('Honors explicit workspaceSource="default" override', () => {
    const r = resolveWorkspacePayload({ workspace: 'deep_research', workspaceSource: 'default' });
    expect(r.workspaceSent).toBe('deep_research');
    expect(r.workspaceSource).toBe('default');
  });

  it('Work surface is a real selection (still forwarded as work, not freeform)', () => {
    // Work CAN be explicitly selected by the user. In that case the wire
    // value should be 'work' and source 'selected' — distinct from the
    // implicit no-surface case where wire is null + source 'none'.
    const r = resolveWorkspacePayload({ workspace: 'work', workspaceSource: 'selected' });
    expect(r.workspaceSent).toBe('work');
    expect(r.workspaceSource).toBe('selected');
  });
});

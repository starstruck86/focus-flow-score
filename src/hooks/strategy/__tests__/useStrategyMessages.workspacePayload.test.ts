/**
 * Phase 7D-fix — Workspace payload truth tests.
 *
 * Asserts that the client `sendMessage` helper sends the *truthful*
 * workspace value to strategy-chat:
 *   • A real surface (brainstorm/refine/etc.) is forwarded verbatim,
 *     with workspaceSource = 'selected'.
 *   • No active surface → workspace = null + workspaceSource = 'none'.
 *     The previous behavior silently coerced this to 'work', making
 *     freeform calls indistinguishable from the Work surface in logs.
 *   • Caller may explicitly override workspaceSource (thread-tag, default).
 *
 * This is a pure shape test against the request body — it does not
 * exercise the streaming or React state paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Stub the supabase client BEFORE importing the hook so the module
// captures the mocked instance.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    }),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/strategy/buildGlobalInstructionsPayload', () => ({
  buildGlobalInstructionsPayload: () => null,
}));

vi.mock('@/lib/strategy/buildStrategySopPayloads', () => ({
  buildStrategySopPayloads: () => ({
    resolvedSops: null,
    workspaceSop: null,
    globalSop: null,
    taskSop: null,
  }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useStrategyMessages } from '../useStrategyMessages';

function mockFetchOnce() {
  // Empty SSE-like body so the streaming loop terminates immediately.
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
      controller.close();
    },
  });
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
  );
  // @ts-expect-error overriding global
  globalThis.fetch = fetchSpy;
  return fetchSpy;
}

function readBody(fetchSpy: ReturnType<typeof vi.fn>) {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const init = fetchSpy.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('useStrategyMessages — workspace payload truth (Phase 7D-fix)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('sends the active surface verbatim with workspaceSource="selected"', async () => {
    const fetchSpy = mockFetchOnce();
    const { result } = renderHook(() => useStrategyMessages('thread-1'));
    await act(async () => {
      await result.current.sendMessage('Give me angles', {
        workspace: 'brainstorm',
        workspaceSource: 'selected',
      });
    });
    const body = readBody(fetchSpy);
    expect(body.workspace).toBe('brainstorm');
    expect(body.workspaceSource).toBe('selected');
  });

  it('sends workspace=null + workspaceSource="none" when no surface is active', async () => {
    const fetchSpy = mockFetchOnce();
    const { result } = renderHook(() => useStrategyMessages('thread-1'));
    await act(async () => {
      await result.current.sendMessage('hello', { workspace: null, workspaceSource: 'none' });
    });
    const body = readBody(fetchSpy);
    // CRITICAL: must NOT silently coerce to 'work'. Freeform/no-surface is
    // a distinct runtime state and the server log relies on this.
    expect(body.workspace).toBeNull();
    expect(body.workspaceSource).toBe('none');
  });

  it('defaults workspaceSource to "none" when caller omits both fields', async () => {
    const fetchSpy = mockFetchOnce();
    const { result } = renderHook(() => useStrategyMessages('thread-1'));
    await act(async () => {
      await result.current.sendMessage('hello');
    });
    const body = readBody(fetchSpy);
    expect(body.workspace).toBeNull();
    expect(body.workspaceSource).toBe('none');
  });

  it('forwards Refine surface', async () => {
    const fetchSpy = mockFetchOnce();
    const { result } = renderHook(() => useStrategyMessages('thread-1'));
    await act(async () => {
      await result.current.sendMessage('refine this', {
        workspace: 'refine',
        workspaceSource: 'selected',
      });
    });
    const body = readBody(fetchSpy);
    expect(body.workspace).toBe('refine');
    expect(body.workspaceSource).toBe('selected');
  });

  it('forwards Deep Research surface', async () => {
    const fetchSpy = mockFetchOnce();
    const { result } = renderHook(() => useStrategyMessages('thread-1'));
    await act(async () => {
      await result.current.sendMessage('research', {
        workspace: 'deep_research',
        workspaceSource: 'selected',
      });
    });
    const body = readBody(fetchSpy);
    expect(body.workspace).toBe('deep_research');
    expect(body.workspaceSource).toBe('selected');
  });

  it('honors an explicit workspaceSource="thread-tag" override', async () => {
    const fetchSpy = mockFetchOnce();
    const { result } = renderHook(() => useStrategyMessages('thread-1'));
    await act(async () => {
      await result.current.sendMessage('hi', {
        workspace: 'brainstorm',
        workspaceSource: 'thread-tag',
      });
    });
    const body = readBody(fetchSpy);
    expect(body.workspace).toBe('brainstorm');
    expect(body.workspaceSource).toBe('thread-tag');
  });
});

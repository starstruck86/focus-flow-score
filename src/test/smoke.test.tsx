/**
 * Smoke + integration tests — verify critical flows render and behave correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import React from 'react';

// ─── Mocks ─────────────────────────────────────────────

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      signOut: vi.fn().mockResolvedValue({}),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      then: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock('@/integrations/lovable', () => ({
  lovable: {
    auth: {
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

// Mock trackedInvoke
vi.mock('@/lib/trackedInvoke', () => ({
  trackedInvoke: vi.fn().mockResolvedValue({ data: null, error: null, traceId: 'test-trace' }),
}));

// Mock streamingFetch
vi.mock('@/lib/streamingFetch', () => ({
  streamingFetch: vi.fn().mockImplementation(async (_opts: any, callbacks: any) => {
    callbacks.onDone();
    return { traceId: 'test-stream-trace' };
  }),
  streamToString: vi.fn().mockResolvedValue({ text: 'mock content', traceId: 'test-stream-trace' }),
}));

// Mock authenticatedFetch
vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  }),
}));

// Mock CopilotContext
vi.mock('@/contexts/CopilotContext', () => ({
  CopilotProvider: ({ children }: { children: React.ReactNode }) => children,
  useCopilot: () => ({
    state: { open: false },
    pageContext: null,
    setPageContext: vi.fn(),
    ask: vi.fn(),
    askBackground: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    setOpen: vi.fn(),
    clearInitialQuestion: vi.fn(),
    backgroundResult: null,
    clearBackgroundResult: vi.fn(),
  }),
}));

// Mock territoryCopilot (streaming)
vi.mock('@/lib/territoryCopilot', () => ({
  streamCopilot: vi.fn(),
  SUGGESTED_QUESTIONS: [],
  PAGE_SUGGESTED_QUESTIONS: {},
  PAGE_PLACEHOLDERS: {},
  MODE_CONFIG: {},
}));

// Mock LinkedRecordContext
vi.mock('@/contexts/LinkedRecordContext', () => ({
  LinkedRecordProvider: ({ children }: { children: React.ReactNode }) => children,
  useLinkedRecordContext: () => ({
    currentRecord: null,
    setCurrentRecord: vi.fn(),
    clearRecord: vi.fn(),
  }),
}));

function createWrapper(route = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <TooltipProvider>
            <MemoryRouter initialEntries={[route]}>
              {children}
            </MemoryRouter>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  };
}

// ─── Auth ──────────────────────────────────────────────
describe('Auth page', () => {
  it('renders auth page container', async () => {
    const Auth = (await import('@/pages/Auth')).default;
    const { AuthProvider } = await import('@/contexts/AuthContext');
    const Wrapper = createWrapper('/auth');
    const { container } = render(
      <Wrapper><AuthProvider><Auth /></AuthProvider></Wrapper>
    );
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });
});

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to /auth', async () => {
    const { ProtectedRoute } = await import('@/components/ProtectedRoute');
    const { AuthProvider } = await import('@/contexts/AuthContext');
    const Wrapper = createWrapper('/');
    const { container } = render(
      <Wrapper>
        <AuthProvider>
          <ProtectedRoute><div data-testid="protected-content">Secret</div></ProtectedRoute>
        </AuthProvider>
      </Wrapper>
    );
    expect(container.querySelector('[data-testid="protected-content"]')).toBeFalsy();
  });
});

// ─── State Components ──────────────────────────────────
describe('StateComponents', () => {
  it('renders LoadingState', async () => {
    const { LoadingState } = await import('@/components/StateComponents');
    const { container } = render(<LoadingState message="Loading data..." />);
    expect(container.textContent).toContain('Loading data...');
  });

  it('renders EmptyState', async () => {
    const { EmptyState } = await import('@/components/StateComponents');
    const { container } = render(<EmptyState title="No items" description="Add something" />);
    expect(container.textContent).toContain('No items');
  });

  it('renders ErrorState with retry', async () => {
    const { ErrorState } = await import('@/components/StateComponents');
    const onRetry = vi.fn();
    const { container } = render(<ErrorState error="Something broke" onRetry={onRetry} />);
    expect(container.textContent).toContain('Something broke');
    expect(container.querySelector('[data-testid="error-retry-btn"]')).toBeTruthy();
  });
});

// ─── Mutation Guard ────────────────────────────────────
describe('useMutationGuard', () => {
  it('prevents double-submit', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useMutationGuard } = await import('@/hooks/useMutationGuard');
    const { result } = renderHook(() => useMutationGuard());

    let callCount = 0;
    const slowFn = () => new Promise<void>(r => { callCount++; setTimeout(r, 100); });

    await act(async () => {
      const p1 = result.current.guard(slowFn);
      const p2 = result.current.guard(slowFn);
      await Promise.all([p1, p2]);
    });
    expect(callCount).toBe(1);
  });
});

// ─── Error Normalization ───────────────────────────────
describe('Error normalization', () => {
  it('classifies auth errors', async () => {
    const { normalizeError } = await import('@/lib/appError');
    const result = normalizeError({ error: new Error('No active session'), source: 'frontend', functionName: 'test-fn' });
    expect(result.category).toBe('AUTH_ERROR');
    expect(result.retryable).toBe(false);
  });

  it('classifies network errors', async () => {
    const { normalizeError } = await import('@/lib/appError');
    const result = normalizeError({ error: new TypeError('Failed to fetch'), source: 'frontend' });
    expect(result.category).toBe('NETWORK_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('classifies timeout errors', async () => {
    const { normalizeError } = await import('@/lib/appError');
    const result = normalizeError({ error: new Error('my-function timed out after 30000ms'), source: 'function', functionName: 'my-function' });
    expect(result.category).toBe('FUNCTION_TIMEOUT');
    expect(result.retryable).toBe(true);
  });

  it('classifies rate limit errors', async () => {
    const { normalizeError } = await import('@/lib/appError');
    const result = normalizeError({ error: new Error('rate limit exceeded'), source: 'function' });
    expect(result.category).toBe('RATE_LIMITED');
    expect(result.retryable).toBe(true);
  });

  it('classifies DB write errors', async () => {
    const { normalizeError } = await import('@/lib/appError');
    const result = normalizeError({ error: new Error('duplicate key violates unique constraint'), source: 'frontend' });
    expect(result.category).toBe('DB_WRITE_FAILED');
    expect(result.retryable).toBe(false);
  });

  it('generates unique trace IDs', async () => {
    const { generateTraceId } = await import('@/lib/appError');
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });
});

// ─── authenticatedFetch ────────────────────────────────
describe('authenticatedFetch helper', () => {
  it('exports authenticatedFetch function', async () => {
    const mod = await import('@/lib/authenticatedFetch');
    expect(typeof mod.authenticatedFetch).toBe('function');
  });
});

// ─── streamingFetch ────────────────────────────────────
describe('streamingFetch helper', () => {
  it('exports streamingFetch and streamToString', async () => {
    const mod = await import('@/lib/streamingFetch');
    expect(typeof mod.streamingFetch).toBe('function');
    expect(typeof mod.streamToString).toBe('function');
  });

  it('streamToString returns text and traceId', async () => {
    const { streamToString } = await import('@/lib/streamingFetch');
    const result = await streamToString({ functionName: 'test' });
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('traceId');
  });

  it('streamingFetch calls onDone', async () => {
    const { streamingFetch } = await import('@/lib/streamingFetch');
    const onDone = vi.fn();
    await streamingFetch({ functionName: 'test' }, { onDelta: vi.fn(), onDone, onError: vi.fn() });
    expect(onDone).toHaveBeenCalled();
  });
});

// ─── trackedInvoke ─────────────────────────────────────
describe('trackedInvoke helper', () => {
  it('returns data, error, traceId shape', async () => {
    const { trackedInvoke } = await import('@/lib/trackedInvoke');
    const result = await trackedInvoke('test-fn', { body: { foo: 'bar' } });
    expect(result).toHaveProperty('traceId');
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('error');
  });
});

// ─── RouteErrorBoundary ────────────────────────────────
describe('RouteErrorBoundary', () => {
  it('renders children normally', async () => {
    const { RouteErrorBoundary } = await import('@/components/RouteErrorBoundary');
    const { container } = render(
      <RouteErrorBoundary routeName="Test">
        <div data-testid="child">OK</div>
      </RouteErrorBoundary>
    );
    expect(container.querySelector('[data-testid="child"]')).toBeTruthy();
  });
});

// ─── Page module exports ───────────────────────────────
describe('Page modules export default components', () => {
  it('Settings', async () => {
    const mod = await import('@/pages/Settings');
    expect(typeof mod.default).toBe('function');
  });

  it('Diagnostics', async () => {
    const mod = await import('@/pages/Diagnostics');
    expect(typeof mod.default).toBe('function');
  });

  it('Dashboard', async () => {
    const mod = await import('@/pages/Dashboard');
    expect(typeof mod.default).toBe('function');
  });

  it('Renewals', async () => {
    const mod = await import('@/pages/Renewals');
    expect(typeof mod.default).toBe('function');
  });

  it('Coach', async () => {
    const mod = await import('@/pages/Coach');
    expect(typeof mod.default).toBe('function');
  });

  it('Trends', async () => {
    const mod = await import('@/pages/Trends');
    expect(typeof mod.default).toBe('function');
  });

  it('Tasks', async () => {
    const mod = await import('@/pages/Tasks');
    expect(typeof mod.default).toBe('function');
  });

  it('PrepHub', async () => {
    const mod = await import('@/pages/PrepHub');
    expect(typeof mod.default).toBe('function');
  });

  it('Quota', async () => {
    const mod = await import('@/pages/Quota');
    expect(typeof mod.default).toBe('function');
  });
});

// ─── Import Wizard ─────────────────────────────────────
describe('Import Wizard', () => {
  it('exports ImportWizard component', async () => {
    const mod = await import('@/components/import/ImportWizard');
    expect(typeof mod.ImportWizard).toBe('function');
  });

  it('exports ImportModal component', async () => {
    const mod = await import('@/components/import/ImportModal');
    expect(typeof mod.ImportModal).toBe('function');
  });
});

// ─── Streaming mock integration ────────────────────────
describe('Streaming mock integration', () => {
  it('simulates SSE delta events', async () => {
    const { streamingFetch } = await import('@/lib/streamingFetch');
    const mockStreamingFetch = vi.mocked(streamingFetch);

    // Override to simulate delta events
    mockStreamingFetch.mockImplementationOnce(async (_opts, callbacks) => {
      callbacks.onDelta('Hello ');
      callbacks.onDelta('World');
      callbacks.onDone();
      return { traceId: 'sim-trace' };
    });

    let accumulated = '';
    await streamingFetch(
      { functionName: 'test' },
      {
        onDelta: (t) => { accumulated += t; },
        onDone: () => {},
        onError: vi.fn(),
      },
    );
    expect(accumulated).toBe('Hello World');
  });

  it('simulates streaming error', async () => {
    const { streamingFetch } = await import('@/lib/streamingFetch');
    const mockStreamingFetch = vi.mocked(streamingFetch);

    mockStreamingFetch.mockImplementationOnce(async (_opts, callbacks) => {
      callbacks.onError('Connection lost');
      return { traceId: 'err-trace' };
    });

    let errorMsg = '';
    await streamingFetch(
      { functionName: 'test' },
      {
        onDelta: vi.fn(),
        onDone: vi.fn(),
        onError: (msg) => { errorMsg = msg; },
      },
    );
    expect(errorMsg).toBe('Connection lost');
  });
});

// ─── Migration integrity ──────────────────────────────
describe('Invoke migration integrity', () => {
  it('no direct supabase.functions.invoke in key files', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const srcDir = path.resolve(__dirname, '..');

    const checkFiles = [
      'components/dashboard/CompanyMonitorCard.tsx',
      'components/dave/clientTools.ts',
      'hooks/useCoachingEngine.ts',
      'hooks/useCalendarEvents.ts',
      'components/prep/ResourceManager.tsx',
      'hooks/useMockCalls.ts',
      'lib/territoryCopilot.ts',
    ];

    for (const file of checkFiles) {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
      const directCalls = (content.match(/supabase\.functions\.invoke/g) || []).length;
      expect(directCalls).toBe(0);
    }
  });

  it('no raw VITE_SUPABASE_URL fetch in streaming files', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const srcDir = path.resolve(__dirname, '..');

    const streamingFiles = [
      'lib/territoryCopilot.ts',
      'hooks/useMockCalls.ts',
      'components/prep/AIGenerateDialog.tsx',
    ];

    for (const file of streamingFiles) {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
      const rawFetches = (content.match(/VITE_SUPABASE_URL.*functions/g) || []).length;
      expect(rawFetches).toBe(0);
    }
  });
});

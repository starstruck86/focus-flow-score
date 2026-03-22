/**
 * Smoke tests — verify critical flows render without crashing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';

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

describe('Auth page', () => {
  it('renders auth page container', async () => {
    const Auth = (await import('@/pages/Auth')).default;
    const { AuthProvider } = await import('@/contexts/AuthContext');
    const Wrapper = createWrapper('/auth');
    const { container } = render(
      <Wrapper>
        <AuthProvider>
          <Auth />
        </AuthProvider>
      </Wrapper>
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
          <ProtectedRoute>
            <div data-testid="protected-content">Secret</div>
          </ProtectedRoute>
        </AuthProvider>
      </Wrapper>
    );
    expect(container.querySelector('[data-testid="protected-content"]')).toBeFalsy();
  });
});

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

describe('Error normalization', () => {
  it('classifies auth errors', async () => {
    const { normalizeError } = await import('@/lib/appError');
    const result = normalizeError({
      error: new Error('No active session'),
      source: 'frontend',
      functionName: 'test-fn',
    });
    expect(result.category).toBe('AUTH_ERROR');
    expect(result.retryable).toBe(false);
  });

  it('classifies network errors', async () => {
    const { normalizeError } = await import('@/lib/appError');
    const err = new TypeError('Failed to fetch');
    const result = normalizeError({ error: err, source: 'frontend' });
    expect(result.category).toBe('NETWORK_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('classifies timeout errors', async () => {
    const { normalizeError } = await import('@/lib/appError');
    const result = normalizeError({
      error: new Error('my-function timed out after 30000ms'),
      source: 'function',
      functionName: 'my-function',
    });
    expect(result.category).toBe('FUNCTION_TIMEOUT');
    expect(result.retryable).toBe(true);
  });

  it('generates unique trace IDs', async () => {
    const { generateTraceId } = await import('@/lib/appError');
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });
});

describe('authenticatedFetch helper', () => {
  it('exports authenticatedFetch function', async () => {
    const mod = await import('@/lib/authenticatedFetch');
    expect(typeof mod.authenticatedFetch).toBe('function');
  });
});

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

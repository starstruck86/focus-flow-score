/**
 * Smoke tests — verify critical flows render without crashing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
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
  it('renders sign-in button', async () => {
    const Auth = (await import('@/pages/Auth')).default;
    const { container } = render(<Auth />, { wrapper: createWrapper('/auth') });
    expect(container.querySelector('[data-testid="auth-page"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="google-sign-in"]')).toBeTruthy();
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

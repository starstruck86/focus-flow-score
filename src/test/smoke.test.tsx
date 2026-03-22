/**
 * Smoke tests — verify critical flows render without crashing.
 * These are fast, shallow tests that ensure the app boots and key routes
 * produce expected DOM elements.
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

// Mock lovable integration
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
    render(<Auth />, { wrapper: createWrapper('/auth') });
    expect(screen.getByTestId('auth-page')).toBeInTheDocument();
    expect(screen.getByTestId('google-sign-in')).toBeInTheDocument();
  });
});

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to /auth', async () => {
    const { ProtectedRoute } = await import('@/components/ProtectedRoute');
    const { AuthProvider } = await import('@/contexts/AuthContext');
    const Wrapper = createWrapper('/');
    render(
      <Wrapper>
        <AuthProvider>
          <ProtectedRoute>
            <div data-testid="protected-content">Secret</div>
          </ProtectedRoute>
        </AuthProvider>
      </Wrapper>
    );
    // Since no session, should NOT render protected content
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });
});

describe('StateComponents', () => {
  it('renders LoadingState', async () => {
    const { LoadingState } = await import('@/components/StateComponents');
    render(<LoadingState message="Loading data..." />);
    expect(screen.getByText('Loading data...')).toBeInTheDocument();
  });

  it('renders EmptyState', async () => {
    const { EmptyState } = await import('@/components/StateComponents');
    render(<EmptyState title="No items" description="Add something" />);
    expect(screen.getByText('No items')).toBeInTheDocument();
  });

  it('renders ErrorState with retry', async () => {
    const { ErrorState } = await import('@/components/StateComponents');
    const onRetry = vi.fn();
    render(<ErrorState error="Something broke" onRetry={onRetry} />);
    expect(screen.getByText('Something broke')).toBeInTheDocument();
    expect(screen.getByTestId('error-retry-btn')).toBeInTheDocument();
  });
});

describe('useMutationGuard', () => {
  it('prevents double-submit', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useMutationGuard } = await import('@/hooks/useMutationGuard');

    const { result } = renderHook(() => useMutationGuard());

    let callCount = 0;
    const slowFn = () => new Promise<void>(r => { callCount++; setTimeout(r, 100); });

    // Fire two concurrent calls
    await act(async () => {
      const p1 = result.current.guard(slowFn);
      const p2 = result.current.guard(slowFn); // should be blocked
      await Promise.all([p1, p2]);
    });

    expect(callCount).toBe(1);
  });
});

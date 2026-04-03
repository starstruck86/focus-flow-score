import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useApprovalCheck } from '@/hooks/useApprovalCheck';
import { REVIEW_MODE } from '@/contexts/ReviewModeContext';
import AccessDenied from '@/pages/AccessDenied';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { session, user, loading } = useAuth();
  const location = useLocation();
  const approvalStatus = useApprovalCheck();

  // Public review mode — bypass auth entirely
  if (REVIEW_MODE) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div data-testid="protected-loading" className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <h1 className="text-2xl font-bold text-foreground font-display">Quota CoPilot</h1>
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!session || !user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Allowlist enforcement (only when ENFORCE_ALLOWLIST flag is on)
  if (approvalStatus === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <h1 className="text-2xl font-bold text-foreground font-display">Quota CoPilot</h1>
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Verifying access…</p>
      </div>
    );
  }

  if (approvalStatus === 'denied') {
    return <AccessDenied />;
  }

  return <>{children}</>;
}

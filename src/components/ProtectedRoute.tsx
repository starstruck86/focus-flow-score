import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  // TEMPORARY: bypass auth for testing — remove this line to re-enable auth
  const BYPASS_AUTH = true;

  const { session, user, loading } = useAuth();
  const location = useLocation();

  if (BYPASS_AUTH) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div data-testid="protected-loading" className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <h1 className="text-2xl font-bold text-foreground font-display">Quota Compass</h1>
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!session || !user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

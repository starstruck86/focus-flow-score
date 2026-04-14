import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

export default function AccessDenied() {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/auth';
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6 p-4 pt-[env(safe-area-inset-top)] text-center">
      <ShieldX className="h-16 w-16 text-destructive" />
      <h1 className="text-3xl font-bold text-foreground font-display">Access Denied</h1>
      <p className="text-muted-foreground max-w-md">
        Your account has not been approved for access. If you believe this is an error,
        contact the administrator.
      </p>
      <Button variant="outline" onClick={handleSignOut}>
        Sign Out
      </Button>
    </div>
  );
}

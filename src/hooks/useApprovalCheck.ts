import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { loadFeatureFlags } from '@/lib/featureFlags';

type ApprovalStatus = 'loading' | 'approved' | 'denied' | 'skipped';

export function useApprovalCheck(): ApprovalStatus {
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<ApprovalStatus>('loading');

  useEffect(() => {
    if (authLoading) {
      setStatus('loading');
      return;
    }

    const flags = loadFeatureFlags();
    if (!flags.ENFORCE_ALLOWLIST) {
      setStatus('skipped');
      return;
    }

    if (!user) {
      setStatus('denied');
      return;
    }

    let cancelled = false;

    const check = async () => {
      const { data, error } = await supabase
        .from('approved_users')
        .select('is_active')
        .or(`user_id.eq.${user.id},email.eq.${user.email}`)
        .eq('is_active', true)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.warn('[AllowlistCheck] query error, defaulting to denied:', error.message);
        setStatus('denied');
        return;
      }

      setStatus(data ? 'approved' : 'denied');
    };

    check();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return status;
}

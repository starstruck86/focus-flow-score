import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Initialize user data (config, summary) on first login
async function initializeUserData(userId: string) {
  try {
    // Check if work_schedule_config exists
    const { data: existingConfig } = await supabase
      .from('work_schedule_config')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (!existingConfig) {
      await supabase.from('work_schedule_config').insert({
        user_id: userId,
        working_days: [1, 2, 3, 4, 5], // Mon-Fri
        reminder_enabled: true,
        reminder_time: '16:30:00',
        grace_window_hours: 2,
        goal_daily_score_threshold: 8,
        goal_productivity_threshold: 75,
        eod_checkin_time: '16:30:00',
        eod_reminder_time: '18:30:00',
        morning_confirm_time: '08:00:00',
        grace_window_end_time: '02:00:00',
      });
    }
    
    // Check if streak_summary exists
    const { data: existingSummary } = await supabase
      .from('streak_summary')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (!existingSummary) {
      await supabase.from('streak_summary').insert({
        user_id: userId,
        current_checkin_streak: 0,
        current_performance_streak: 0,
        longest_checkin_streak: 0,
        longest_performance_streak: 0,
        total_eligible_days: 0,
        total_checkins: 0,
        total_goals_met: 0,
        checkin_level: 1,
        performance_level: 1,
      });
    }
  } catch (error) {
    // Silently log — user data init is non-critical
    console.warn('Failed to initialize user data:', error);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const initializedUserRef = useRef<string | null>(null);
  const hasBootstrappedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const initializeIfNeeded = (userId: string) => {
      if (initializedUserRef.current === userId) return;
      initializedUserRef.current = userId;
      setTimeout(() => {
        initializeUserData(userId);
      }, 0);
    };

    const applySessionState = (nextSession: Session | null) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);

      if (nextSession?.user) {
        initializeIfNeeded(nextSession.user.id);
      } else {
        initializedUserRef.current = null;
      }
    };

    // Set up auth listener BEFORE checking session
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted || event === 'INITIAL_SESSION') return;

      // Prevent early auth events from racing ahead of session restoration.
      if (!hasBootstrappedRef.current) return;

      applySessionState(nextSession);
    });

    const bootstrapAuth = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (!isMounted) return;

        applySessionState(initialSession ?? null);
      } catch (error) {
        console.error('Auth bootstrap failed:', error);
        if (!isMounted) return;
        initializedUserRef.current = null;
        setSession(null);
        setUser(null);
        setLoading(false);
      } finally {
        hasBootstrappedRef.current = true;
      }
    };

    bootstrapAuth();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    initializedUserRef.current = null;
    setSession(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

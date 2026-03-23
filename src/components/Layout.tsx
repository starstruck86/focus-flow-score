import { useLocation, useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { 
  Compass,
  LogOut,
  Mic,
} from 'lucide-react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { SaveIndicator } from '@/components/SaveIndicator';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useReviewMode } from '@/contexts/ReviewModeContext';
import { Button } from '@/components/ui/button';
import { GlobalFAB } from '@/components/fab';
import { GlobalSearch } from '@/components/GlobalSearch';
import { TerritoryCopilot } from '@/components/TerritoryCopilot';
import { VoiceCommandButton } from '@/components/VoiceCommandButton';
import { DaveConversationMode } from '@/components/DaveConversationMode';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BackToToday } from '@/components/BackToToday';
import { useCopilot, type PageContext } from '@/contexts/CopilotContext';
import { DayTimeline } from '@/components/tasks/DayTimeline';
import { ActivityRings } from '@/components/ActivityRings';
import { GlobalWeekStrip } from '@/components/GlobalWeekStrip';
import { useDaveContext, DaveSessionError, type DaveSessionData } from '@/hooks/useDaveContext';
import { useVoiceReminders } from '@/hooks/useVoiceReminders';
import { useWakeWord } from '@/hooks/useWakeWord';
import { motion, AnimatePresence } from 'framer-motion';
import { BottomNav, useActiveTabColor, COLOR_VAR } from '@/components/layout/BottomNav';



const PAGE_CONTEXT_MAP: Record<string, PageContext> = {
  '/': { page: 'dashboard', description: 'Today / Dashboard — daily plan, agenda, and key metrics' },
  '/tasks': { page: 'tasks', description: 'Tasks — action items, follow-ups, and to-dos' },
  '/outreach': { page: 'outreach', description: 'New Logo Outreach — prospecting accounts and pipeline building' },
  '/renewals': { page: 'renewals', description: 'Renewals — existing customer renewals and retention' },
  '/prep': { page: 'prep-hub', description: 'Prep Hub — meeting preparation and research' },
  '/coach': { page: 'coach', description: 'Sales Coach — call analysis, roleplay, and skill development' },
  '/trends': { page: 'trends', description: 'Trends — performance trends and analytics over time' },
  '/quota': { page: 'quota', description: 'Quota — quota attainment, commission, and pipeline math' },
  '/settings': { page: 'settings', description: 'Settings — app configuration and preferences' },
};

/** Tap-to-talk prompt for ?dave=1 URL opens (Siri Shortcuts) */
function DaveTapPrompt({ onTap }: { onTap: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[99] bg-black/90 flex flex-col items-center justify-center gap-6"
    >
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onTap}
        className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center text-primary shadow-[0_0_60px_20px_rgba(16,185,129,0.2)]"
      >
        <Mic className="h-12 w-12" />
      </motion.button>
      <p className="text-white/70 text-lg font-medium">Tap to talk to Dave</p>
    </motion.div>
  );
}

// ─── Cross-Tab Dave Guard ───
const DAVE_CHANNEL_NAME = 'dave-session';

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const { isReviewMode, guardDestructive } = useReviewMode();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setPageContext } = useCopilot();
  const activeColor = useActiveTabColor();
  
  // Dave state
  const [daveOpen, setDaveOpen] = useState(false);
  const [daveMinimized, setDaveMinimized] = useState(false);
  const [showDaveTapPrompt, setShowDaveTapPrompt] = useState(false);
  const [daveSessionData, setDaveSessionData] = useState<DaveSessionData | null>(null);
  const [daveRetryCount, setDaveRetryCount] = useState(0);
  const [daveBlockedByTab, setDaveBlockedByTab] = useState(false);
  const { getSession: getDaveSession, invalidateCache: invalidateDaveCache, isFetching: isFetchingDaveSession } = useDaveContext();
  const daveChannelRef = useRef<BroadcastChannel | null>(null);
  useVoiceReminders();

  // Wake word — "Hey Dave" (reactive to Settings toggle)
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('wake-word-enabled') === 'true'
  );
  useEffect(() => {
    const handler = (e: Event) => setWakeWordEnabled((e as CustomEvent).detail === true);
    window.addEventListener('wake-word-changed', handler);
    return () => window.removeEventListener('wake-word-changed', handler);
  }, []);
  useWakeWord({ onWake: () => { if (!daveOpen) handleOpenDave(); }, enabled: wakeWordEnabled && !daveOpen });

  // ─── BroadcastChannel cross-tab guard ───
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(DAVE_CHANNEL_NAME);
    daveChannelRef.current = channel;

    channel.onmessage = (event) => {
      if (event.data === 'dave-active') {
        // Another tab opened Dave
        if (!daveOpen) {
          setDaveBlockedByTab(true);
        }
      } else if (event.data === 'dave-inactive') {
        setDaveBlockedByTab(false);
      }
    };

    return () => {
      channel.close();
      daveChannelRef.current = null;
    };
  }, [daveOpen]);

  // Broadcast Dave state changes
  useEffect(() => {
    if (!daveChannelRef.current) return;
    daveChannelRef.current.postMessage(daveOpen ? 'dave-active' : 'dave-inactive');
  }, [daveOpen]);

  // Handle ?dave=1 from Siri Shortcuts
  useEffect(() => {
    if (searchParams.get('dave') === '1') {
      setShowDaveTapPrompt(true);
      const next = new URLSearchParams(searchParams);
      next.delete('dave');
      setSearchParams(next, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.style.setProperty('--page-accent', COLOR_VAR[activeColor]);
  }, [activeColor]);

  useEffect(() => {
    const path = location.pathname;
    if (PAGE_CONTEXT_MAP[path]) {
      setPageContext(PAGE_CONTEXT_MAP[path]);
    } else if (path.startsWith('/accounts/')) {
      setPageContext({ page: 'account-detail', description: 'Account Detail — deep-dive on a specific account' });
    } else if (path.startsWith('/opportunities/')) {
      setPageContext({ page: 'opportunity-detail', description: 'Opportunity Detail — deal-level view' });
    } else {
      setPageContext({ page: 'other', description: path });
    }
  }, [location.pathname, setPageContext]);

  const headerAccentStyle = useMemo(() => ({
    borderBottomColor: `hsl(${COLOR_VAR[activeColor]} / 0.2)`,
  }), [activeColor]);

  const handleOpenDave = useCallback(async () => {
    if (isFetchingDaveSession) return;
    
    // Cross-tab guard
    if (daveBlockedByTab) {
      toast.error('Dave is active in another tab', {
        description: 'Close Dave in the other tab first.',
        duration: 4000,
      });
      return;
    }

    setShowDaveTapPrompt(false);
    try {
      const session = await getDaveSession();
      setDaveSessionData(session);
      setDaveMinimized(false);
      setDaveOpen(true);
    } catch (err: any) {
      console.error('[Dave] Failed to fetch session:', err);
      if (err instanceof DaveSessionError) {
        switch (err.errorType) {
          case 'concurrency_limit': {
            const waitSec = err.cooldownUntil ? Math.ceil((err.cooldownUntil - Date.now()) / 1000) : 30;
            toast.error('Dave is at capacity', {
              description: `ElevenLabs concurrency limit — try again in ${waitSec}s`,
              duration: 6000,
            });
            break;
          }
          case 'auth_failed':
            toast.error('Sign in required', { description: err.message });
            break;
          case 'agent_error':
            toast.error('Dave configuration issue', { description: err.message });
            break;
          default:
            toast.error('Dave startup failed', { description: err.message || 'Token fetch returned an error. Check your connection and try again.' });
        }
      } else {
        // Network errors, timeouts, etc.
        const msg = err instanceof Error ? err.message : String(err);
        const isNetwork = /fetch|network|timeout|timed out|aborted/i.test(msg);
        toast.error(isNetwork ? 'Network error starting Dave' : 'Dave startup failed', {
          description: msg || 'An unexpected error occurred. Please try again.',
          duration: 5000,
        });
      }
    }
  }, [getDaveSession, isFetchingDaveSession, daveBlockedByTab]);

  const handleCloseDave = useCallback(() => {
    setDaveOpen(false);
    setDaveMinimized(false);
    setDaveSessionData(null);
  }, []);

  const handleToggleMinimize = useCallback(() => {
    setDaveMinimized(prev => !prev);
  }, []);

  /** Retry-via-remount: close Dave, fetch fresh session, reopen with new key */
  const handleDaveRetry = useCallback(async () => {
    console.log('[Dave] Retry-via-remount triggered');
    setDaveOpen(false);
    setDaveMinimized(false);
    setDaveSessionData(null);
    invalidateDaveCache();
    
    await new Promise(r => setTimeout(r, 300));
    
    try {
      const freshSession = await getDaveSession();
      setDaveSessionData(freshSession);
      setDaveRetryCount(c => c + 1);
      setDaveOpen(true);
      console.log('[Dave] Retry-via-remount: reopened with fresh session');
    } catch (err: any) {
      console.error('[Dave] Retry failed:', err);
      if (err instanceof DaveSessionError && err.errorType === 'concurrency_limit') {
        const waitSec = err.cooldownUntil ? Math.ceil((err.cooldownUntil - Date.now()) / 1000) : 30;
        toast.error('Dave is at capacity', {
          description: `Concurrency limit — try again in ${waitSec}s. Auto-retry blocked.`,
          duration: 8000,
        });
      } else {
        toast.error('Could not restart Dave', { description: err.message });
      }
    }
  }, [getDaveSession, invalidateDaveCache]);

  return (
    <div data-testid="app-layout" className="min-h-screen bg-background flex flex-col w-full pt-[env(safe-area-inset-top)]">
      <header
        data-testid="app-header"
        className="flex items-center gap-2 px-3 py-2 border-b sticky top-0 z-40 bg-background/95 backdrop-blur-md"
        style={headerAccentStyle}
      >
        <div className="flex items-center gap-1.5 shrink-0">
          <Compass className="h-5 w-5" style={{ color: `hsl(${COLOR_VAR[activeColor]})` }} />
          <span className="font-display text-sm font-bold hidden sm:inline">Quota Compass</span>
          <SaveIndicator />
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(), { addSuffix: false }).replace('less than a minute', 'just now')} ago
          </span>
        </div>
        <GlobalSearch className="flex-1 min-w-0" />
        <div className="flex items-center gap-1 shrink-0">
          <VoiceCommandButton data-testid="dave-voice-btn" onOpenDave={handleOpenDave} disabled={isFetchingDaveSession} />
          <TerritoryCopilot />
          {!isReviewMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={signOut}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sign Out</TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>

      <div className="px-4 lg:px-6 max-w-4xl mx-auto w-full pt-2 space-y-2">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <GlobalWeekStrip />
          </div>
          <ActivityRings />
        </div>
        <DayTimeline />
      </div>

      <Breadcrumbs />
      <main data-testid="main-content" className="flex-1 overflow-x-hidden overflow-y-auto pb-[calc(8rem+env(safe-area-inset-bottom))]">
        {children}
      </main>

      <BottomNav />
      <BackToToday />
      <GlobalFAB position="bottom-right" />

      {/* Dave Tap Prompt for Siri Shortcut opens */}
      <AnimatePresence>
        {showDaveTapPrompt && !daveOpen && (
          <DaveTapPrompt onTap={handleOpenDave} />
        )}
      </AnimatePresence>

      {/* Dave Conversational AI — floating panel with minimize support */}
      {daveOpen && daveSessionData && (
        <DaveConversationMode
          key={`${daveSessionData.token}-${daveRetryCount}`}
          isOpen={daveOpen}
          onClose={handleCloseDave}
          onRetry={handleDaveRetry}
          sessionData={daveSessionData}
          minimized={daveMinimized}
          onMinimize={handleToggleMinimize}
        />
      )}
    </div>
  );
}

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useConversation } from '@elevenlabs/react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mic, MicOff, Volume2, MessageSquare, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDaveContext, type DaveSessionData } from '@/hooks/useDaveContext';
import { useDaveConversation } from '@/hooks/useDaveConversation';
import { useCopilot } from '@/contexts/CopilotContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { createClientTools } from './dave/clientTools';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-fetched session data — overrides are derived from this */
  sessionData: DaveSessionData;
}

const DISMISSAL_PHRASES = [
  "we're done", "we are done", "thanks dave", "thank you dave",
  "goodbye", "that's all", "thats all", "bye dave", "see you",
];

const MAX_RECONNECTS = 2;
const RECONNECT_DELAYS = [2000, 5000];
const STABILITY_WINDOW_MS = 3000;

export function DaveConversationMode({ isOpen, onClose, sessionData }: Props) {
  const navigate = useNavigate();
  const { ask: askCopilot } = useCopilot();
  const { getSession, invalidateCache } = useDaveContext();
  const { addUserMessage, addDaveResponse, getConversationContext } = useDaveConversation();
  const [isConnecting, setIsConnecting] = useState(false);
  const [needsTap, setNeedsTap] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ role: 'user' | 'agent'; text: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [reconnectInfo, setReconnectInfo] = useState<string | null>(null);
  const [vadActive, setVadActive] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const startingRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const startConversationRef = useRef<() => Promise<void>>();
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Refs for stale closure fixes
  const isOpenRef = useRef(isOpen);
  const transcriptRef = useRef(transcript);
  const sessionDataRef = useRef<DaveSessionData>(sessionData);
  const isReconnectRef = useRef(false);
  const connectedAtRef = useRef<number>(0);
  const stabilityTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { sessionDataRef.current = sessionData; }, [sessionData]);

  const clientTools = useMemo(
    () => createClientTools(navigate, askCopilot),
    [navigate, askCopilot],
  );

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
  }, []);

  const greetingWatchdogRef = useRef<ReturnType<typeof setTimeout>>();

  // ─── KEY FIX: overrides go HERE in useConversation, NOT in startSession ───
  const conversation = useConversation({
    clientTools,
    overrides: {
      agent: {
        prompt: {
          prompt: sessionData.context || '',
        },
        firstMessage: sessionData.firstMessage || undefined,
      },
    },
    onConnect: () => {
      console.log('[Dave] ✅ Connected — overrides applied via useConversation hook');
      console.log('[Dave] Context length:', sessionDataRef.current?.context?.length, 'chars');
      console.log('[Dave] First message:', sessionDataRef.current?.firstMessage?.substring(0, 80));
      setError(null);
      setReconnectInfo(null);
      setIsConnecting(false);
      connectedAtRef.current = Date.now();

      if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current);
      stabilityTimerRef.current = setTimeout(() => {
        reconnectAttemptRef.current = 0;
      }, STABILITY_WINDOW_MS);

      // Belt-and-suspenders: also send context via sendContextualUpdate
      if (sessionDataRef.current?.context) {
        try {
          conversation.sendContextualUpdate(sessionDataRef.current.context);
          console.log('[Dave] Backup context sent via sendContextualUpdate');
        } catch (e) {
          console.warn('[Dave] Failed to send contextual update (fallback):', e);
        }
      }

      // Greeting watchdog: warn if no agent message within 8s
      if (greetingWatchdogRef.current) clearTimeout(greetingWatchdogRef.current);
      greetingWatchdogRef.current = setTimeout(() => {
        console.warn('[Dave] No agent greeting received within 8s of connection');
      }, 8000);
    },
    onDisconnect: () => {
      console.log('[Dave] Disconnected');
      if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current);

      if (
        isOpenRef.current &&
        reconnectAttemptRef.current < MAX_RECONNECTS &&
        !startingRef.current &&
        !reconnectTimerRef.current
      ) {
        const attempt = reconnectAttemptRef.current;
        const delay = RECONNECT_DELAYS[attempt] ?? RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1];
        reconnectAttemptRef.current++;
        isReconnectRef.current = true;
        setReconnectInfo(`Reconnecting (${reconnectAttemptRef.current}/${MAX_RECONNECTS})...`);
        console.log(`[Dave] Auto-reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})`);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = undefined;
          if (isOpenRef.current) startConversationRef.current?.();
        }, delay);
      }
    },
    onMessage: (message: any) => {
      console.log('[Dave] Message:', message?.type, message);
      if (message?.type === 'user_transcript' && message?.user_transcription_event?.user_transcript) {
        const text = message.user_transcription_event.user_transcript;
        setTranscript(prev => [...prev, { role: 'user', text }]);
        addUserMessage(text);

        const lower = text.toLowerCase();
        if (DISMISSAL_PHRASES.some(p => lower.includes(p))) {
          setTimeout(() => endConversation(), 1500);
        }
      } else if (message?.type === 'agent_response' && message?.agent_response_event?.agent_response) {
        if (greetingWatchdogRef.current) { clearTimeout(greetingWatchdogRef.current); greetingWatchdogRef.current = undefined; }
        const text = message.agent_response_event.agent_response;
        setTranscript(prev => [...prev, { role: 'agent', text }]);
        addDaveResponse(text);
      }
    },
    onError: (err: any) => {
      console.error('[Dave] Error:', err);
      const msg = err?.message || String(err);
      if (/NotAllowedError|Permission denied/i.test(msg)) {
        setError('Microphone access required — check your browser settings');
      } else if (/NotFoundError|no audio/i.test(msg)) {
        setError('No microphone found');
      } else {
        setError('Connection error. Tap to retry.');
      }
      toast.error('Dave connection error');
    },
    onVadScore: (score: number) => {
      setVadActive(score > 0.5);
    },
  } as any);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Volume-reactive orb animation
  useEffect(() => {
    if (conversation.status !== 'connected') return;
    const animate = () => {
      const orb = orbRef.current;
      if (!orb) return;
      const vol = Math.max(conversation.getInputVolume(), conversation.getOutputVolume());
      orb.style.transform = `scale(${1 + vol * 0.5})`;
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [conversation.status, conversation]);

  const startConversation = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setIsConnecting(true);
    setError(null);

    if (!isReconnectRef.current) {
      setTranscript([]);
    }

    const timeout = setTimeout(() => {
      if (startingRef.current) {
        setError('Connection timed out. Tap to retry.');
        setIsConnecting(false);
        startingRef.current = false;
        try { conversation.endSession(); } catch (_) {}
      }
    }, 15000);

    try {
      // For reconnects, fetch fresh session with conversation history
      // For initial connect, use the pre-fetched sessionData from props
      let url = sessionDataRef.current.signed_url;
      if (isReconnectRef.current) {
        const history = getConversationContext();
        const freshSession = await getSession(history);
        sessionDataRef.current = freshSession;
        url = freshSession.signed_url;
        // NOTE: on reconnect, overrides won't update because useConversation
        // was initialized with the original props. The component will need
        // to be re-mounted (via key change in Layout) for new overrides.
        // The sendContextualUpdate in onConnect serves as the fallback here.
      }

      // ─── CLEAN: startSession only needs the signedUrl ───
      console.log('[Dave] Starting session with signed URL | context:', sessionDataRef.current.context?.length, 'chars');
      await conversation.startSession({ signedUrl: url });

      console.log('[Dave] Session started successfully');
      clearTimeout(timeout);
    } catch (err: any) {
      clearTimeout(timeout);
      console.error('[Dave] Failed to start:', err);

      if (isReconnectRef.current) {
        console.log('[Dave] Reconnect failed, invalidating cache...');
        invalidateCache();
      }

      setError(err.message || 'Failed to connect');
      toast.error('Could not start conversation', { description: err.message });
    } finally {
      setIsConnecting(false);
      startingRef.current = false;
      isReconnectRef.current = false;
      setReconnectInfo(null);
    }
  }, [conversation, getSession, invalidateCache, getConversationContext]);

  useEffect(() => {
    startConversationRef.current = startConversation;
  }, [startConversation]);

  const sessionStartRef = useRef<number>(Date.now());

  const endConversation = useCallback(async () => {
    reconnectAttemptRef.current = MAX_RECONNECTS;
    clearReconnectTimer();
    if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current);

    const currentTranscript = transcriptRef.current;
    if (currentTranscript.length > 0) {
      const durationSeconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await (supabase.from('dave_transcripts' as any) as any).insert({
            user_id: user.id,
            messages: currentTranscript as any,
            duration_seconds: durationSeconds,
          });
        }
      } catch (err) {
        console.error('[Dave] Failed to save transcript:', err);
      }
    }

    await conversation.endSession();
    onClose();
  }, [conversation, onClose, clearReconnectTimer]);

  // Detect desktop to auto-start without tap
  useEffect(() => {
    const isDesktop = navigator.maxTouchPoints === 0;
    if (isDesktop && !startingRef.current) {
      setNeedsTap(false);
      reconnectAttemptRef.current = 0;
      isReconnectRef.current = false;
      startConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      reconnectAttemptRef.current = MAX_RECONNECTS;
      clearReconnectTimer();
      if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current);
      if (conversation.status === 'connected') {
        conversation.endSession();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isOpen) return null;

  const isConnected = conversation.status === 'connected';
  const isSpeaking = conversation.isSpeaking;

  const orbColor = !isConnected
    ? 'bg-amber-500/30'
    : isSpeaking
    ? 'bg-blue-500/40'
    : vadActive
    ? 'bg-emerald-400/40'
    : 'bg-emerald-500/30';

  const orbGlow = !isConnected
    ? 'shadow-[0_0_60px_20px_rgba(245,158,11,0.3)]'
    : isSpeaking
    ? 'shadow-[0_0_80px_30px_rgba(59,130,246,0.4)]'
    : vadActive
    ? 'shadow-[0_0_80px_30px_rgba(16,185,129,0.5)]'
    : 'shadow-[0_0_60px_20px_rgba(16,185,129,0.3)]';

  const statusText = reconnectInfo
    ? reconnectInfo
    : isConnecting
    ? 'Connecting...'
    : !isConnected
    ? error || 'Disconnected'
    : isSpeaking
    ? 'Dave is speaking'
    : vadActive
    ? 'Hearing you...'
    : 'Listening...';

  const statusIcon = reconnectInfo ? (
    <RefreshCw className="h-5 w-5 animate-spin" />
  ) : isConnecting ? (
    <Loader2 className="h-5 w-5 animate-spin" />
  ) : isSpeaking ? (
    <Volume2 className="h-5 w-5 animate-pulse" />
  ) : isConnected ? (
    <Mic className="h-5 w-5" />
  ) : (
    <MicOff className="h-5 w-5" />
  );

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center"
      >
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={endConversation}
          className="absolute right-4 z-10 h-12 w-12 rounded-full bg-white/10 flex items-center justify-center text-white/80 hover:bg-white/20 transition-colors"
          style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
        >
          <X className="h-6 w-6" />
        </motion.button>

        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className="absolute left-4 z-10 h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:bg-white/20"
          style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
        >
          <MessageSquare className="h-4 w-4" />
        </button>

        <div className="flex-1 flex items-center justify-center w-full">
          {needsTap && !isConnecting && !isConnected ? (
            <button
              onClick={() => {
                setNeedsTap(false);
                reconnectAttemptRef.current = 0;
                isReconnectRef.current = false;
                startConversation();
              }}
              className="flex flex-col items-center gap-4"
            >
              <div
                className={cn(
                  'w-40 h-40 rounded-full transition-colors duration-700',
                  'bg-emerald-500/30',
                  'shadow-[0_0_60px_20px_rgba(16,185,129,0.3)]',
                )}
              />
              <span className="text-white/60 text-sm">Tap to talk</span>
            </button>
          ) : (
            <div
              ref={orbRef}
              className={cn(
                'w-40 h-40 rounded-full transition-colors duration-700',
                orbColor,
                orbGlow,
              )}
              style={{ transition: 'transform 0.05s linear, background-color 0.7s, box-shadow 0.7s' }}
            />
          )}
        </div>

        <div className="flex flex-col items-center gap-3 pb-8" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
          <div className="flex items-center gap-2 text-white/70 text-sm">
            {statusIcon}
            <span>{statusText}</span>
          </div>

          {error && !isConnecting && !reconnectInfo && (
            <button
              onClick={() => { reconnectAttemptRef.current = 0; isReconnectRef.current = false; invalidateCache(); startConversation(); }}
              className="px-4 py-2 bg-white/10 rounded-full text-white/80 text-sm hover:bg-white/20"
            >
              Tap to retry
            </button>
          )}
        </div>

        <AnimatePresence>
          {showTranscript && (
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="absolute bottom-0 left-0 right-0 max-h-[50vh] bg-black/90 backdrop-blur border-t border-white/10 rounded-t-2xl overflow-hidden"
            >
              <div className="p-4 overflow-y-auto max-h-[calc(50vh-2rem)]">
                <p className="text-white/40 text-xs mb-3 uppercase tracking-wider">Conversation</p>
                {transcript.length === 0 && (
                  <p className="text-white/30 text-sm italic">Waiting for conversation...</p>
                )}
                {transcript.map((msg, i) => (
                  <div key={i} className={cn('mb-2 text-sm', msg.role === 'user' ? 'text-emerald-400' : 'text-blue-300')}>
                    <span className="text-white/40 text-xs mr-1">{msg.role === 'user' ? 'You' : 'Dave'}:</span>
                    {msg.text}
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

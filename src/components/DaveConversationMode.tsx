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
import { DaveDiagnosticsPanel, type DiagnosticData } from './dave/DaveDiagnosticsPanel';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sessionData: DaveSessionData;
}

const DISMISSAL_PHRASES = [
  "we're done", "we are done", "thanks dave", "thank you dave",
  "goodbye", "that's all", "thats all", "bye dave", "see you",
];

const MAX_RECONNECTS = 2;
const RECONNECT_DELAYS = [2000, 5000];
const STABILITY_WINDOW_MS = 3000;
const GREETING_WARN_MS = 8000;
const GREETING_RETRY_MS = 12000;

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
  const [vadScore, setVadScore] = useState(0);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const startingRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const startConversationRef = useRef<() => Promise<void>>();
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const messageReceivedRef = useRef(false);
  const messagesReceivedCountRef = useRef(0);
  const lastMessageTypeRef = useRef<string | null>(null);
  const lastMessageAtRef = useRef<number | null>(null);
  const errorHistoryRef = useRef<string[]>([]);

  // Diagnostics state
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const diagTapCountRef = useRef(0);
  const diagTapTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [healthCheck, setHealthCheck] = useState<{ apiKey: boolean; agentId: boolean; tokenOk: boolean } | null>(null);
  const [greetingStatus, setGreetingStatus] = useState<'waiting' | 'received' | 'timeout' | 'retrying'>('waiting');
  const greetingRetryDoneRef = useRef(false);

  // Refs for stale closure fixes
  const isOpenRef = useRef(isOpen);
  const transcriptRef = useRef(transcript);
  const sessionDataRef = useRef<DaveSessionData>(sessionData);
  const isReconnectRef = useRef(false);
  const connectedAtRef = useRef<number>(0);
  const stabilityTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const greetingWatchdogRef = useRef<ReturnType<typeof setTimeout>>();
  const greetingRetryRef = useRef<ReturnType<typeof setTimeout>>();

  const logStatus = useCallback((msg: string) => {
    const ts = new Date().toISOString().substring(11, 23);
    const entry = `[${ts}] ${msg}`;
    console.log(`[Dave] ${msg}`);
    setStatusLog(prev => [...prev.slice(-9), entry]);
  }, []);

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

  // Triple-tap status text to toggle diagnostics
  const handleStatusTap = useCallback(() => {
    diagTapCountRef.current++;
    if (diagTapTimerRef.current) clearTimeout(diagTapTimerRef.current);
    if (diagTapCountRef.current >= 3) {
      diagTapCountRef.current = 0;
      setShowDiagnostics(prev => !prev);
    } else {
      diagTapTimerRef.current = setTimeout(() => { diagTapCountRef.current = 0; }, 600);
    }
  }, []);

  // Run health check on first diagnostics open
  useEffect(() => {
    if (!showDiagnostics || healthCheck) return;
    supabase.functions.invoke('dave-health-check').then(({ data }) => {
      if (data) {
        setHealthCheck({
          apiKey: data.apiKeyValid,
          agentId: data.agentIdSet,
          tokenOk: data.tokenGenOk,
        });
      }
    }).catch(() => {});
  }, [showDiagnostics, healthCheck]);

  // ─── useConversation — overrides go HERE, NOT in startSession ───
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
      logStatus(`✅ Connected via WebRTC — context: ${sessionDataRef.current?.context?.length} chars, firstMessage: ${sessionDataRef.current?.firstMessage?.substring(0, 80)}`);
      messageReceivedRef.current = false;
      messagesReceivedCountRef.current = 0;
      setError(null);
      setReconnectInfo(null);
      setIsConnecting(false);
      connectedAtRef.current = Date.now();
      setGreetingStatus('waiting');

      if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current);
      stabilityTimerRef.current = setTimeout(() => {
        reconnectAttemptRef.current = 0;
      }, STABILITY_WINDOW_MS);

      // Greeting watchdog: warn at 8s, auto-retry at 12s
      if (greetingWatchdogRef.current) clearTimeout(greetingWatchdogRef.current);
      if (greetingRetryRef.current) clearTimeout(greetingRetryRef.current);

      greetingWatchdogRef.current = setTimeout(() => {
        if (!messageReceivedRef.current && isOpenRef.current) {
          logStatus('⚠️ No greeting after 8s — agent may not have overrides enabled');
          setGreetingStatus('timeout');
          toast.warning('Dave connected but isn\'t responding', {
            description: 'Retrying with a fresh connection...',
            duration: 4000,
          });
        }
      }, GREETING_WARN_MS);

      greetingRetryRef.current = setTimeout(() => {
        if (!messageReceivedRef.current && isOpenRef.current && !greetingRetryDoneRef.current) {
          logStatus('🔄 Greeting timeout — auto-retrying with fresh token');
          greetingRetryDoneRef.current = true;
          setGreetingStatus('retrying');
          try { conversation.endSession(); } catch (_) {}
          invalidateCache();
          isReconnectRef.current = true;
          setTimeout(() => startConversationRef.current?.(), 1000);
        }
      }, GREETING_RETRY_MS);
    },
    onDisconnect: () => {
      const uptime = connectedAtRef.current ? Date.now() - connectedAtRef.current : 0;
      logStatus(`❌ Disconnected (uptime: ${uptime}ms, messagesReceived: ${messageReceivedRef.current})`);
      if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current);
      if (greetingWatchdogRef.current) clearTimeout(greetingWatchdogRef.current);
      if (greetingRetryRef.current) clearTimeout(greetingRetryRef.current);

      if (uptime > 0 && uptime < 2000) {
        logStatus('⚠️ Immediate disconnect — likely transport or auth issue');
        setError('Connection dropped immediately. Tap to retry.');
      }

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
        logStatus(`Auto-reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})`);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = undefined;
          if (isOpenRef.current) startConversationRef.current?.();
        }, delay);
      } else if (isOpenRef.current && reconnectAttemptRef.current >= MAX_RECONNECTS && !error) {
        if (greetingRetryDoneRef.current && !messageReceivedRef.current) {
          setError('Dave\'s voice agent may need configuration — ensure "System prompt override" and "First message override" are enabled in ElevenLabs.');
        } else {
          setError('Connection lost. Tap to retry.');
        }
      }
    },
    onMessage: (message: any) => {
      messageReceivedRef.current = true;
      messagesReceivedCountRef.current++;
      lastMessageTypeRef.current = message?.type || 'unknown';
      lastMessageAtRef.current = Date.now();
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
        if (greetingRetryRef.current) { clearTimeout(greetingRetryRef.current); greetingRetryRef.current = undefined; }
        setGreetingStatus('received');
        const text = message.agent_response_event.agent_response;
        setTranscript(prev => [...prev, { role: 'agent', text }]);
        addDaveResponse(text);
      }
    },
    onError: (err: any) => {
      const msg = err?.message || String(err);
      logStatus(`🔴 Error: ${msg}`);
      errorHistoryRef.current = [...errorHistoryRef.current.slice(-4), msg];
      console.error('[Dave] Full error object:', err);
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
      setVadScore(score);
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
    setGreetingStatus('waiting');

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
      let currentToken = sessionDataRef.current.token;
      if (isReconnectRef.current) {
        const history = getConversationContext();
        const freshSession = await getSession(history);
        sessionDataRef.current = freshSession;
        currentToken = freshSession.token;
      }

      logStatus(`Starting session (WebRTC) | context: ${sessionDataRef.current.context?.length} chars`);
      await conversation.startSession({
        conversationToken: currentToken,
        connectionType: 'webrtc',
      } as any);

      logStatus('Session started successfully');
      clearTimeout(timeout);
    } catch (err: any) {
      clearTimeout(timeout);
      console.error('[Dave] Failed to start:', err);

      if (isReconnectRef.current) {
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
    if (greetingWatchdogRef.current) clearTimeout(greetingWatchdogRef.current);
    if (greetingRetryRef.current) clearTimeout(greetingRetryRef.current);

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
      greetingRetryDoneRef.current = false;
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
      if (greetingWatchdogRef.current) clearTimeout(greetingWatchdogRef.current);
      if (greetingRetryRef.current) clearTimeout(greetingRetryRef.current);
      if (conversation.status === 'connected') {
        conversation.endSession();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Diagnostics data
  const diagnosticData: DiagnosticData = {
    connectionStatus: conversation.status,
    uptimeMs: connectedAtRef.current ? Date.now() - connectedAtRef.current : 0,
    contextSize: sessionDataRef.current?.context?.length || 0,
    firstMessageSet: !!sessionDataRef.current?.firstMessage,
    messagesReceived: messagesReceivedCountRef.current,
    lastMessageType: lastMessageTypeRef.current,
    lastMessageAt: lastMessageAtRef.current,
    vadScore,
    errorHistory: errorHistoryRef.current,
    healthCheck,
    greetingStatus,
  };

  if (!isOpen) return null;

  const isConnected = conversation.status === 'connected';
  const isSpeaking = conversation.isSpeaking;
  const vadActive = vadScore > 0.5;

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

        <DaveDiagnosticsPanel visible={showDiagnostics} data={diagnosticData} />

        <div className="flex-1 flex items-center justify-center w-full">
          {needsTap && !isConnecting && !isConnected ? (
            <button
              onClick={() => {
                setNeedsTap(false);
                reconnectAttemptRef.current = 0;
                isReconnectRef.current = false;
                greetingRetryDoneRef.current = false;
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
          <button
            onClick={handleStatusTap}
            className="flex items-center gap-2 text-white/70 text-sm bg-transparent border-none cursor-pointer"
          >
            {statusIcon}
            <span>{statusText}</span>
          </button>

          {error && !isConnecting && !reconnectInfo && (
            <button
              onClick={() => { reconnectAttemptRef.current = 0; isReconnectRef.current = false; greetingRetryDoneRef.current = false; invalidateCache(); startConversation(); }}
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

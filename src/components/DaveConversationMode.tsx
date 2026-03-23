import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import type { Json } from '@/integrations/supabase/types';
import { useConversation } from '@elevenlabs/react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mic, MicOff, Volume2, MessageSquare, Loader2, Minimize2, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type DaveSessionData } from '@/hooks/useDaveContext';
import { useDaveConversation } from '@/hooks/useDaveConversation';
import { useCopilot } from '@/contexts/CopilotContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { createClientTools } from './dave/clientTools';
import { DaveDiagnosticsPanel, type DiagnosticData } from './dave/DaveDiagnosticsPanel';
import { classifyMicrophoneAccessError, releaseMicrophoneStream, requestMicrophoneAccess } from '@/lib/microphoneAccess';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onRetry: () => void;
  sessionData: DaveSessionData;
  minimized?: boolean;
  onMinimize?: () => void;
  /** Mic stream pre-acquired during user gesture (mobile). Enables auto-start without second tap. */
  preacquiredMicStream?: MediaStream | null;
}

const DISMISSAL_PHRASES = [
  "we're done", "we are done", "thanks dave", "thank you dave",
  "goodbye", "that's all", "thats all", "bye dave", "see you",
];

const GREETING_WARN_MS = 8000;
const GREETING_RETRY_MS = 12000;

function assertSessionContract(session: DaveSessionData): string | null {
  if (!session.token || session.token.length < 10) {
    return 'No valid token — token fetch may have failed.';
  }
  if (!session.context || session.context.length < 500) {
    return `Context too short (${session.context?.length || 0} chars). Dave's instructions are ~1200+ chars — context assembly likely failed.`;
  }
  if (!session.context.includes('DAVE')) {
    return 'Context missing DAVE identity instructions — Dave would connect as a generic assistant.';
  }
  if (!session.firstMessage || session.firstMessage.length < 10) {
    return `firstMessage missing or too short ("${session.firstMessage || ''}"). Dave won't greet you.`;
  }
  return null;
}

export function DaveConversationMode({ isOpen, onClose, onRetry, sessionData, minimized = false, onMinimize, preacquiredMicStream }: Props) {
  const navigate = useNavigate();
  const { ask: askCopilot } = useCopilot();
  const { addUserMessage, addDaveResponse } = useDaveConversation();
  const [isConnecting, setIsConnecting] = useState(false);
  const [needsTap, setNeedsTap] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ role: 'user' | 'agent'; text: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [vadScore, setVadScore] = useState(0);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const startingRef = useRef(false);
  const messageReceivedRef = useRef(false);
  const messagesReceivedCountRef = useRef(0);
  const lastMessageTypeRef = useRef<string | null>(null);
  const lastMessageAtRef = useRef<number | null>(null);
  const errorHistoryRef = useRef<string[]>([]);

  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const diagTapCountRef = useRef(0);
  const diagTapTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [healthCheck, setHealthCheck] = useState<{ apiKey: boolean; agentId: boolean; tokenOk: boolean; overridesEnabled?: boolean | null } | null>(null);
  const [greetingStatus, setGreetingStatus] = useState<'waiting' | 'received' | 'timeout' | 'retrying'>('waiting');

  const isOpenRef = useRef(isOpen);
  const transcriptRef = useRef(transcript);
  const connectedAtRef = useRef<number>(0);
  const greetingWatchdogRef = useRef<ReturnType<typeof setTimeout>>();
  const greetingRetryRef = useRef<ReturnType<typeof setTimeout>>();
  const preflightStreamRef = useRef<MediaStream | null>(null);

  const logStatus = useCallback((msg: string) => {
    const ts = new Date().toISOString().substring(11, 23);
    const entry = `[${ts}] ${msg}`;
    console.log(`[Dave] ${msg}`);
    setStatusLog(prev => [...prev.slice(-9), entry]);
  }, []);

  const releasePreflightStream = useCallback(() => {
    releaseMicrophoneStream(preflightStreamRef.current);
    preflightStreamRef.current = null;
  }, []);

  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  const clientTools = useMemo(
    () => createClientTools(navigate, askCopilot),
    [navigate, askCopilot],
  );

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

  useEffect(() => {
    if (!showDiagnostics || healthCheck) return;
    trackedInvoke<any>('dave-health-check').then(({ data }) => {
      if (data) {
        setHealthCheck({
          apiKey: data.apiKeyValid,
          agentId: data.agentIdSet,
          tokenOk: data.tokenGenOk,
          overridesEnabled: data.overridesEnabled,
        });
      }
    }).catch(() => {});
  }, [showDiagnostics, healthCheck]);

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
      logStatus(`✅ Connected — context: ${sessionData.context?.length} chars, firstMessage: "${sessionData.firstMessage?.substring(0, 60)}..."`);
      releasePreflightStream();
      messageReceivedRef.current = false;
      messagesReceivedCountRef.current = 0;
      setError(null);
      setIsConnecting(false);
      connectedAtRef.current = Date.now();
      setGreetingStatus('waiting');

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
        if (!messageReceivedRef.current && isOpenRef.current) {
          logStatus('🔄 Greeting timeout — requesting retry-via-remount');
          setGreetingStatus('retrying');
          try { conversation.endSession(); } catch (_) {}
          onRetry();
        }
      }, GREETING_RETRY_MS);
    },
    onDisconnect: () => {
      releasePreflightStream();
      const uptime = connectedAtRef.current ? Date.now() - connectedAtRef.current : 0;
      logStatus(`❌ Disconnected (uptime: ${uptime}ms, msgs: ${messagesReceivedCountRef.current})`);
      if (greetingWatchdogRef.current) clearTimeout(greetingWatchdogRef.current);
      if (greetingRetryRef.current) clearTimeout(greetingRetryRef.current);

      if (uptime > 0 && uptime < 2000 && isOpenRef.current) {
        logStatus('⚠️ Immediate disconnect — likely transport or auth issue');
        setError('Connection dropped immediately. Tap to retry.');
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
      releasePreflightStream();
      const friendlyMessage = classifyMicrophoneAccessError(err);
      setError(friendlyMessage);
      toast.error('Dave connection error', { description: friendlyMessage });
    },
    onVadScore: (score: number) => {
      setVadScore(score);
    },
  } as any);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

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
    setTranscript([]);

    const contractError = assertSessionContract(sessionData);
    if (contractError) {
      logStatus(`🚫 CONTRACT FAIL: ${contractError}`);
      setError(contractError);
      setIsConnecting(false);
      startingRef.current = false;
      toast.error('Dave session invalid', { description: contractError, duration: 8000 });
      return;
    }

    logStatus(`✅ Contract passed — token: ${sessionData.token.length} chars, context: ${sessionData.context.length} chars, firstMessage: "${sessionData.firstMessage?.substring(0, 50)}"`);

    const isMobile = navigator.maxTouchPoints > 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      // On mobile, request mic permission explicitly to unlock audio context
      if (isMobile) {
        logStatus('🎤 Requesting microphone access (mobile)');
        releasePreflightStream();
        try {
          preflightStreamRef.current = await requestMicrophoneAccess();
          logStatus('🎤 Microphone access granted');
        } catch (micErr: any) {
          const friendlyMessage = classifyMicrophoneAccessError(micErr);
          logStatus(`🔴 Mic permission failed: ${friendlyMessage}`);
          setError(friendlyMessage);
          setIsConnecting(false);
          startingRef.current = false;
          toast.error('Microphone access required', { description: friendlyMessage, duration: 6000 });
          return;
        }
      }

      timeout = setTimeout(() => {
        if (startingRef.current) {
          logStatus('⏰ Connection timed out after 15s');
          setError('Connection timed out. Tap Retry to try again.');
          setIsConnecting(false);
          startingRef.current = false;
          try { conversation.endSession(); } catch (_) {}
          releasePreflightStream();
        }
      }, 15000);

      logStatus(`Starting session (WebRTC) | context: ${sessionData.context.length} chars`);
      await conversation.startSession({
        conversationToken: sessionData.token,
        connectionType: 'webrtc',
      } as any);

      logStatus('Session started successfully');
      if (timeout) clearTimeout(timeout);
    } catch (err: any) {
      if (timeout) clearTimeout(timeout);
      const rawMsg = err?.message || String(err);
      console.error('[Dave] Failed to start:', err);

      // Classify the startup error specifically
      let friendlyMessage: string;
      if (/NotAllowedError|Permission denied|microphone/i.test(rawMsg)) {
        friendlyMessage = classifyMicrophoneAccessError(err);
      } else if (/token|auth|unauthorized|403|401/i.test(rawMsg)) {
        friendlyMessage = 'Session token expired or invalid. Tap Retry for a fresh session.';
      } else if (/network|fetch|connect|socket|WebSocket/i.test(rawMsg)) {
        friendlyMessage = 'Network error connecting to voice service. Check your connection and retry.';
      } else if (/aborted|abort/i.test(rawMsg)) {
        friendlyMessage = 'Connection was cancelled. Tap Retry to try again.';
      } else {
        friendlyMessage = `Voice startup failed: ${rawMsg}`;
      }

      setError(friendlyMessage);
      toast.error('Dave startup failed', { description: friendlyMessage, duration: 6000 });
    } finally {
      releasePreflightStream();
      setIsConnecting(false);
      startingRef.current = false;
    }
  }, [conversation, sessionData, logStatus, releasePreflightStream]);

  const sessionStartRef = useRef<number>(Date.now());

  const endConversation = useCallback(async () => {
    if (greetingWatchdogRef.current) clearTimeout(greetingWatchdogRef.current);
    if (greetingRetryRef.current) clearTimeout(greetingRetryRef.current);

    const currentTranscript = transcriptRef.current;
    if (currentTranscript.length > 0) {
      const durationSeconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('dave_transcripts').insert({
            user_id: user.id,
            messages: currentTranscript as unknown as Json,
            duration_seconds: durationSeconds,
          });
        }
      } catch (err) {
        console.error('[Dave] Failed to save transcript:', err);
      }
    }

    await conversation.endSession();
    onClose();
  }, [conversation, onClose]);

  useEffect(() => {
    const isDesktop = navigator.maxTouchPoints === 0;
    if (isDesktop && !startingRef.current) {
      setNeedsTap(false);
      startConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (greetingWatchdogRef.current) clearTimeout(greetingWatchdogRef.current);
      if (greetingRetryRef.current) clearTimeout(greetingRetryRef.current);
      releasePreflightStream();
      if (conversation.status === 'connected') {
        conversation.endSession();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasInstructions = (sessionData.context || '').includes('DAVE');
  const diagnosticData: DiagnosticData = {
    connectionStatus: conversation.status,
    uptimeMs: connectedAtRef.current ? Date.now() - connectedAtRef.current : 0,
    contextSize: sessionData.context?.length || 0,
    contextPreview: sessionData.context?.substring(0, 200) || '',
    firstMessagePreview: sessionData.firstMessage || '',
    firstMessageSet: !!sessionData.firstMessage,
    hasInstructions,
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

  const statusText = isConnecting
    ? 'Connecting...'
    : !isConnected
    ? error || 'Disconnected'
    : isSpeaking
    ? 'Dave is speaking'
    : vadActive
    ? 'Hearing you...'
    : 'Listening...';

  const statusIcon = isConnecting ? (
    <Loader2 className="h-5 w-5 animate-spin" />
  ) : isSpeaking ? (
    <Volume2 className="h-5 w-5 animate-pulse" />
  ) : isConnected ? (
    <Mic className="h-5 w-5" />
  ) : (
    <MicOff className="h-5 w-5" />
  );

  // ─── MINIMIZED ORB ───
  if (minimized) {
    return (
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        onClick={onMinimize}
        className={cn(
          'fixed bottom-28 right-4 z-50 w-14 h-14 rounded-full flex items-center justify-center',
          'border border-border/50 backdrop-blur-xl',
          isConnected ? 'bg-emerald-500/20' : 'bg-amber-500/20',
          isConnected && 'shadow-[0_0_24px_8px_rgba(16,185,129,0.25)]',
        )}
      >
        <div
          ref={orbRef}
          className={cn(
            'w-10 h-10 rounded-full transition-colors duration-700',
            orbColor,
          )}
          style={{ transition: 'transform 0.05s linear, background-color 0.7s' }}
        />
        {isSpeaking && (
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-blue-400/50"
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
      </motion.button>
    );
  }

  // ─── EXPANDED FLOATING PANEL ───
  return (
    <AnimatePresence>
      <motion.div
        data-testid="dave-panel"
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        className="fixed bottom-28 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'min(420px, calc(100vh - 10rem))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
          <div className="flex items-center gap-2">
            <div className={cn(
              'w-2.5 h-2.5 rounded-full',
              isConnected ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-amber-500',
            )} />
            <span className="text-xs font-display font-bold text-foreground">Dave</span>
            <span className="text-[10px] text-muted-foreground">
              {isConnecting ? 'connecting...' : isConnected ? (isSpeaking ? 'speaking' : vadActive ? 'hearing you' : 'listening') : 'offline'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {onMinimize && (
              <button onClick={onMinimize} className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                <Minimize2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={endConversation} className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Orb area */}
        <div className="flex items-center justify-center py-6 relative">
          {needsTap && !isConnecting && !isConnected ? (
            <button
              onClick={() => { setNeedsTap(false); startConversation(); }}
              className="flex flex-col items-center gap-2"
            >
              <div className={cn('w-20 h-20 rounded-full bg-emerald-500/30 shadow-[0_0_40px_12px_rgba(16,185,129,0.2)]')} />
              <span className="text-muted-foreground text-xs">Tap to talk</span>
            </button>
          ) : (
            <div
              ref={!minimized ? orbRef : undefined}
              className={cn('w-20 h-20 rounded-full transition-colors duration-700', orbColor, orbGlow)}
              style={{ transition: 'transform 0.05s linear, background-color 0.7s, box-shadow 0.7s' }}
            />
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-center gap-2 px-3 pb-2">
          <button
            onClick={handleStatusTap}
            className="flex items-center gap-1.5 text-muted-foreground text-xs"
          >
            {statusIcon}
            <span>{statusText}</span>
          </button>
          {error && !isConnecting && (
            <button onClick={onRetry} className="text-xs text-primary hover:underline">
              Retry
            </button>
          )}
        </div>

        {/* Transcript */}
        <div className="flex-1 min-h-0 border-t border-border/30 overflow-y-auto px-3 py-2 max-h-[180px]">
          {transcript.length === 0 ? (
            <p className="text-muted-foreground text-xs italic text-center py-4">Waiting for conversation...</p>
          ) : (
            transcript.map((msg, i) => (
              <div key={i} className={cn('mb-1.5 text-xs', msg.role === 'user' ? 'text-emerald-400' : 'text-blue-300')}>
                <span className="text-muted-foreground text-[10px] mr-1">{msg.role === 'user' ? 'You' : 'Dave'}:</span>
                {msg.text}
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>

        <DaveDiagnosticsPanel visible={showDiagnostics} data={diagnosticData} />
      </motion.div>
    </AnimatePresence>
  );
}

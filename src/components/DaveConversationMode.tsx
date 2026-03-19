import { useState, useCallback, useEffect, useRef } from 'react';
import { useConversation } from '@elevenlabs/react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mic, MicOff, Volume2, MessageSquare, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDaveContext } from '@/hooks/useDaveContext';
import { useCopilot } from '@/contexts/CopilotContext';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function DaveConversationMode({ isOpen, onClose }: Props) {
  const navigate = useNavigate();
  const { ask: askCopilot } = useCopilot();
  const { fetchSession } = useDaveContext();
  const [isConnecting, setIsConnecting] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ role: 'user' | 'agent'; text: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);

  const conversation = useConversation({
    clientTools: {
      navigate: (params: { path: string }) => {
        navigate(params.path);
        return `Navigated to ${params.path}`;
      },
      create_task: (params: { title: string; priority?: string; accountName?: string }) => {
        window.dispatchEvent(new CustomEvent('voice-create-task', { detail: params }));
        toast.success('Task created', { description: params.title });
        return `Task created: ${params.title}`;
      },
      open_copilot: (params: { question: string; mode?: string }) => {
        askCopilot(params.question, (params.mode as any) || 'quick');
        return `Opened copilot with: ${params.question}`;
      },
      prep_meeting: (params: { accountName?: string; meetingTitle?: string }) => {
        const q = params.accountName
          ? `Prep me for my meeting with ${params.accountName}${params.meetingTitle ? ` — ${params.meetingTitle}` : ''}`
          : 'Prep me for my next meeting';
        askCopilot(q, 'meeting');
        return `Preparing meeting brief`;
      },
      update_account: (params: { accountName: string; field: string; value: string }) => {
        window.dispatchEvent(new CustomEvent('voice-update-account', { detail: params }));
        toast.success('Account updated', { description: `${params.accountName}: ${params.field} → ${params.value}` });
        return `Updated ${params.accountName} ${params.field} to ${params.value}`;
      },
      update_opportunity: (params: { opportunityName: string; field: string; value: string }) => {
        window.dispatchEvent(new CustomEvent('voice-update-opportunity', { detail: params }));
        toast.success('Deal updated', { description: `${params.opportunityName}: ${params.field} → ${params.value}` });
        return `Updated ${params.opportunityName} ${params.field} to ${params.value}`;
      },
      start_roleplay: (params: { call_type?: string; difficulty?: number; industry?: string }) => {
        navigate('/coach');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('voice-start-roleplay', { detail: params }));
        }, 500);
        return `Launching ${params.call_type || 'discovery'} roleplay`;
      },
      start_drill: () => {
        navigate('/coach');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('voice-start-drill'));
        }, 500);
        return 'Opening objection drills';
      },
      grade_call: () => {
        navigate('/coach');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('voice-grade-call'));
        }, 500);
        return 'Grading latest transcript';
      },
      log_activity: () => {
        window.dispatchEvent(new CustomEvent('voice-quick-log'));
        return 'Opening quick log';
      },
      set_reminder: async (params: { message: string; minutes_from_now: number }) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return 'Not authenticated';
        const remindAt = new Date(Date.now() + params.minutes_from_now * 60 * 1000);
        await supabase.from('voice_reminders').insert({
          user_id: user.id,
          message: params.message,
          remind_at: remindAt.toISOString(),
        });
        return `Reminder set for ${params.minutes_from_now} minutes from now: ${params.message}`;
      },
      pipeline_pulse: async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return 'Not authenticated';
        const { data: opps } = await supabase
          .from('opportunities')
          .select('name, stage, arr, close_date')
          .eq('user_id', user.id)
          .not('status', 'eq', 'closed-lost');
        if (!opps?.length) return 'No active pipeline deals found.';
        const total = opps.reduce((s, o) => s + (o.arr || 0), 0);
        const summary = `You have ${opps.length} active deals worth $${Math.round(total / 1000)}k. ` +
          opps.slice(0, 5).map(o => `${o.name}: ${o.stage || 'no stage'}, $${Math.round((o.arr || 0) / 1000)}k`).join('. ');
        return summary;
      },
      daily_briefing: () => {
        askCopilot('Walk me through my day — priorities, meetings, risks, and what I should focus on', 'quick');
        return 'Building daily briefing in copilot';
      },
      debrief: (params: { accountName: string; keyTakeaways?: string; nextSteps?: string }) => {
        const detail = {
          accountName: params.accountName,
          takeaways: params.keyTakeaways,
          nextSteps: params.nextSteps,
        };
        window.dispatchEvent(new CustomEvent('voice-debrief', { detail }));
        toast.success('Debrief logged', { description: params.accountName });
        return `Debrief captured for ${params.accountName}`;
      },
      add_note: (params: { accountName: string; note: string }) => {
        window.dispatchEvent(new CustomEvent('voice-add-note', { detail: params }));
        toast.success('Note added', { description: `${params.accountName}: ${params.note.slice(0, 60)}...` });
        return `Note added to ${params.accountName}`;
      },
      draft_email: (params: { to: string; subject: string; body: string }) => {
        // Copy to clipboard for easy paste
        const emailText = `To: ${params.to}\nSubject: ${params.subject}\n\n${params.body}`;
        navigator.clipboard?.writeText(emailText).catch(() => {});
        toast.success('Email drafted & copied', { description: params.subject });
        return `Email drafted for ${params.to}: "${params.subject}". I've copied it to your clipboard.`;
      },
    },
    onConnect: () => {
      console.log('Dave connected');
      setError(null);
    },
    onDisconnect: () => {
      console.log('Dave disconnected');
    },
    onMessage: (message) => {
      if (message.type === 'user_transcript' && (message as any).user_transcription_event?.user_transcript) {
        setTranscript(prev => [...prev, { role: 'user', text: (message as any).user_transcription_event.user_transcript }]);
      } else if (message.type === 'agent_response' && (message as any).agent_response_event?.agent_response) {
        setTranscript(prev => [...prev, { role: 'agent', text: (message as any).agent_response_event.agent_response }]);
      }
    },
    onError: (error) => {
      console.error('Dave error:', error);
      setError('Connection error. Tap to retry.');
      toast.error('Dave connection error');
    },
  });

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

      const inputVol = conversation.getInputVolume();
      const outputVol = conversation.getOutputVolume();
      const vol = Math.max(inputVol, outputVol);
      const scale = 1 + vol * 0.5;
      orb.style.transform = `scale(${scale})`;
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [conversation.status, conversation]);

  const startConversation = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    setTranscript([]);

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const sessionData = await fetchSession();

      const overrides: any = {};
      if (sessionData.context) {
        overrides.agent = {
          prompt: {
            prompt: `DYNAMIC CONTEXT (current as of right now):\n${sessionData.context}\n\nUse this context to give informed, specific answers. Reference account names, meeting times, and deal values directly.`,
          },
        };
      }
      if (sessionData.firstMessage) {
        overrides.agent = {
          ...overrides.agent,
          firstMessage: sessionData.firstMessage,
        };
      }

      await conversation.startSession({
        conversationToken: sessionData.token,
        connectionType: 'webrtc',
        overrides: Object.keys(overrides).length ? overrides : undefined,
      } as any);
    } catch (err: any) {
      console.error('Failed to start Dave:', err);
      setError(err.message || 'Failed to connect');
      toast.error('Could not start conversation', { description: err.message });
    } finally {
      setIsConnecting(false);
    }
  }, [conversation, fetchSession]);

  const endConversation = useCallback(async () => {
    await conversation.endSession();
    onClose();
  }, [conversation, onClose]);

  // Auto-start when opened
  useEffect(() => {
    if (isOpen && conversation.status === 'disconnected' && !isConnecting) {
      startConversation();
    }
  }, [isOpen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (conversation.status === 'connected') {
        conversation.endSession();
      }
    };
  }, []);

  if (!isOpen) return null;

  const isConnected = conversation.status === 'connected';
  const isSpeaking = conversation.isSpeaking;

  // Orb color: green=listening, blue=speaking, amber=connecting
  const orbColor = !isConnected
    ? 'bg-amber-500/30'
    : isSpeaking
    ? 'bg-blue-500/40'
    : 'bg-emerald-500/30';

  const orbGlow = !isConnected
    ? 'shadow-[0_0_60px_20px_rgba(245,158,11,0.3)]'
    : isSpeaking
    ? 'shadow-[0_0_80px_30px_rgba(59,130,246,0.4)]'
    : 'shadow-[0_0_60px_20px_rgba(16,185,129,0.3)]';

  const statusText = isConnecting
    ? 'Connecting...'
    : !isConnected
    ? error || 'Disconnected'
    : isSpeaking
    ? 'Dave is speaking'
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

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center"
        onClick={(e) => {
          // Tap anywhere except buttons to dismiss — but only if connected
          if (e.target === e.currentTarget && isConnected) {
            // Don't auto-dismiss, let them use the X button
          }
        }}
      >
        {/* Close button */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={endConversation}
          className="absolute top-safe-top right-4 top-4 z-10 h-12 w-12 rounded-full bg-white/10 flex items-center justify-center text-white/80 hover:bg-white/20 transition-colors"
          style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
        >
          <X className="h-6 w-6" />
        </motion.button>

        {/* Transcript toggle */}
        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className="absolute top-4 left-4 z-10 h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:bg-white/20"
          style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
        >
          <MessageSquare className="h-4 w-4" />
        </button>

        {/* Visual Orb */}
        <div className="flex-1 flex items-center justify-center w-full">
          <div
            ref={orbRef}
            className={cn(
              'w-40 h-40 rounded-full transition-colors duration-700',
              orbColor,
              orbGlow,
            )}
            style={{ transition: 'transform 0.05s linear, background-color 0.7s, box-shadow 0.7s' }}
          />
        </div>

        {/* Status */}
        <div className="flex flex-col items-center gap-3 pb-8" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
          <div className="flex items-center gap-2 text-white/70 text-sm">
            {statusIcon}
            <span>{statusText}</span>
          </div>

          {/* Retry button on error */}
          {error && !isConnecting && (
            <button
              onClick={startConversation}
              className="px-4 py-2 bg-white/10 rounded-full text-white/80 text-sm hover:bg-white/20"
            >
              Tap to retry
            </button>
          )}
        </div>

        {/* Transcript Panel */}
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

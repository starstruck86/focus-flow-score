import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Loader2, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { useCopilot } from '@/contexts/CopilotContext';
import { useDaveConversation } from '@/hooks/useDaveConversation';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { CopilotMode } from '@/lib/territoryCopilot';

const COMMAND_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-command`;

interface VoiceCommand {
  action: string;
  question?: string;
  original_intent?: string;
  mode?: CopilotMode;
  title?: string;
  priority?: string;
  accountName?: string;
  opportunityName?: string;
  meetingTitle?: string;
  path?: string;
  type?: string;
  suggestion?: string;
  call_type?: string;
  difficulty?: number;
  industry?: string;
  field?: string;
  value?: string;
  dave_response?: string;
}

export function VoiceCommandButton({ size = 'default' }: { size?: 'default' | 'large' }) {
  const voice = useVoiceMode();
  const { ask: askCopilot } = useCopilot();
  const navigate = useNavigate();
  const dave = useDaveConversation();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showFeedback, setShowFeedback] = useState<string | null>(null);

  const executeCommand = useCallback(async (command: VoiceCommand) => {
    // Record Dave's response in conversation history
    const responseText = command.dave_response || command.question || command.suggestion || command.action;
    dave.addDaveResponse(responseText, command.action);

    switch (command.action) {
      case 'open_copilot':
        askCopilot(command.question || '', command.mode || 'quick');
        setShowFeedback(`🧠 "${command.question}"`);
        break;

      case 'create_task':
        window.dispatchEvent(new CustomEvent('voice-create-task', {
          detail: { title: command.title, priority: command.priority, accountName: command.accountName },
        }));
        setShowFeedback(`✅ Creating task: ${command.title}`);
        toast.success('Task created', { description: command.title });
        break;

      case 'navigate':
        if (command.path) {
          navigate(command.path);
          setShowFeedback(`📍 Navigating...`);
        }
        break;

      case 'log_activity':
        window.dispatchEvent(new CustomEvent('voice-quick-log'));
        setShowFeedback(`📝 Opening quick log...`);
        break;

      case 'start_roleplay':
        navigate('/coach');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('voice-start-roleplay', {
            detail: { call_type: command.call_type, difficulty: command.difficulty, industry: command.industry },
          }));
        }, 300);
        setShowFeedback(`⚔️ Starting ${command.call_type || 'discovery'} roleplay...`);
        toast.success('Roleplay launching', { description: `${command.call_type || 'Discovery'} call simulation` });
        break;

      case 'start_drill':
        navigate('/coach');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('voice-start-drill'));
        }, 300);
        setShowFeedback(`🛡️ Opening objection drills...`);
        break;

      case 'prep_meeting':
        if (command.accountName) {
          askCopilot(`Prep me for my upcoming meeting with ${command.accountName}${command.meetingTitle ? ` — ${command.meetingTitle}` : ''}`, 'meeting');
        } else {
          askCopilot('Prep me for my next meeting', 'meeting');
        }
        setShowFeedback(`📋 Preparing meeting brief...`);
        break;

      case 'update_account':
        if (command.accountName && command.field && command.value) {
          window.dispatchEvent(new CustomEvent('voice-update-account', {
            detail: { accountName: command.accountName, field: command.field, value: command.value },
          }));
          setShowFeedback(`✏️ Updating ${command.accountName}: ${command.field}`);
          toast.success('Account updated', { description: `${command.accountName} → ${command.field}: ${command.value}` });
        }
        break;

      case 'grade_call':
        navigate('/coach');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('voice-grade-call'));
        }, 300);
        setShowFeedback(`🎯 Grading latest transcript...`);
        break;

      case 'show_methodology':
        if (command.accountName) {
          window.dispatchEvent(new CustomEvent('voice-show-methodology', {
            detail: { accountName: command.accountName, opportunityName: command.opportunityName },
          }));
        }
        setShowFeedback(`📊 Opening methodology tracker...`);
        break;

      case 'daily_briefing':
        askCopilot('Walk me through my day — priorities, meetings, risks, and what I should focus on', 'quick');
        setShowFeedback(`☀️ Building your daily briefing...`);
        break;

      case 'clarify':
        setShowFeedback(`🤔 ${command.question}`);
        toast.info(command.question || "Could you give me more details?", { duration: 5000 });
        if (command.question) {
          try {
            await voice.playTTS(command.question);
          } catch { /* TTS optional */ }
        }
        break;

      case 'unknown':
        setShowFeedback(command.suggestion || "I didn't catch that. Try again?");
        toast.info(command.suggestion || "I didn't understand that command.");
        break;
    }

    setTimeout(() => setShowFeedback(null), command.action === 'clarify' ? 6000 : 3000);
  }, [askCopilot, navigate, voice, dave]);

  // Barge-in: if Dave is speaking and user taps mic, stop playback and start recording
  const handlePress = useCallback(async () => {
    // Barge-in support — interrupt Dave's TTS to speak
    if (voice.isPlaying) {
      voice.stopPlayback();
    }

    if (voice.isRecording) {
      try {
        const transcript = await voice.stopRecording();
        if (!transcript) return;

        // Record user message in conversation history
        dave.addUserMessage(transcript);
        setIsProcessing(true);
        setShowFeedback(`🎙 "${transcript}"`);

        const { data: { session } } = await supabase.auth.getSession();
        const conversationContext = dave.getConversationContext();
        
        const resp = await fetch(COMMAND_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ 
            transcript,
            conversationHistory: conversationContext || undefined,
            sessionId: dave.sessionId,
          }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Command failed' }));
          throw new Error(err.error || `Error ${resp.status}`);
        }

        const command: VoiceCommand = await resp.json();
        await executeCommand(command);
      } catch (err: any) {
        if (err.message !== 'Recording too short') {
          toast.error('Voice command failed', { description: err.message });
        }
        setShowFeedback(null);
      } finally {
        setIsProcessing(false);
      }
    } else {
      try {
        await voice.startRecording();
        setShowFeedback(null);
      } catch {
        // handled in hook
      }
    }
  }, [voice, executeCommand, dave]);

  const isActive = voice.isRecording || voice.isTranscribing || isProcessing;
  const isLarge = size === 'large';
  const hasHistory = dave.messageCount > 0;

  // Dave state label for accessibility and visual feedback
  const daveState = voice.isRecording
    ? 'listening'
    : voice.isTranscribing
    ? 'transcribing'
    : isProcessing
    ? 'thinking'
    : voice.isPlaying
    ? 'speaking'
    : 'idle';

  const stateLabel: Record<string, string> = {
    listening: '🎙 Listening...',
    transcribing: '✍️ Processing speech...',
    thinking: '🧠 Thinking...',
    speaking: '🔊 Dave is speaking',
    idle: '',
  };

  return (
    <div className="relative">
      <AnimatePresence>
        {(showFeedback || daveState !== 'idle') && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            className="absolute bottom-full mb-2 right-0 bg-popover border border-border rounded-lg px-3 py-2 shadow-lg max-w-[280px]"
          >
            {/* State indicator */}
            {daveState !== 'idle' && !showFeedback && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                {daveState === 'listening' && <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />}
                {daveState === 'thinking' && <Loader2 className="h-3 w-3 animate-spin" />}
                {daveState === 'speaking' && <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />}
                {stateLabel[daveState]}
              </p>
            )}
            {showFeedback && (
              <p className="text-xs text-foreground whitespace-pre-wrap">{showFeedback}</p>
            )}
            {hasHistory && (
              <p className="text-[10px] text-muted-foreground mt-1">
                💬 {dave.messageCount} messages in session
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handlePress}
        disabled={voice.isTranscribing || isProcessing}
        className={cn(
          "rounded-full flex items-center justify-center shadow-md transition-all relative",
          isLarge ? "h-14 w-14" : "h-10 w-10",
          voice.isRecording
            ? "bg-destructive text-destructive-foreground animate-pulse"
            : voice.isPlaying
            ? "bg-primary text-primary-foreground"
            : isProcessing || voice.isTranscribing
            ? "bg-primary/50 text-primary-foreground"
            : "bg-primary/10 hover:bg-primary/20 text-primary"
        )}
        title={
          voice.isPlaying ? "Tap to interrupt Dave"
            : voice.isRecording ? "Stop & process command"
            : "Voice command (Dave)"
        }
      >
        {isProcessing || voice.isTranscribing ? (
          <Loader2 className={cn("animate-spin", isLarge ? "h-6 w-6" : "h-4 w-4")} />
        ) : voice.isRecording ? (
          <MicOff className={cn(isLarge ? "h-6 w-6" : "h-4 w-4")} />
        ) : voice.isPlaying ? (
          <MessageCircle className={cn(isLarge ? "h-6 w-6" : "h-4 w-4", "animate-pulse")} />
        ) : (
          <Mic className={cn(isLarge ? "h-6 w-6" : "h-4 w-4")} />
        )}
        {/* Conversation indicator dot */}
        {hasHistory && !isActive && !voice.isPlaying && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
        )}
      </motion.button>
    </div>
  );
}

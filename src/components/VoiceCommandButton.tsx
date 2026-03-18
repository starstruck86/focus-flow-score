import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { useCopilot } from '@/contexts/CopilotContext';
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
}

export function VoiceCommandButton({ size = 'default' }: { size?: 'default' | 'large' }) {
  const voice = useVoiceMode();
  const { ask: askCopilot } = useCopilot();
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showFeedback, setShowFeedback] = useState<string | null>(null);

  const executeCommand = useCallback(async (command: VoiceCommand) => {
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

      case 'clarify':
        // AI is asking for clarification — show question and re-engage mic
        setShowFeedback(`🤔 ${command.question}`);
        toast.info(command.question || "Could you give me more details?", { duration: 5000 });
        // Use TTS to speak the question if available
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
  }, [askCopilot, navigate, voice]);

  const handlePress = useCallback(async () => {
    if (voice.isRecording) {
      try {
        const transcript = await voice.stopRecording();
        if (!transcript) return;

        setIsProcessing(true);
        setShowFeedback(`🎙 "${transcript}"`);

        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch(COMMAND_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ transcript }),
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
  }, [voice, executeCommand]);

  const isActive = voice.isRecording || voice.isTranscribing || isProcessing;
  const isLarge = size === 'large';

  return (
    <div className="relative">
      <AnimatePresence>
        {showFeedback && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            className="absolute bottom-full mb-2 right-0 bg-popover border border-border rounded-lg px-3 py-2 shadow-lg max-w-[280px]"
          >
            <p className="text-xs text-foreground whitespace-pre-wrap">{showFeedback}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handlePress}
        disabled={voice.isTranscribing || isProcessing}
        className={cn(
          "rounded-full flex items-center justify-center shadow-md transition-all",
          isLarge ? "h-14 w-14" : "h-10 w-10",
          voice.isRecording
            ? "bg-destructive text-destructive-foreground animate-pulse"
            : isProcessing || voice.isTranscribing
            ? "bg-primary/50 text-primary-foreground"
            : "bg-primary/10 hover:bg-primary/20 text-primary"
        )}
        title={voice.isRecording ? "Stop & process command" : "Voice command"}
      >
        {isProcessing || voice.isTranscribing ? (
          <Loader2 className={cn("animate-spin", isLarge ? "h-6 w-6" : "h-4 w-4")} />
        ) : voice.isRecording ? (
          <MicOff className={cn(isLarge ? "h-6 w-6" : "h-4 w-4")} />
        ) : (
          <Mic className={cn(isLarge ? "h-6 w-6" : "h-4 w-4")} />
        )}
      </motion.button>
    </div>
  );
}

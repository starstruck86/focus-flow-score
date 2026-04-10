/**
 * DojoRoleplay — Multi-turn buyer simulation.
 * 3-5 turns, buyer responds dynamically, full conversation scored at end.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Send, Loader2, MessageSquare, User } from 'lucide-react';
import type { DojoScenario } from '@/lib/dojo/scenarios';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import type { DojoScoreResult } from '@/lib/dojo/types';
import { normalizeScoreResult } from '@/lib/dojo/types';
import type { Json } from '@/integrations/supabase/types';

interface ConversationMessage {
  role: 'buyer' | 'rep';
  content: string;
}

interface Props {
  scenario: DojoScenario;
  userId: string;
  onComplete: (result: DojoScoreResult, conversation: ConversationMessage[]) => void;
}

const MAX_TURNS = 5;
const MIN_TURNS = 3;

export default function DojoRoleplay({ scenario, userId, onComplete }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [conversation, setConversation] = useState<ConversationMessage[]>([
    { role: 'buyer', content: scenario.objection },
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const turnCount = conversation.filter(m => m.role === 'rep').length;

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 300);
  }, [conversation.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [conversation.length, isThinking]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isThinking || isScoring) return;

    const repMessage: ConversationMessage = { role: 'rep', content: input.trim() };
    const updated = [...conversation, repMessage];
    setConversation(updated);
    setInput('');

    const newTurnCount = updated.filter(m => m.role === 'rep').length;

    // If we've hit max turns, score immediately
    if (newTurnCount >= MAX_TURNS) {
      await scoreConversation(updated);
      return;
    }

    // Get buyer response
    setIsThinking(true);
    try {
      const { data, error } = await supabase.functions.invoke('playbook-roleplay', {
        body: {
          messages: updated.map(m => ({
            role: m.role === 'buyer' ? 'assistant' : 'user',
            content: m.content,
          })),
          scenario: `You are a buyer in a sales roleplay. Scenario: ${scenario.context}\n\nYou are testing the rep's ${SKILL_LABELS[scenario.skillFocus].toLowerCase()} skills. Be realistic — push back naturally, escalate pressure across turns, don't make it easy. Stay in character. Keep responses to 2-3 sentences. After turn 3, start moving toward a resolution (either softening or hardening your position based on how the rep has performed).`,
          mode: 'roleplay',
        },
      });

      if (error) throw error;

      // Handle streaming response
      let buyerResponse = '';
      if (typeof data === 'string') {
        buyerResponse = data;
      } else if (data?.choices?.[0]?.message?.content) {
        buyerResponse = data.choices[0].message.content;
      } else if (data) {
        buyerResponse = String(data);
      }

      // Clean up SSE artifacts if present
      buyerResponse = buyerResponse
        .replace(/data:\s*\{[^}]*"content":"([^"]*)"/g, '$1')
        .replace(/data:\s*\[DONE\]/g, '')
        .trim();

      if (!buyerResponse) buyerResponse = "I hear you, but I'm still not convinced. What else can you tell me?";

      setConversation(prev => [...prev, { role: 'buyer', content: buyerResponse }]);
    } catch (e) {
      console.error('Buyer response error:', e);
      // Fallback buyer response
      setConversation(prev => [...prev, { role: 'buyer', content: "Hmm, interesting. But I'm still not sure this is the right move for us right now." }]);
    } finally {
      setIsThinking(false);
    }
  }, [input, conversation, isThinking, isScoring, scenario]);

  const scoreConversation = async (conv: ConversationMessage[]) => {
    setIsScoring(true);
    try {
      const { data, error } = await supabase.functions.invoke('dojo-roleplay-score', {
        body: {
          scenario: {
            skillFocus: scenario.skillFocus,
            context: scenario.context,
            objection: scenario.objection,
          },
          conversation: conv,
          skillFocus: scenario.skillFocus,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const result = normalizeScoreResult(data as Record<string, unknown>);
      onComplete(result, conv);
    } catch (e) {
      console.error('Scoring error:', e);
      toast.error('Failed to score roleplay');
      setIsScoring(false);
    }
  };

  const handleEndEarly = () => {
    if (turnCount >= MIN_TURNS) {
      scoreConversation(conversation);
    }
  };

  if (isScoring) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Dave is reviewing the full conversation...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Conversation */}
      <div ref={scrollRef} className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
        {conversation.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn('flex gap-2.5', msg.role === 'rep' ? 'justify-end' : '')}
          >
            {msg.role === 'buyer' && (
              <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
            <div className={cn(
              'rounded-lg px-3 py-2 max-w-[80%] text-sm',
              msg.role === 'buyer'
                ? 'bg-muted text-foreground'
                : 'bg-primary text-primary-foreground'
            )}>
              {msg.content}
            </div>
            {msg.role === 'rep' && (
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
          </motion.div>
        ))}

        {isThinking && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2.5">
            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="rounded-lg px-3 py-2 bg-muted">
              <div className="flex gap-1">
                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-muted-foreground">Turn {turnCount}/{MAX_TURNS}</span>
        {turnCount >= MIN_TURNS && (
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={handleEndEarly}>
            End & Score
          </Button>
        )}
      </div>

      {/* Input */}
      <Textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Respond to the buyer..."
        className="min-h-[80px] text-sm"
        disabled={isThinking}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendMessage();
        }}
      />
      <Button
        className="w-full gap-2"
        disabled={!input.trim() || isThinking}
        onClick={sendMessage}
      >
        <Send className="h-4 w-4" />
        Send
      </Button>
    </div>
  );
}

/**
 * DojoRoleplay — Multi-turn buyer simulation.
 * 3-5 turns, buyer responds dynamically, full conversation scored at end.
 * Uses non-streaming for reliability. Persists full score_json including mode-specific fields.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
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

export interface ConversationMessage {
  role: 'buyer' | 'rep';
  content: string;
}

interface Props {
  scenario: DojoScenario;
  userId: string;
  onComplete: (result: DojoScoreResult) => void;
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

  function extractBuyerText(data: unknown): string {
    if (typeof data === 'string') {
      const lines = data.split('\n').filter(l => l.startsWith('data: '));
      if (lines.length > 0) {
        let text = '';
        for (const line of lines) {
          const payload = line.replace(/^data:\s*/, '').trim();
          if (payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (delta) text += delta;
          } catch { /* ignore */ }
        }
        if (text.trim()) return text.trim();
      }
      return data.replace(/data:\s*\[DONE\]/g, '').trim();
    }
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (obj.choices && Array.isArray(obj.choices)) {
        const content = (obj.choices[0] as Record<string, unknown>)?.message;
        if (content && typeof content === 'object') {
          const msg = content as Record<string, unknown>;
          if (typeof msg.content === 'string') return msg.content;
        }
      }
    }
    return '';
  }

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isThinking || isScoring) return;

    const repMessage: ConversationMessage = { role: 'rep', content: input.trim() };
    const updated = [...conversation, repMessage];
    setConversation(updated);
    setInput('');

    const newTurnCount = updated.filter(m => m.role === 'rep').length;

    if (newTurnCount >= MAX_TURNS) {
      await scoreConversation(updated);
      return;
    }

    setIsThinking(true);
    try {
      const repTurnsSoFar = updated.filter(m => m.role === 'rep').length;
      const { data, error } = await supabase.functions.invoke('playbook-roleplay', {
        body: {
          messages: updated.map(m => ({
            role: m.role === 'buyer' ? 'assistant' : 'user',
            content: m.content,
          })),
          scenario: `You are a buyer in a sales roleplay. Stay in character at all times.

SCENARIO: ${scenario.context}
SKILL BEING TESTED: ${SKILL_LABELS[scenario.skillFocus].toLowerCase()}
CURRENT TURN: ${repTurnsSoFar} of ${MAX_TURNS}

YOUR BEHAVIOR RULES:
- You are a real, skeptical buyer. Busy, direct, not hostile but not impressed easily.
- Keep responses to 2-3 sentences MAX. Sound like a real person on a call, not an AI.
- NEVER repeat yourself. Each response must introduce a new angle, concern, or reaction.
- NEVER use generic phrases like "I hear you" or "That's interesting" — react specifically to what was said.

ADAPTIVE PRESSURE (respond to rep quality):
- If the rep is VAGUE or GENERIC: Push harder. "What does that actually mean for us?" / "Everyone says that." / "I've got 3 minutes."
- If the rep PITCHES without understanding your situation: Deflect. "Hold on — you don't even know what we're dealing with yet."
- If the rep asks a GOOD QUESTION: Reward with a real answer, but add a new concern or constraint.
- If the rep shows SPECIFIC PROOF or INSIGHT: Soften slightly. Show curiosity. "Okay, that's more interesting. How does that work exactly?"
- If the rep is RAMBLING: Cut them off. "Sorry, I'm losing the thread here. What's the bottom line?"

TURN PROGRESSION:
- Turn 1-2: Be skeptical. Test whether the rep listens or pitches.
- Turn 3: Escalate or soften based on cumulative rep quality. If they've earned it, give them an opening. If not, start closing down.
- Turn 4-5: Move toward resolution. Either give them a next step or politely end the conversation.

NEVER break character. NEVER coach the rep. You are the BUYER.`,
          mode: 'roleplay',
          dojoMode: true,
        },
      });

      if (error) throw error;

      let buyerResponse = extractBuyerText(data);
      if (!buyerResponse) buyerResponse = "I hear you, but I'm still not convinced. What else can you tell me?";

      setConversation(prev => [...prev, { role: 'buyer', content: buyerResponse }]);
    } catch (e) {
      console.error('Buyer response error:', e);
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

      // Build full score_json including roleplay-specific fields
      const fullScoreJson: Record<string, unknown> = {
        ...JSON.parse(JSON.stringify(result)),
        turnAnalysis: Array.isArray(data.turnAnalysis) ? data.turnAnalysis : [],
        controlArc: typeof data.controlArc === 'string' ? data.controlArc : '',
        adaptationNote: typeof data.adaptationNote === 'string' ? data.adaptationNote : '',
      };

      // Save roleplay session WITH turn + score_json
      try {
        const { data: session } = await supabase.from('dojo_sessions').insert({
          user_id: userId,
          mode: 'autopilot',
          session_type: 'roleplay',
          skill_focus: scenario.skillFocus,
          scenario_title: scenario.title,
          scenario_context: scenario.context,
          scenario_objection: scenario.objection,
          best_score: result.score,
          latest_score: result.score,
          status: 'completed',
          completed_at: new Date().toISOString(),
        }).select('id').single();

        if (session) {
          await supabase.from('dojo_session_turns').insert({
            session_id: session.id,
            user_id: userId,
            turn_index: 0,
            prompt_text: scenario.objection,
            user_response: conv.filter(m => m.role === 'rep').map(m => m.content).join('\n---\n'),
            score: result.score,
            feedback: result.feedback,
            top_mistake: result.topMistake,
            improved_version: result.improvedVersion,
            score_json: fullScoreJson as Json,
          });
        }
      } catch (saveErr) {
        console.error('Failed to save roleplay session:', saveErr);
      }

      // Attach mode-specific fields for UI consumption
      const enrichedResult = {
        ...result,
        turnAnalysis: fullScoreJson.turnAnalysis,
        controlArc: fullScoreJson.controlArc,
        adaptationNote: fullScoreJson.adaptationNote,
      } as DojoScoreResult;

      onComplete(enrichedResult);
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
      <div ref={scrollRef} className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
        {conversation.map((msg, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('flex gap-2.5', msg.role === 'rep' ? 'justify-end' : '')}>
            {msg.role === 'buyer' && (
              <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
            <div className={cn('rounded-lg px-3 py-2 max-w-[80%] text-sm', msg.role === 'buyer' ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground')}>
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

      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-muted-foreground">Turn {turnCount}/{MAX_TURNS}</span>
        {turnCount >= MIN_TURNS && (
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={handleEndEarly}>End & Score</Button>
        )}
      </div>

      <Textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Respond to the buyer..." className="min-h-[80px] text-sm" disabled={isThinking} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendMessage(); }} />
      <Button className="w-full gap-2" disabled={!input.trim() || isThinking} onClick={sendMessage}><Send className="h-4 w-4" />Send</Button>
    </div>
  );
}

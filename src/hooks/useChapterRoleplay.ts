/**
 * useChapterRoleplay — handles "Practice with Dave" from chapters/knowledge items.
 * 
 * Listens for dave-start-roleplay events, fetches active knowledge for the chapter,
 * and invokes the playbook-roleplay edge function with knowledge grounding.
 */

import { useEffect, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { queryKnowledge } from '@/lib/knowledgeRetrieval';
import { toast } from 'sonner';

export interface RoleplaySession {
  active: boolean;
  chapter: string;
  knowledgeItemId?: string;
  focusItemTitle?: string;
  knowledgeGrounding: string;
  groundedItemCount: number;
  competitorContext?: string;
  startedAt: number;
}

const SESSION_KEY = 'chapter-roleplay-session';

function getSession(): RoleplaySession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setSession(s: RoleplaySession | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

/**
 * Build a buyer scenario grounded in the user's active knowledge items for a chapter.
 */
function buildKnowledgeGroundedScenario(
  chapter: string,
  items: Array<{
    title: string;
    tactic_summary: string | null;
    when_to_use: string | null;
    when_not_to_use: string | null;
    example_usage: string | null;
    competitor_name: string | null;
    knowledge_type: string;
  }>,
  focusItemTitle?: string,
): string {
  const chapterLabel = chapter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const tactics = items
    .filter(i => i.tactic_summary)
    .map(i => `- ${i.title}: ${i.tactic_summary}`)
    .join('\n');

  const antiPatterns = items
    .filter(i => i.when_not_to_use)
    .map(i => `- ${i.when_not_to_use}`)
    .join('\n');

  const talkTracks = items
    .filter(i => i.example_usage)
    .map(i => `- ${i.example_usage}`)
    .join('\n');

  const competitiveAngles = items
    .filter(i => i.knowledge_type === 'competitive' && i.competitor_name)
    .map(i => `- vs ${i.competitor_name}: ${i.tactic_summary || i.title}`)
    .join('\n');

  const focusSection = focusItemTitle
    ? `\n## PRIMARY FOCUS ITEM\nThe rep is specifically practicing: "${focusItemTitle}"\nDesign buyer responses that force the rep to use this exact tactic. Test whether they can execute it under pressure.\n`
    : '';

  return `You are a REAL BUYER in a high-pressure ${chapterLabel} roleplay. You are NOT an AI assistant. You are NOT helpful.

## SCENARIO: ${chapterLabel.toUpperCase()} PRACTICE
${focusSection}
## REP'S ACTIVE TACTICS (use these to evaluate the rep)
${tactics || '- No specific tactics loaded'}

## ANTI-PATTERNS TO EXPLOIT (if the rep does these, punish them)
${antiPatterns || '- Generic pitching\n- Not asking questions\n- Being too agreeable'}

## TALK TRACKS THE REP SHOULD USE (reward when you hear these)
${talkTracks || '- Specific, situational responses'}

${competitiveAngles ? `## COMPETITIVE CONTEXT\n${competitiveAngles}\n` : ''}

## YOUR BEHAVIOR RULES
1. Keep responses to 1-3 sentences. Real buyers are brief.
2. Give surface answers to weak questions. Only reveal pain when the rep earns it.
3. Challenge vague statements: "That sounds like something you say to everyone."
4. If the rep uses an anti-pattern, get dismissive and harder to engage.
5. If the rep executes a tactic well, soften slightly — reward good selling.
6. NEVER break character. You are the buyer.
7. Interrupt sometimes. Apply time pressure. Be skeptical.

## ESCALATION
- Exchanges 1-2: Guarded but willing to listen.
- Exchanges 3-5: Harder if rep is weak, open up if strong.
- Exchanges 6+: Either earned attention or ready to end the call.

## START
Respond as a buyer at the opening of a call. Be natural, slightly distracted.`;
}

export function useChapterRoleplay() {
  const [session, setSessionState] = useState<RoleplaySession | null>(getSession);

  const startRoleplay = useCallback(async (chapter: string, knowledgeItemId?: string) => {
    try {
      // Fetch active knowledge for the chapter
      const items = await queryKnowledge({
        chapters: [chapter],
        context: 'roleplay',
        activeOnly: true,
        maxItems: 15,
      });

      if (items.length === 0) {
        toast.error(`No active knowledge in ${chapter.replace(/_/g, ' ')}. Activate some items first.`);
        return;
      }

      // Find the focus item if specified
      const focusItem = knowledgeItemId
        ? items.find(i => i.id === knowledgeItemId)
        : undefined;

      const scenario = buildKnowledgeGroundedScenario(
        chapter,
        items,
        focusItem?.title,
      );

      // Build grounding summary for UI
      const groundingSummary = items
        .slice(0, 5)
        .map(i => `• ${i.title}`)
        .join('\n');

      const newSession: RoleplaySession = {
        active: true,
        chapter,
        knowledgeItemId,
        knowledgeGrounding: groundingSummary,
        groundedItemCount: items.length,
        startedAt: Date.now(),
      };

      setSession(newSession);
      setSessionState(newSession);

      // Call the edge function to start streaming
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) {
        toast.error('Not authenticated');
        return;
      }

      const chapterLabel = chapter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      toast.success(
        `🎭 ${chapterLabel} roleplay started — grounded in ${items.length} active knowledge items`,
        { duration: 4000 },
      );

      // Store scenario for the edge function to use
      localStorage.setItem('chapter-roleplay-scenario', scenario);

      // Dispatch event so Dave UI can pick it up
      window.dispatchEvent(new CustomEvent('chapter-roleplay-ready', {
        detail: {
          chapter,
          scenario,
          groundedItemCount: items.length,
          groundingSummary,
          focusItemTitle: focusItem?.title,
        },
      }));
    } catch (err) {
      console.error('Failed to start chapter roleplay:', err);
      toast.error('Failed to start roleplay');
    }
  }, []);

  const endRoleplay = useCallback(() => {
    setSession(null);
    setSessionState(null);
    localStorage.removeItem('chapter-roleplay-scenario');
    window.dispatchEvent(new CustomEvent('chapter-roleplay-ended'));
  }, []);

  // Listen for dave-start-roleplay events from PlaybookEngine / KnowledgeItemDrawer
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.chapter) {
        startRoleplay(detail.chapter, detail.knowledgeItemId);
      }
    };
    window.addEventListener('dave-start-roleplay', handler);
    return () => window.removeEventListener('dave-start-roleplay', handler);
  }, [startRoleplay]);

  return { session, startRoleplay, endRoleplay };
}

// Territory Copilot v4 - streaming chat client with auth, modes, frameworks, and write-back actions
import { supabase } from '@/integrations/supabase/client';

export type CopilotMsg = { role: "user" | "assistant"; content: string };
export type CopilotMode = "quick" | "deep" | "meeting" | "deal-strategy" | "recap-email" | "resource-qa";

const COPILOT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/territory-copilot`;

async function getAuthToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export async function streamCopilot({
  messages,
  mode = "quick",
  accountId,
  pageContext,
  onDelta,
  onDone,
  onError,
  onAccountUpdated,
  signal,
}: {
  messages: CopilotMsg[];
  mode?: CopilotMode;
  accountId?: string;
  pageContext?: { page: string; description: string; accountId?: string; accountName?: string; opportunityId?: string; opportunityName?: string } | null;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  onAccountUpdated?: () => void;
  signal?: AbortSignal;
}) {
  try {
    const token = await getAuthToken();
    if (!token) {
      onError("Not authenticated. Please sign in first.");
      return;
    }

    const resp = await fetch(COPILOT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ messages, mode, accountId, pageContext }),
      signal,
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({ error: "Request failed" }));
      onError(data.error || `Error ${resp.status}`);
      return;
    }

    if (!resp.body) {
      onError("No response body");
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let detectedUpdate = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") {
          if (detectedUpdate && onAccountUpdated) onAccountUpdated();
          onDone();
          return;
        }

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            onDelta(content);
            if (content.includes("🔄 **Data Updates Applied**") || content.includes("✅ Updated")) {
              detectedUpdate = true;
            }
          }
        } catch {
          buffer = line + "\n" + buffer;
          break;
        }
      }
    }

    // Flush
    if (buffer.trim()) {
      for (let raw of buffer.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        if (!raw.startsWith("data: ")) continue;
        const jsonStr = raw.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onDelta(content);
        } catch { /* ignore */ }
      }
    }

    if (detectedUpdate && onAccountUpdated) onAccountUpdated();
    onDone();
  } catch (e: any) {
    if (e.name === "AbortError") return;
    onError(e.message || "Connection failed");
  }
}

export const SUGGESTED_QUESTIONS: { text: string; mode: CopilotMode }[] = [
  { text: "What should I work on right now?", mode: "quick" },
  { text: "Run MEDDICC analysis on my top deal", mode: "deal-strategy" },
  { text: "Which accounts show new buying signals?", mode: "quick" },
  { text: "Which renewals are at risk this quarter?", mode: "quick" },
  { text: "Prep me for my next client meeting", mode: "meeting" },
  { text: "Draft a recap email for my last call", mode: "recap-email" },
  { text: "Research & update my top pipeline accounts", mode: "deep" },
  { text: "Analyze pipeline gaps using my frameworks", mode: "deal-strategy" },
  { text: "What changed in my territory this week?", mode: "deep" },
  { text: "Which deals need champion development?", mode: "deal-strategy" },
];

// Supercharge #1: Page-specific suggested questions
export const PAGE_SUGGESTED_QUESTIONS: Record<string, { text: string; mode: CopilotMode }[]> = {
  dashboard: [
    { text: "What should I focus on today?", mode: "quick" },
    { text: "Prep me for my next meeting today", mode: "meeting" },
    { text: "Which accounts need attention this week?", mode: "quick" },
    { text: "What's the most impactful thing I can do right now?", mode: "quick" },
    { text: "Am I on pace for quota this month?", mode: "quick" },
    { text: "Research & update my priority accounts", mode: "deep" },
  ],
  coach: [
    { text: "What's my biggest coaching gap based on recent calls?", mode: "quick" },
    { text: "How can I improve my discovery questioning?", mode: "quick" },
    { text: "Compare my last 5 calls — what trends do you see?", mode: "quick" },
    { text: "What's 1 thing I can change to raise my call scores?", mode: "quick" },
    { text: "How do I get better at handling objections?", mode: "quick" },
    { text: "Analyze my MEDDICC adherence across calls", mode: "deal-strategy" },
  ],
  outreach: [
    { text: "Which accounts should I prioritize outreach to?", mode: "quick" },
    { text: "What accounts have stale outreach that need follow-up?", mode: "quick" },
    { text: "Research my top 3 target accounts", mode: "deep" },
    { text: "Help me build a prospecting plan for this week", mode: "quick" },
    { text: "Which triggered accounts should I call first?", mode: "quick" },
    { text: "Who are the highest ICP-fit accounts I haven't touched?", mode: "quick" },
  ],
  renewals: [
    { text: "Which renewals are most at risk right now?", mode: "quick" },
    { text: "What's my renewal pipeline coverage look like?", mode: "quick" },
    { text: "Which renewals are coming due in the next 45 days?", mode: "quick" },
    { text: "Draft a check-in email for my riskiest renewal", mode: "recap-email" },
    { text: "What expansion opportunities exist in my renewal book?", mode: "quick" },
    { text: "Analyze churn risk patterns across my renewals", mode: "deal-strategy" },
  ],
  quota: [
    { text: "Am I on track to hit quota? What's the gap?", mode: "quick" },
    { text: "What's the math to reach P-Club?", mode: "quick" },
    { text: "Which deals are most likely to close this quarter?", mode: "quick" },
    { text: "What's my pipeline coverage ratio?", mode: "quick" },
    { text: "Scenario: what if I close my top 3 deals?", mode: "quick" },
    { text: "Analyze my conversion rates vs benchmarks", mode: "deal-strategy" },
  ],
  tasks: [
    { text: "What should I prioritize today?", mode: "quick" },
    { text: "Which overdue tasks should I tackle first?", mode: "quick" },
    { text: "What tasks are tied to my highest-value deals?", mode: "quick" },
    { text: "Help me plan my task execution for today", mode: "quick" },
    { text: "Which account follow-ups am I behind on?", mode: "quick" },
    { text: "What prep tasks do I need for upcoming meetings?", mode: "meeting" },
  ],
  'prep-hub': [
    { text: "Prep me for my next meeting", mode: "meeting" },
    { text: "What call transcripts should I review before tomorrow?", mode: "quick" },
    { text: "Summarize key themes from my recent calls", mode: "quick" },
    { text: "What follow-ups are needed from last week's meetings?", mode: "quick" },
    { text: "Draft a recap email for my last call", mode: "recap-email" },
    { text: "Research the account I'm meeting next", mode: "deep" },
  ],
  trends: [
    { text: "What's trending up or down in my performance?", mode: "quick" },
    { text: "How does this week compare to last month?", mode: "quick" },
    { text: "What's driving my best and worst days?", mode: "quick" },
    { text: "Where am I losing time that could go to selling?", mode: "quick" },
    { text: "Analyze my activity patterns this quarter", mode: "quick" },
    { text: "What would it take to improve my Sales Age?", mode: "quick" },
  ],
  'account-detail': [
    { text: "Give me a full brief on this account", mode: "meeting" },
    { text: "What's the best next move for this account?", mode: "quick" },
    { text: "Deep research this account — find buying signals", mode: "deep" },
    { text: "Run a MEDDICC analysis on this account's deal", mode: "deal-strategy" },
    { text: "Who else should I be talking to at this company?", mode: "deep" },
    { text: "Draft a follow-up email for this account", mode: "recap-email" },
  ],
  'opportunity-detail': [
    { text: "Score this deal — what's the MEDDICC gap?", mode: "deal-strategy" },
    { text: "What's the risk profile of this opportunity?", mode: "quick" },
    { text: "What's the best strategy to advance this deal?", mode: "deal-strategy" },
    { text: "Who's the champion and how strong are they?", mode: "deal-strategy" },
    { text: "Draft a recap email for this opportunity", mode: "recap-email" },
    { text: "Research the competitive landscape for this deal", mode: "deep" },
  ],
};

// Supercharge #2: Page-specific placeholder text
export const PAGE_PLACEHOLDERS: Record<string, string> = {
  dashboard: "What should I do today?",
  coach: "How can I improve my call performance?",
  outreach: "Which accounts need outreach?",
  renewals: "Which renewals need attention?",
  quota: "Am I on pace to hit quota?",
  tasks: "What should I prioritize?",
  'prep-hub': "What should I prep for?",
  trends: "What trends matter most?",
  'account-detail': "Ask about this account...",
  'opportunity-detail': "Ask about this deal...",
};

export const MODE_CONFIG: Record<CopilotMode, { label: string; description: string; icon: string }> = {
  quick: { label: "Quick", description: "Fast answers from your CRM data", icon: "⚡" },
  deep: { label: "Deep Research", description: "CRM + web intel → auto-updates accounts", icon: "🔬" },
  meeting: { label: "Meeting Prep", description: "Full brief using your frameworks + transcripts", icon: "📋" },
  "deal-strategy": { label: "Deal Strategy", description: "Framework-based deal analysis (MEDDICC, etc.)", icon: "🎯" },
  "recap-email": { label: "Recap Email", description: "Draft follow-up emails from call transcripts", icon: "✉️" },
  "resource-qa": { label: "Resource Q&A", description: "Learn from your playbooks, frameworks & training", icon: "📚" },
};

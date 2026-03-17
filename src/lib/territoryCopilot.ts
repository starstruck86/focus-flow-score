// Territory Copilot v4 - streaming chat client with auth, modes, frameworks, and write-back actions
import { supabase } from '@/integrations/supabase/client';

export type CopilotMsg = { role: "user" | "assistant"; content: string };
export type CopilotMode = "quick" | "deep" | "meeting" | "deal-strategy" | "recap-email";

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

export const MODE_CONFIG: Record<CopilotMode, { label: string; description: string; icon: string }> = {
  quick: { label: "Quick", description: "Fast answers from your CRM data", icon: "⚡" },
  deep: { label: "Deep Research", description: "CRM + web intel → auto-updates accounts", icon: "🔬" },
  meeting: { label: "Meeting Prep", description: "Full brief using your frameworks + transcripts", icon: "📋" },
  "deal-strategy": { label: "Deal Strategy", description: "Framework-based deal analysis (MEDDICC, etc.)", icon: "🎯" },
  "recap-email": { label: "Recap Email", description: "Draft follow-up emails from call transcripts", icon: "✉️" },
};

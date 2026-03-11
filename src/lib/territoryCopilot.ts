// Territory Copilot - streaming chat client

type Msg = { role: "user" | "assistant"; content: string };

const COPILOT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/territory-copilot`;

export async function streamCopilot({
  messages,
  onDelta,
  onDone,
  onError,
  signal,
}: {
  messages: Msg[];
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  signal?: AbortSignal;
}) {
  try {
    const resp = await fetch(COPILOT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ messages }),
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
          onDone();
          return;
        }

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onDelta(content);
        } catch {
          buffer = line + "\n" + buffer;
          break;
        }
      }
    }

    // Flush remaining
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

    onDone();
  } catch (e: any) {
    if (e.name === "AbortError") return;
    onError(e.message || "Connection failed");
  }
}

export const SUGGESTED_QUESTIONS = [
  "What should I work on right now?",
  "Which accounts show new buying signals?",
  "Which renewals are at risk this quarter?",
  "What should I know before my next meeting?",
  "Which Tier 1 accounts are underworked?",
  "Compare my top 3 pipeline opportunities",
  "What changed in my territory this week?",
  "Which accounts are most likely to buy soon?",
];

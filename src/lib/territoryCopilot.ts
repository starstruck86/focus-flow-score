// Territory Copilot v4 - streaming chat client with auth, modes, frameworks, and write-back actions
import { streamingFetch } from '@/lib/streamingFetch';

export type CopilotMsg = { role: "user" | "assistant"; content: string };
export type CopilotMode = "quick" | "deep" | "meeting" | "deal-strategy" | "recap-email" | "resource-qa";

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
  pageContext?: { page: string; description: string; accountId?: string; accountName?: string; opportunityId?: string; opportunityName?: string; territoryContext?: string } | null;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  onAccountUpdated?: () => void;
  signal?: AbortSignal;
}) {
  let detectedUpdate = false;

  await streamingFetch(
    {
      functionName: 'territory-copilot',
      body: { messages, mode, accountId, pageContext },
      signal,
    },
    {
      onDelta: (content) => {
        onDelta(content);
        if (content.includes("🔄 **Data Updates Applied**") || content.includes("✅ Updated")) {
          detectedUpdate = true;
        }
      },
      onDone: () => {
        if (detectedUpdate && onAccountUpdated) onAccountUpdated();
        onDone();
      },
      onError: (msg) => onError(msg),
    },
  );
}

export const SUGGESTED_QUESTIONS: { text: string; mode: CopilotMode }[] = [
  { text: "What should I focus on today?", mode: "quick" },
  { text: "Which accounts have the strongest expansion signal right now?", mode: "quick" },
  { text: "Prep me for my next customer meeting", mode: "meeting" },
  { text: "What Branch KIs should I review before my next call?", mode: "resource-qa" },
  { text: "What's my expansion math to $1.4M?", mode: "quick" },
  { text: "Build me a QBR narrative for an account", mode: "meeting" },
  { text: "What Branch products am I underleveraging?", mode: "resource-qa" },
  { text: "Which accounts are most at risk of going quiet?", mode: "quick" },
  { text: "Help me think through my expansion hypothesis for an account", mode: "deal-strategy" },
  { text: "Draft a follow-up email from my last call", mode: "recap-email" },
  { text: "What competitive intelligence do I have on Adjust?", mode: "resource-qa" },
];

// Supercharge #1: Page-specific suggested questions
export const PAGE_SUGGESTED_QUESTIONS: Record<string, { text: string; mode: CopilotMode }[]> = {
  dashboard: [
    { text: "What should I focus on today?", mode: "quick" },
    { text: "Which accounts need attention this week?", mode: "quick" },
    { text: "Give me a Branch play to use in my next call today", mode: "resource-qa" },
    { text: "What's my expansion progress toward $1.4M?", mode: "quick" },
    { text: "Which account should I prioritize first?", mode: "quick" },
    { text: "Prep me for my next meeting today", mode: "meeting" },
  ],
  coach: [
    { text: "Where is my product_knowledge score weakest?", mode: "quick" },
    { text: "What Branch play did I underuse in recent role plays?", mode: "quick" },
    { text: "Which KIs should I drill most before July 13?", mode: "resource-qa" },
    { text: "What's my biggest coaching gap from the role plays?", mode: "quick" },
    { text: "How do I improve my discovery score?", mode: "quick" },
    { text: "What would a top Branch expansion AE do differently?", mode: "resource-qa" },
  ],
  'prep-hub': [
    { text: "What Branch documents should I ingest first?", mode: "quick" },
    { text: "Teach me about Branch deep linking for media companies", mode: "resource-qa" },
    { text: "What's the strongest Branch play for streaming attribution?", mode: "resource-qa" },
    { text: "How do I position Branch against Adjust?", mode: "resource-qa" },
    { text: "What are the most important Branch KIs for expansion selling?", mode: "resource-qa" },
    { text: "Draft me a playbook for QBR expansion conversations", mode: "meeting" },
  ],
  'account-detail': [
    { text: "What's the expansion whitespace for this account?", mode: "meeting" },
    { text: "What Branch products should I lead with here?", mode: "resource-qa" },
    { text: "Build me a QBR narrative for this account", mode: "meeting" },
    { text: "Who should I multi-thread into at this account?", mode: "quick" },
    { text: "What competitive threats are most likely here?", mode: "quick" },
    { text: "Draft a follow-up email for this account", mode: "recap-email" },
  ],
  strategy: [
    { text: "What's the expansion angle for my top account?", mode: "deal-strategy" },
    { text: "Help me build an expansion hypothesis for an account", mode: "deal-strategy" },
    { text: "What's my best approach for a QBR that opens expansion?", mode: "meeting" },
    { text: "Research Branch's strengths vs Adjust in media", mode: "deep" },
    { text: "What signals indicate an account is ready to expand?", mode: "resource-qa" },
    { text: "Draft an executive-level Branch value story", mode: "meeting" },
  ],
  dojo: [
    { text: "Which Branch KI dimension should I drill today?", mode: "quick" },
    { text: "What's the most important play for expansion AEs?", mode: "resource-qa" },
    { text: "Give me a Branch discovery question for a media account", mode: "resource-qa" },
    { text: "How do I handle 'Adjust does everything Branch does'?", mode: "resource-qa" },
    { text: "What Branch plays work best in QBRs?", mode: "resource-qa" },
    { text: "How do I open an expansion conversation without being pushy?", mode: "resource-qa" },
  ],
  trends: [
    { text: "How is my training trending before Branch Day 1?", mode: "quick" },
    { text: "Which dimensions improved most this week?", mode: "quick" },
    { text: "Am I on track for July 13 readiness?", mode: "quick" },
    { text: "What should I focus on to improve fastest?", mode: "quick" },
  ],
};

// Supercharge #2: Page-specific placeholder text
export const PAGE_PLACEHOLDERS: Record<string, string> = {
  dashboard: "What should I focus on today?",
  coach: "How can I improve before Branch Day 1?",
  'prep-hub': "Ask about Branch products, plays, or intelligence...",
  'account-detail': "Ask about this account's expansion potential...",
  strategy: "Ask about expansion strategy or account intelligence...",
  dojo: "Ask about Branch plays or what to drill next...",
  trends: "Ask about your training progress...",
};

export const MODE_CONFIG: Record<CopilotMode, { label: string; description: string; icon: string }> = {
  quick: { label: "Quick", description: "Fast answers from your CRM data", icon: "⚡" },
  deep: { label: "Deep Research", description: "CRM + web intel → auto-updates accounts", icon: "🔬" },
  meeting: { label: "Meeting Prep", description: "Full brief using your frameworks + transcripts", icon: "📋" },
  "deal-strategy": { label: "Deal Strategy", description: "Expansion strategy and account-level planning", icon: "🎯" },
  "recap-email": { label: "Recap Email", description: "Draft follow-up emails from call transcripts", icon: "✉️" },
  "resource-qa": { label: "Resource Q&A", description: "Learn from your playbooks, frameworks & training", icon: "📚" },
};

// Territory Copilot v3 — ⌘K with Quick / Deep Research / Meeting Prep + write-back + voice
import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sparkles, Send, Loader2, MessageSquare, ArrowRight, Zap, RotateCcw, Search, Calendar, Target, Mail, Mic, MicOff, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { streamCopilot, SUGGESTED_QUESTIONS, PAGE_SUGGESTED_QUESTIONS, PAGE_PLACEHOLDERS, MODE_CONFIG, type CopilotMsg, type CopilotMode } from '@/lib/territoryCopilot';
import { useCopilot } from '@/contexts/CopilotContext';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { ExplainabilityFooter, type ExplainabilityData } from '@/components/copilot/ExplainabilityFooter';
import { detectDaveMode } from '@/lib/daveModeDetector';
import { isSystemOSEnabled } from '@/lib/featureFlags';

const MODE_ICONS: Record<CopilotMode, typeof Zap> = {
  quick: Zap,
  deep: Search,
  meeting: Calendar,
  "deal-strategy": Target,
  "recap-email": Mail,
  "resource-qa": BookOpen,
};

const ModeSelector = memo(({ mode, onChange, disabled }: { mode: CopilotMode; onChange: (m: CopilotMode) => void; disabled: boolean }) => (
  <div className="flex gap-1">
    {(Object.keys(MODE_CONFIG) as CopilotMode[]).map((m) => {
      const config = MODE_CONFIG[m];
      const Icon = MODE_ICONS[m];
      return (
        <button
          key={m}
          onClick={() => onChange(m)}
          disabled={disabled}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all",
            mode === m
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20",
            disabled && "opacity-50 pointer-events-none"
          )}
          title={config.description}
        >
          <Icon className="h-3 w-3" />
          {config.label}
        </button>
      );
    })}
  </div>
));
ModeSelector.displayName = 'ModeSelector';

// Memoize message bubble to avoid re-renders on every streaming token
const MessageBubble = memo(({ msg }: { msg: CopilotMsg }) => (
  <div className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
    <div className={cn(
      "rounded-xl px-3.5 py-2.5 max-w-[90%]",
      msg.role === 'user'
        ? "bg-primary text-primary-foreground"
        : "bg-muted/50 border border-border"
    )}>
      {msg.role === 'user' ? (
        <p className="text-sm">{msg.content}</p>
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:text-sm [&_li]:text-sm [&_strong]:text-foreground [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_ul]:my-1 [&_ol]:my-1 [&_p]:my-1 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-primary/30 [&_blockquote]:bg-primary/5 [&_blockquote]:rounded-md [&_blockquote]:py-1">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {msg.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  </div>
));
MessageBubble.displayName = 'MessageBubble';

function CopilotDialog() {
  const { state, setOpen, clearInitialQuestion, pageContext } = useCopilot();
  const [messages, setMessages] = useState<CopilotMsg[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<CopilotMode>('quick');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explainability, setExplainability] = useState<ExplainabilityData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const processedQuestionRef = useRef<string | null>(null);
  const streamingRef = useRef(false);
  const voice = useVoiceMode();

  

  useEffect(() => {
    if (state.open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      if (state.initialQuestion && processedQuestionRef.current !== state.initialQuestion) {
        processedQuestionRef.current = state.initialQuestion;
        setMessages([]);
        const detectedMode = state.mode || 'quick';
        setMode(detectedMode);
        setTimeout(() => sendMessage(state.initialQuestion!, detectedMode), 200);
        clearInitialQuestion();
      }
    } else {
      abortRef.current?.abort();
      processedQuestionRef.current = null;
    }
  }, [state.open, state.initialQuestion]);

  // Throttled scroll — only scroll every 100ms during streaming
  const lastScrollRef = useRef(0);
  useEffect(() => {
    if (!scrollRef.current) return;
    const now = Date.now();
    if (now - lastScrollRef.current < 100 && streamingRef.current) return;
    lastScrollRef.current = now;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: streamingRef.current ? 'auto' : 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string, overrideMode?: CopilotMode) => {
    if (!text.trim() || streamingRef.current) return;

    const activeMode = overrideMode || mode;
    setError(null);
    const userMsg: CopilotMsg = { role: 'user', content: text.trim() };

    // Add user message first, then start streaming separately (no side effects in setState)
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    streamingRef.current = true;

    const abort = new AbortController();
    abortRef.current = abort;

    let assistantText = '';
    const allMessages = [...messages, userMsg]; // capture current + new

    streamCopilot({
      messages: allMessages,
      mode: activeMode,
      accountId: state.accountId,
      pageContext,
      onDelta: (chunk) => {
        assistantText += chunk;
        const content = assistantText; // capture for closure
        setMessages(p => {
          const last = p[p.length - 1];
          if (last?.role === 'assistant') {
            return p.map((m, i) => i === p.length - 1 ? { ...m, content } : m);
          }
          return [...p, { role: 'assistant', content }];
        });
      },
      onDone: () => {
        setIsStreaming(false);
        streamingRef.current = false;
        // Build explainability data after response completes
        if (isSystemOSEnabled()) {
          const detectedMode = detectDaveMode(text);
          setExplainability({
            mode: detectedMode,
            confidence: 72,
            topFactors: [`Mode: ${detectedMode}`, `Context: ${pageContext?.page || 'general'}`],
            confidenceDrivers: ['Based on conversation context and query pattern'],
          });
        }
      },
      onError: (err) => {
        setError(err);
        setIsStreaming(false);
        streamingRef.current = false;
      },
      onAccountUpdated: () => {
        toast.success('Account data updated by AI research', {
          description: 'Your accounts have been enriched — data will sync on next load',
        });
      },
      signal: abort.signal,
    });
  }, [messages, mode, state.accountId, pageContext]);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input); };
  const handleClear = useCallback(() => {
    setMessages([]);
    setError(null);
    setExplainability(null);
    abortRef.current?.abort();
    setIsStreaming(false);
    streamingRef.current = false;
  }, []);

  const handleMicClick = useCallback(async () => {
    if (voice.isRecording) {
      try {
        const transcript = await voice.stopRecording();
        if (transcript) {
          setInput('');
          sendMessage(transcript);
        }
      } catch (err: any) {
        if (err.message !== 'Recording too short') {
          toast.error('Voice input failed', { description: err.message });
        }
      }
    } else {
      try {
        await voice.startRecording();
      } catch {
        // handled in hook
      }
    }
  }, [voice, sendMessage]);

  const showSuggestions = messages.length === 0 && !isStreaming;
  // Supercharge #1: Use page-specific suggestions when available
  const pageSuggestions = pageContext?.page ? PAGE_SUGGESTED_QUESTIONS[pageContext.page] : null;
  const baseSuggestions = pageSuggestions || SUGGESTED_QUESTIONS;
  const filteredSuggestions = baseSuggestions.filter(q => mode === 'quick' || q.mode === mode).slice(0, 6);
  
  // Supercharge #2: Page-specific placeholder
  const placeholder = pageContext?.page ? PAGE_PLACEHOLDERS[pageContext.page] : undefined;

  return (
    <Dialog open={state.open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[680px] p-0 gap-0 max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-display text-sm font-bold">Territory Intelligence</span>
          {pageContext && (
            <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full truncate max-w-[200px]">
              {pageContext.accountName || pageContext.opportunityName || pageContext.description}
            </span>
          )}
          <div className="flex-1" />
          <ModeSelector mode={mode} onChange={setMode} disabled={isStreaming} />
          {messages.length > 0 && (
            <button onClick={handleClear} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-2">
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Mode indicator */}
        {mode !== 'quick' && (
          <div className={cn(
            "px-4 py-1.5 text-[10px] font-medium border-b border-border flex items-center gap-1.5",
            mode === 'deep' ? "bg-primary/5 text-primary" : "bg-accent/30 text-accent-foreground"
          )}>
            {MODE_CONFIG[mode].icon} {MODE_CONFIG[mode].description}
            {mode === 'deep' && <span className="ml-1 text-muted-foreground">• auto-updates accounts with findings</span>}
            {mode === 'meeting' && <span className="ml-1 text-muted-foreground">• auto-enriches account intel</span>}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px] max-h-[55vh]">
          {showSuggestions && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Zap className="h-3 w-3 text-primary" />
                {pageSuggestions && pageContext?.description
                  ? `${pageContext.description} — ask me anything.`
                  : mode === 'quick' ? "Ask anything about your territory, accounts, or pipeline."
                  : mode === 'deep' ? "Deep research combines CRM data with web intel and auto-updates your accounts."
                  : mode === 'meeting' ? "Get a comprehensive meeting brief — auto-enriches account data."
                  : "Ask anything."
                }
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredSuggestions.map((q) => (
                  <button
                    key={q.text}
                    onClick={() => sendMessage(q.text, q.mode)}
                    className="flex items-center gap-2 text-left p-2.5 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition-all group text-xs"
                  >
                    <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-foreground">{q.text}</span>
                    {q.mode !== 'quick' && (
                      <span className="text-[9px] text-primary/60 shrink-0">{MODE_CONFIG[q.mode].icon}</span>
                    )}
                    <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Render completed messages with memo, streaming message without */}
          {messages.map((msg, i) => {
            const isLastAssistant = i === messages.length - 1 && msg.role === 'assistant' && isStreaming;
            if (isLastAssistant) {
              // Don't memo the actively streaming message
              return (
                <div key={i} className="flex justify-start">
                  <div className="rounded-xl px-3.5 py-2.5 max-w-[90%] bg-muted/50 border border-border">
                    <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:text-sm [&_li]:text-sm [&_strong]:text-foreground [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_ul]:my-1 [&_ol]:my-1 [&_p]:my-1 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-primary/30 [&_blockquote]:bg-primary/5 [&_blockquote]:rounded-md [&_blockquote]:py-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              );
            }
            return <MessageBubble key={i} msg={msg} />;
          })}

          {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-xs">
                {mode === 'quick' && "Analyzing your territory..."}
                {mode === 'deep' && "Researching & updating accounts..."}
                {mode === 'meeting' && "Building your meeting brief..."}
              </span>
            </div>
          )}

          {error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-lg p-3">{error}</div>
          )}

          {/* Explainability — shows after response completes */}
          {explainability && !isStreaming && messages.length > 0 && (
            <ExplainabilityFooter data={explainability} />
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0">
          <input
            ref={inputRef}
            value={voice.isRecording ? '🔴 Recording...' : voice.isTranscribing ? 'Transcribing...' : input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              placeholder || (
                mode === 'quick' ? "Ask about your territory..." :
                mode === 'deep' ? "What do you want to research? (auto-updates accounts)" :
                "Which account's meeting should I prep?"
              )
            }
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            disabled={isStreaming || voice.isRecording || voice.isTranscribing}
            readOnly={voice.isRecording}
          />
          <button
            type="button"
            onClick={handleMicClick}
            disabled={isStreaming || voice.isTranscribing}
            className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center transition-all shrink-0",
              voice.isRecording
                ? "bg-destructive text-destructive-foreground animate-pulse"
                : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
            )}
            title={voice.isRecording ? "Stop recording" : "Voice input"}
          >
            {voice.isTranscribing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : voice.isRecording ? (
              <MicOff className="h-3.5 w-3.5" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="submit"
            disabled={!input.trim() || isStreaming || voice.isRecording}
            className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-30 transition-opacity shrink-0"
          >
            {isStreaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TerritoryCopilot() {
  const { open: openCopilot } = useCopilot();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openCopilot(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openCopilot]);

  return (
    <>
      <button
        onClick={() => openCopilot()}
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span>Ask AI</span>
        <kbd className="hidden sm:inline-flex h-4 items-center rounded bg-primary/10 px-1 font-mono text-[10px]">⌘K</kbd>
      </button>
      <CopilotDialog />
    </>
  );
}

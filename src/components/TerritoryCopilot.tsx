// Territory Copilot v3 — ⌘K with Quick / Deep Research / Meeting Prep + write-back
import { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sparkles, Send, Loader2, MessageSquare, ArrowRight, Zap, RotateCcw, Search, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { streamCopilot, SUGGESTED_QUESTIONS, MODE_CONFIG, type CopilotMsg, type CopilotMode } from '@/lib/territoryCopilot';
import { useCopilot } from '@/contexts/CopilotContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

const MODE_ICONS: Record<CopilotMode, typeof Zap> = {
  quick: Zap,
  deep: Search,
  meeting: Calendar,
};

function ModeSelector({ mode, onChange, disabled }: { mode: CopilotMode; onChange: (m: CopilotMode) => void; disabled: boolean }) {
  return (
    <div className="flex gap-1">
      {(Object.keys(MODE_CONFIG) as CopilotMode[]).map((m) => {
        const config = MODE_CONFIG[m];
        const Icon = MODE_ICONS[m];
        const isActive = mode === m;
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            disabled={disabled}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all",
              isActive
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
  );
}

function CopilotDialog() {
  const { state, setOpen, clearInitialQuestion } = useCopilot();
  const [messages, setMessages] = useState<CopilotMsg[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<CopilotMode>('quick');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatesApplied, setUpdatesApplied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const processedQuestionRef = useRef<string | null>(null);
  

  useEffect(() => {
    if (state.open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      if (state.initialQuestion && processedQuestionRef.current !== state.initialQuestion) {
        processedQuestionRef.current = state.initialQuestion;
        setMessages([]);
        setUpdatesApplied(false);
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const sendMessage = useCallback(async (text: string, overrideMode?: CopilotMode) => {
    if (!text.trim() || isStreaming) return;
    
    const activeMode = overrideMode || mode;
    setError(null);
    setUpdatesApplied(false);
    const userMsg: CopilotMsg = { role: 'user', content: text.trim() };
    setMessages(prev => {
      const newMsgs = [...prev, userMsg];
      setIsStreaming(true);
      const abort = new AbortController();
      abortRef.current = abort;

      let assistantText = '';
      streamCopilot({
        messages: newMsgs,
        mode: activeMode,
        accountId: state.accountId,
        onDelta: (chunk) => {
          assistantText += chunk;
          setMessages(p => {
            const last = p[p.length - 1];
            if (last?.role === 'assistant') {
              return p.map((m, i) => i === p.length - 1 ? { ...m, content: assistantText } : m);
            }
            return [...p, { role: 'assistant', content: assistantText }];
          });
        },
        onDone: () => setIsStreaming(false),
        onError: (err) => { setError(err); setIsStreaming(false); },
        onAccountUpdated: () => {
          setUpdatesApplied(true);
          toast.success('Account data updated by AI research', {
            description: 'Your accounts have been enriched — refresh to see changes',
          });
        },
        signal: abort.signal,
      });

      return newMsgs;
    });
    setInput('');
  }, [isStreaming, mode, state.accountId]);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input); };
  const handleClear = () => { setMessages([]); setError(null); setUpdatesApplied(false); abortRef.current?.abort(); setIsStreaming(false); };

  const showSuggestions = messages.length === 0 && !isStreaming;
  const filteredSuggestions = SUGGESTED_QUESTIONS.filter(q => mode === 'quick' || q.mode === mode).slice(0, 6);

  return (
    <Dialog open={state.open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[680px] p-0 gap-0 max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-display text-sm font-bold">Territory Intelligence</span>
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
            {mode === 'deep' && <span className="ml-1 text-muted-foreground">• will auto-update accounts with findings</span>}
            {mode === 'meeting' && <span className="ml-1 text-muted-foreground">• auto-enriches account intel</span>}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px] max-h-[55vh]">
          {showSuggestions && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Zap className="h-3 w-3 text-primary" />
                {mode === 'quick' && "Ask anything about your territory, accounts, or pipeline."}
                {mode === 'deep' && "Deep research combines CRM data with web intel and auto-updates your accounts."}
                {mode === 'meeting' && "Get a comprehensive meeting brief — auto-enriches account data."}
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

          {messages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
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
          ))}

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
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              mode === 'quick' ? "Ask about your territory..." :
              mode === 'deep' ? "What do you want to research? (will auto-update accounts)" :
              "Which account's meeting should I prep?"
            }
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            disabled={isStreaming}
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
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
        <span className="hidden sm:inline">Ask</span>
        <kbd className="hidden sm:inline-flex h-4 items-center rounded bg-primary/10 px-1 font-mono text-[10px]">⌘K</kbd>
      </button>
      <CopilotDialog />
    </>
  );
}

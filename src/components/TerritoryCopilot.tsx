// Territory Copilot — ⌘K command bar for territory intelligence Q&A
import { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sparkles, Send, Loader2, MessageSquare, ArrowRight, Zap, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { streamCopilot, SUGGESTED_QUESTIONS, type CopilotMsg } from '@/lib/territoryCopilot';
import { useCopilot } from '@/contexts/CopilotContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function CopilotDialog() {
  const { state, setOpen, clearInitialQuestion } = useCopilot();
  const [messages, setMessages] = useState<CopilotMsg[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const processedQuestionRef = useRef<string | null>(null);

  // Focus input on open
  useEffect(() => {
    if (state.open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      // Auto-send initial question if provided and not already processed
      if (state.initialQuestion && processedQuestionRef.current !== state.initialQuestion) {
        processedQuestionRef.current = state.initialQuestion;
        // Reset messages for new context question
        setMessages([]);
        setTimeout(() => sendMessage(state.initialQuestion!), 200);
        clearInitialQuestion();
      }
    } else {
      abortRef.current?.abort();
      processedQuestionRef.current = null;
    }
  }, [state.open, state.initialQuestion]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;
    
    setError(null);
    const userMsg: CopilotMsg = { role: 'user', content: text.trim() };
    setMessages(prev => {
      const newMsgs = [...prev, userMsg];

      // Start streaming with the new messages
      setIsStreaming(true);
      const abort = new AbortController();
      abortRef.current = abort;

      let assistantText = '';
      streamCopilot({
        messages: newMsgs,
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
        onError: (err) => {
          setError(err);
          setIsStreaming(false);
        },
        signal: abort.signal,
      });

      return newMsgs;
    });
    setInput('');
  }, [isStreaming]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const showSuggestions = messages.length === 0 && !isStreaming;

  return (
    <Dialog open={state.open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[640px] p-0 gap-0 max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-display text-sm font-bold flex-1">Territory Intelligence</span>
          {messages.length > 0 && (
            <button onClick={handleClear} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <RotateCcw className="h-3 w-3" />
              New chat
            </button>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px] max-h-[50vh]">
          {showSuggestions && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Zap className="h-3 w-3 text-primary" />
                Ask anything about your territory, accounts, pipeline, or what to do next.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTED_QUESTIONS.slice(0, 6).map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="flex items-center gap-2 text-left p-2.5 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition-all group text-xs"
                  >
                    <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-foreground">{q}</span>
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
                  <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:text-sm [&_li]:text-sm [&_strong]:text-foreground [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_ul]:my-1 [&_ol]:my-1 [&_p]:my-1">
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
              <span className="text-xs">Analyzing your territory...</span>
            </div>
          )}

          {error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-lg p-3">
              {error}
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your territory..."
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

// Exported component with trigger button + global keyboard shortcut
export function TerritoryCopilot() {
  const { open: openCopilot, setOpen } = useCopilot();

  // ⌘K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openCopilot();
      }
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

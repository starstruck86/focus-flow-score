// Copilot Context — allows any component to open the copilot with a question, mode, and page context
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { streamCopilot, type CopilotMode } from '@/lib/territoryCopilot';
import { toast } from 'sonner';

export interface PageContext {
  page: string;
  description: string;
  accountId?: string;
  accountName?: string;
  opportunityId?: string;
  opportunityName?: string;
  /** Supercharge #3: Extra metadata for richer AI context */
  metadata?: Record<string, any>;
}

interface CopilotState {
  open: boolean;
  initialQuestion?: string;
  mode?: CopilotMode;
  accountId?: string;
}

interface BackgroundResult {
  question: string;
  mode: CopilotMode;
  content: string;
  accountId?: string;
}

interface CopilotContextValue {
  state: CopilotState;
  pageContext: PageContext | null;
  setPageContext: (ctx: PageContext | null) => void;
  ask: (question: string, mode?: CopilotMode, accountId?: string) => void;
  askBackground: (question: string, mode?: CopilotMode, accountId?: string) => void;
  open: () => void;
  close: () => void;
  setOpen: (open: boolean) => void;
  clearInitialQuestion: () => void;
  backgroundResult: BackgroundResult | null;
  clearBackgroundResult: () => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CopilotState>({ open: false });
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [backgroundResult, setBackgroundResult] = useState<BackgroundResult | null>(null);

  const ask = (question: string, mode?: CopilotMode, accountId?: string) =>
    setState({ open: true, initialQuestion: question, mode, accountId });
  const open = () => setState(prev => ({ ...prev, open: true }));
  const close = () => setState({ open: false });
  const setOpen = (o: boolean) => setState(prev => o ? { ...prev, open: o } : { open: false });
  const clearInitialQuestion = () =>
    setState(prev => ({ ...prev, initialQuestion: undefined, mode: undefined }));
  const clearBackgroundResult = () => setBackgroundResult(null);

  const askBackground = useCallback((question: string, mode: CopilotMode = 'quick', accountId?: string) => {
    const toastId = toast.loading(`Building ${mode === 'meeting' ? 'meeting brief' : mode === 'deal-strategy' ? 'deal strategy' : 'response'}...`, {
      duration: Infinity,
    });

    let content = '';
    streamCopilot({
      messages: [{ role: 'user', content: question }],
      mode,
      accountId,
      pageContext,
      onDelta: (chunk) => { content += chunk; },
      onDone: () => {
        setBackgroundResult({ question, mode, content, accountId });
        toast.dismiss(toastId);
        toast.success('AI response ready', {
          description: 'Tap to view',
          duration: 10000,
          action: {
            label: 'View',
            onClick: () => {
              setState({ open: true, initialQuestion: question, mode, accountId });
            },
          },
        });
      },
      onError: (err) => {
        toast.dismiss(toastId);
        toast.error('Background AI failed', { description: err });
      },
    });
  }, [pageContext]);

  return (
    <CopilotContext.Provider value={{ state, pageContext, setPageContext, ask, askBackground, open, close, setOpen, clearInitialQuestion, backgroundResult, clearBackgroundResult }}>
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilot() {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error('useCopilot must be used within CopilotProvider');
  return ctx;
}

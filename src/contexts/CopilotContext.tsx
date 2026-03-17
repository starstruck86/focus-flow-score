// Copilot Context — allows any component to open the copilot with a question, mode, and page context
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CopilotMode } from '@/lib/territoryCopilot';

export interface PageContext {
  page: string;
  description: string;
  accountId?: string;
  accountName?: string;
  opportunityId?: string;
  opportunityName?: string;
}

interface CopilotState {
  open: boolean;
  initialQuestion?: string;
  mode?: CopilotMode;
  accountId?: string;
}

interface CopilotContextValue {
  state: CopilotState;
  pageContext: PageContext | null;
  setPageContext: (ctx: PageContext | null) => void;
  ask: (question: string, mode?: CopilotMode, accountId?: string) => void;
  open: () => void;
  close: () => void;
  setOpen: (open: boolean) => void;
  clearInitialQuestion: () => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CopilotState>({ open: false });
  const [pageContext, setPageContext] = useState<PageContext | null>(null);

  const ask = (question: string, mode?: CopilotMode, accountId?: string) =>
    setState({ open: true, initialQuestion: question, mode, accountId });
  const open = () => setState(prev => ({ ...prev, open: true }));
  const close = () => setState({ open: false });
  const setOpen = (o: boolean) => setState(prev => o ? { ...prev, open: o } : { open: false });
  const clearInitialQuestion = () =>
    setState(prev => ({ ...prev, initialQuestion: undefined, mode: undefined }));

  return (
    <CopilotContext.Provider value={{ state, pageContext, setPageContext, ask, open, close, setOpen, clearInitialQuestion }}>
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilot() {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error('useCopilot must be used within CopilotProvider');
  return ctx;
}

// Copilot Context — allows any component to open the copilot with a question and mode
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CopilotMode } from '@/lib/territoryCopilot';

interface CopilotState {
  open: boolean;
  initialQuestion?: string;
  mode?: CopilotMode;
  accountId?: string;
}

interface CopilotContextValue {
  state: CopilotState;
  ask: (question: string, mode?: CopilotMode, accountId?: string) => void;
  open: () => void;
  close: () => void;
  setOpen: (open: boolean) => void;
  clearInitialQuestion: () => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CopilotState>({ open: false });

  const ask = (question: string, mode?: CopilotMode, accountId?: string) =>
    setState({ open: true, initialQuestion: question, mode, accountId });
  const open = () => setState(prev => ({ ...prev, open: true }));
  const close = () => setState({ open: false });
  const setOpen = (o: boolean) => setState(prev => o ? { ...prev, open: o } : { open: false });
  const clearInitialQuestion = () =>
    setState(prev => ({ ...prev, initialQuestion: undefined, mode: undefined }));

  return (
    <CopilotContext.Provider value={{ state, ask, open, close, setOpen, clearInitialQuestion }}>
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilot() {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error('useCopilot must be used within CopilotProvider');
  return ctx;
}

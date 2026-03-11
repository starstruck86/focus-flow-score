// Copilot Context — allows any component to open the copilot with a question
import { createContext, useContext, useState, type ReactNode } from 'react';

interface CopilotState {
  open: boolean;
  initialQuestion?: string;
}

interface CopilotContextValue {
  state: CopilotState;
  ask: (question: string) => void;
  open: () => void;
  close: () => void;
  setOpen: (open: boolean) => void;
  clearInitialQuestion: () => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CopilotState>({ open: false });

  const ask = (question: string) => setState({ open: true, initialQuestion: question });
  const open = () => setState(prev => ({ ...prev, open: true }));
  const close = () => setState({ open: false });
  const setOpen = (o: boolean) => setState(prev => ({ ...prev, open: o }));
  const clearInitialQuestion = () => setState(prev => ({ ...prev, initialQuestion: undefined }));

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

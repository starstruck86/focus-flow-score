import { createContext, useContext, useState, ReactNode } from 'react';
import type { LinkedRecordType, Motion } from '@/types';

interface LinkedRecordContextValue {
  type: LinkedRecordType | null;
  id: string | null;
  accountId?: string;
  suggestedMotion?: Motion;
}

interface LinkedRecordContextType {
  currentRecord: LinkedRecordContextValue;
  setCurrentRecord: (record: LinkedRecordContextValue) => void;
  clearCurrentRecord: () => void;
}

const LinkedRecordContext = createContext<LinkedRecordContextType | undefined>(undefined);

export function LinkedRecordProvider({ children }: { children: ReactNode }) {
  const [currentRecord, setCurrentRecordState] = useState<LinkedRecordContextValue>({
    type: null,
    id: null,
  });

  const setCurrentRecord = (record: LinkedRecordContextValue) => {
    setCurrentRecordState(record);
  };

  const clearCurrentRecord = () => {
    setCurrentRecordState({ type: null, id: null });
  };

  return (
    <LinkedRecordContext.Provider value={{ currentRecord, setCurrentRecord, clearCurrentRecord }}>
      {children}
    </LinkedRecordContext.Provider>
  );
}

export function useLinkedRecordContext() {
  const context = useContext(LinkedRecordContext);
  if (context === undefined) {
    throw new Error('useLinkedRecordContext must be used within a LinkedRecordProvider');
  }
  return context;
}

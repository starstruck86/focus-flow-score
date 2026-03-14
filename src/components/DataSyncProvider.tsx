import { createContext, useContext, useState, useCallback } from 'react';
import { useDataSync } from '@/hooks/useDataSync';

interface DataSyncContextType {
  isHydrated: boolean;
  setHydrated: (v: boolean) => void;
}

const DataSyncContext = createContext<DataSyncContextType>({
  isHydrated: false,
  setHydrated: () => {},
});

export function useDataSyncStatus() {
  return useContext(DataSyncContext);
}

export function DataSyncProvider({ children }: { children: React.ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const setHydrated = useCallback((v: boolean) => setIsHydrated(v), []);
  
  useDataSync(setHydrated);
  
  return (
    <DataSyncContext.Provider value={{ isHydrated, setHydrated }}>
      {children}
    </DataSyncContext.Provider>
  );
}

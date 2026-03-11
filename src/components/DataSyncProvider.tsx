import { useDataSync } from '@/hooks/useDataSync';

export function DataSyncProvider({ children }: { children: React.ReactNode }) {
  useDataSync();
  return <>{children}</>;
}

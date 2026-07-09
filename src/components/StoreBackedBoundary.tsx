import { ReactNode } from "react";
import { useDataSyncStatus } from "@/components/DataSyncProvider";
import { LazyFallback } from "@/components/LazyFallback";

/**
 * Gates a route's children on DataSync hydration completing.
 * Prevents routes that assume synchronous hydration from flashing false
 * empty/not-found states while the initial pull is in flight.
 */
export function StoreBackedBoundary({ children }: { children: ReactNode }) {
  const { isHydrated } = useDataSyncStatus();
  if (!isHydrated) return <LazyFallback text="Loading your data…" />;
  return <>{children}</>;
}

export default StoreBackedBoundary;

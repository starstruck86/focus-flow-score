import { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => {
      setIsOffline(false);
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3000);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!isOffline && !showReconnected) return null;

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-all duration-300',
        isOffline
          ? 'bg-destructive text-destructive-foreground'
          : 'bg-emerald-600 text-white'
      )}
    >
      {isOffline ? (
        <>
          <WifiOff className="h-4 w-4" />
          You're offline — changes are saved locally and will sync when reconnected
        </>
      ) : (
        <>
          <Wifi className="h-4 w-4" />
          Back online — syncing your data…
        </>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { Check, Loader2, Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// Global event emitter for save status
const listeners = new Set<(status: SaveStatus) => void>();

export function emitSaveStatus(status: SaveStatus) {
  listeners.forEach((fn) => fn(status));
}

export function SaveIndicator() {
  const [status, setStatus] = useState<SaveStatus>('idle');

  useEffect(() => {
    const handler = (s: SaveStatus) => {
      setStatus(s);
      if (s === 'saved') {
        const t = setTimeout(() => setStatus('idle'), 2500);
        return () => clearTimeout(t);
      }
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  if (status === 'idle') return null;

  return (
    <div className={cn(
      "flex items-center gap-1.5 text-xs font-medium transition-all duration-300",
      status === 'saving' && "text-muted-foreground",
      status === 'saved' && "text-status-green",
      status === 'error' && "text-destructive",
    )}>
      {status === 'saving' && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Saving…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check className="h-3.5 w-3.5" />
          <span>Saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <Cloud className="h-3.5 w-3.5" />
          <span>Save failed</span>
        </>
      )}
    </div>
  );
}

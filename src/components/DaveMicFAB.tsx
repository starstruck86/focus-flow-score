import { Mic, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SHELL } from '@/lib/layout';

interface Props {
  onTap: () => void;
  isLoading: boolean;
  isActive: boolean;
  isSpeaking?: boolean;
}

/**
 * Primary floating mic button for instant Dave access.
 * Positioned bottom-right as the most accessible action.
 * No continuous animations — stable at rest, responsive on interaction.
 */
export function DaveMicFAB({ onTap, isLoading, isActive }: Props) {
  if (isActive) return null;

  return (
    <button
      onClick={onTap}
      disabled={isLoading}
      aria-label="Talk to Dave"
      className={cn(
        'fixed z-50 flex items-center justify-center rounded-full shadow-lg',
        'h-14 w-14',
        `right-4 ${SHELL.fab.bottom}`,
        'transition-colors duration-150',
        isLoading
          ? 'bg-muted text-muted-foreground cursor-wait'
          : 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 active:scale-95',
      )}
      style={
        isLoading
          ? undefined
          : {
              boxShadow:
                '0 4px 20px -4px hsl(var(--primary) / 0.35), 0 0 0 1px hsl(var(--primary) / 0.08)',
            }
      }
    >
      {isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : (
        <Mic className="h-6 w-6" />
      )}
    </button>
  );
}
